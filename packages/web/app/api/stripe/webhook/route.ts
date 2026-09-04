import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import type Stripe from "stripe"

import { prisma } from "@/lib/db/prisma"
import { applyCreditTransaction } from "@/lib/db/credits"
import { microToUsd, stripeAmountToMicro } from "@/lib/server/credits"
import { getStripe, isBillingEnabled } from "@/lib/server/stripe"

// The Stripe SDK needs node crypto to verify signatures, and this route must
// never be statically optimised — it exists only to be POSTed to.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Stripe webhook — the only place credits are ever granted.
 *
 * Idempotency is layered, because Stripe delivers at least once and retries
 * failures for days:
 *
 *  1. `StripeEvent.processedAt` is the fast path. An event we have already
 *     finished is acknowledged without being re-run. Note the guard is on
 *     *processed*, not merely *seen* — a row written before a handler threw
 *     must stay retryable, or a transient database blip would silently drop a
 *     payment forever.
 *  2. `CreditTransaction.externalId` is the actual guarantee. Every movement is
 *     keyed on the Stripe object that caused it — the checkout session for a
 *     purchase, the refund or dispute id for a reversal — under a unique index.
 *     Two concurrent deliveries both reach it and exactly one wins.
 *
 * The second is what matters. The first is only there to save work.
 */

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
}

/**
 * The user behind a payment, or null.
 *
 * Never guessed. An unattributable payment is logged and left alone for a human
 * to resolve with the admin grant endpoint — crediting the wrong account is
 * worse than crediting none, and a retry cannot fix a missing id anyway.
 */
async function resolveUserFromSession(
  session: Stripe.Checkout.Session
): Promise<string | null> {
  const candidate =
    session.client_reference_id ??
    (typeof session.metadata?.userId === "string" ? session.metadata.userId : null)

  if (candidate) {
    const user = await prisma.user.findUnique({
      where: { id: candidate },
      select: { id: true },
    })
    if (user) return user.id
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id
  if (customerId) {
    const user = await prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    })
    if (user) return user.id
  }

  return null
}

/**
 * The user behind a charge, for reversals.
 *
 * Reached through the purchase we recorded: the PaymentIntent id is stamped on
 * the original `purchase` row, so a refund lands on the same account that was
 * credited, even years later. Falls back to the metadata the checkout route
 * stamped on the PaymentIntent, then to the customer.
 */
async function resolveUserFromCharge(charge: Stripe.Charge): Promise<string | null> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id

  if (paymentIntentId) {
    const purchase = await prisma.creditTransaction.findFirst({
      where: { stripePaymentIntentId: paymentIntentId, type: "purchase" },
      select: { userId: true },
    })
    if (purchase) return purchase.userId
  }

  const metaUserId = charge.metadata?.userId
  if (typeof metaUserId === "string" && metaUserId) {
    const user = await prisma.user.findUnique({
      where: { id: metaUserId },
      select: { id: true },
    })
    if (user) return user.id
  }

  const customerId =
    typeof charge.customer === "string" ? charge.customer : charge.customer?.id
  if (customerId) {
    const user = await prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    })
    if (user) return user.id
  }

  return null
}

/**
 * Apply a balance movement that a duplicate delivery may already have applied.
 * Returns false when the unique index says it was already done.
 */
async function applyOnce(
  params: Parameters<typeof applyCreditTransaction>[0]
): Promise<boolean> {
  try {
    await applyCreditTransaction(params)
    return true
  } catch (err) {
    if (isUniqueViolation(err)) return false
    throw err
  }
}

/** A completed (or later-settled) Checkout Session becomes credits. */
async function handleCheckoutCompleted(
  event: Stripe.Event,
  session: Stripe.Checkout.Session
): Promise<void> {
  // "complete" is not "paid": a delayed-notification method completes the
  // session and pays days later, arriving again as async_payment_succeeded.
  if (session.payment_status !== "paid") {
    console.log(
      `[stripe] session ${session.id} is ${session.payment_status}; waiting for settlement`
    )
    return
  }

  if ((session.currency ?? "").toLowerCase() !== "usd") {
    console.error(
      `[stripe] refusing session ${session.id}: currency ${session.currency}, expected usd`
    )
    return
  }

  // The amount comes from the event, never from anything the client sent.
  const amount = session.amount_total ?? 0
  if (amount <= 0) return

  const userId = await resolveUserFromSession(session)
  if (!userId) {
    console.error(
      `[stripe] session ${session.id} paid ${amount} but no user could be resolved — ` +
        `credit it by hand via /api/admin/users/<id>/credits`
    )
    return
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id

  const micro = stripeAmountToMicro(amount)
  const applied = await applyOnce({
    userId,
    amountMicroUsd: micro,
    type: "purchase",
    externalId: session.id,
    stripeEventId: event.id,
    stripePaymentIntentId: paymentIntentId ?? null,
    description: `Top-up of $${microToUsd(micro).toFixed(2)}`,
  })

  console.log(
    applied
      ? `[stripe] credited $${microToUsd(micro).toFixed(2)} to ${userId} (${session.id})`
      : `[stripe] session ${session.id} was already credited; ignoring redelivery`
  )
}

/**
 * A refunded charge gives the credits back.
 *
 * Keyed on the refund id, not the charge id, because a charge can be refunded
 * in parts: two $5 refunds against one $10 charge arrive as two
 * `charge.refunded` events on the same charge, and keying on the charge would
 * dedupe the second away and never reverse it.
 *
 * Refunds are listed from the API rather than read off `charge.refunds`, which
 * is a paginated sublist and is not guaranteed to be expanded on the payload.
 */
async function handleChargeRefunded(
  event: Stripe.Event,
  charge: Stripe.Charge
): Promise<void> {
  const userId = await resolveUserFromCharge(charge)
  if (!userId) {
    console.error(
      `[stripe] charge ${charge.id} was refunded but no user could be resolved`
    )
    return
  }

  const refunds = await getStripe().refunds.list({ charge: charge.id, limit: 100 })

  for (const refund of refunds.data) {
    if (refund.status !== "succeeded") continue
    if (refund.amount <= 0) continue

    const micro = stripeAmountToMicro(refund.amount)
    const applied = await applyOnce({
      userId,
      amountMicroUsd: -micro,
      type: "refund",
      externalId: refund.id,
      stripeEventId: event.id,
      stripePaymentIntentId:
        typeof charge.payment_intent === "string" ? charge.payment_intent : null,
      description: `Refund of $${microToUsd(micro).toFixed(2)}`,
    })
    if (applied) {
      console.log(
        `[stripe] reversed $${microToUsd(micro).toFixed(2)} from ${userId} (${refund.id})`
      )
    }
  }
}

/**
 * A dispute takes the money back immediately, so the credits go with it —
 * even if that leaves the balance negative, which is correct: the platform has
 * already lost the funds and the usage was already delivered.
 */
async function handleDisputeCreated(
  event: Stripe.Event,
  dispute: Stripe.Dispute
): Promise<void> {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id
  const charge = await getStripe().charges.retrieve(chargeId)

  const userId = await resolveUserFromCharge(charge)
  if (!userId) {
    console.error(`[stripe] dispute ${dispute.id} raised but no user could be resolved`)
    return
  }

  const micro = stripeAmountToMicro(dispute.amount)
  const applied = await applyOnce({
    userId,
    amountMicroUsd: -micro,
    type: "chargeback",
    externalId: `dispute:${dispute.id}`,
    stripeEventId: event.id,
    description: `Chargeback of $${microToUsd(micro).toFixed(2)}`,
  })
  if (applied) {
    console.log(`[stripe] chargeback reversed $${microToUsd(micro).toFixed(2)} from ${userId}`)
  }
}

/** A dispute we won gives the credits back; one we lost stays reversed. */
async function handleDisputeClosed(
  event: Stripe.Event,
  dispute: Stripe.Dispute
): Promise<void> {
  if (dispute.status !== "won") {
    console.log(`[stripe] dispute ${dispute.id} closed as ${dispute.status}; no change`)
    return
  }

  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id
  const charge = await getStripe().charges.retrieve(chargeId)

  const userId = await resolveUserFromCharge(charge)
  if (!userId) return

  const micro = stripeAmountToMicro(dispute.amount)
  await applyOnce({
    userId,
    amountMicroUsd: micro,
    type: "adjustment",
    externalId: `dispute-won:${dispute.id}`,
    stripeEventId: event.id,
    description: `Chargeback reversed in our favour`,
  })
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutCompleted(event, event.data.object as Stripe.Checkout.Session)
      break

    case "checkout.session.async_payment_failed":
      // Nothing was credited, so there is nothing to reverse.
      console.log(
        `[stripe] async payment failed for session ${(event.data.object as Stripe.Checkout.Session).id}`
      )
      break

    case "charge.refunded":
      await handleChargeRefunded(event, event.data.object as Stripe.Charge)
      break

    case "charge.dispute.created":
      await handleDisputeCreated(event, event.data.object as Stripe.Dispute)
      break

    case "charge.dispute.closed":
      await handleDisputeClosed(event, event.data.object as Stripe.Dispute)
      break

    default:
      // Subscribed to something we do not act on. Recorded, not an error.
      console.log(`[stripe] ignoring ${event.type}`)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isBillingEnabled()) {
    return new Response("Billing is not enabled", { status: 404 })
  }

  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 })
  }

  // The raw bytes, not the parsed body: the signature covers the exact payload
  // Stripe sent, and req.json() would discard it.
  const raw = await request.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(
      raw,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    )
  } catch (err) {
    // Worth logging every time: a run of these means a misconfigured endpoint,
    // a secret from the wrong environment, or someone probing.
    console.error("[stripe] webhook signature verification failed:", err)
    return new Response("Invalid signature", { status: 400 })
  }

  const seen = await prisma.stripeEvent.findUnique({
    where: { id: event.id },
    select: { processedAt: true },
  })
  if (seen?.processedAt) {
    return new Response("Already processed", { status: 200 })
  }
  if (!seen) {
    try {
      await prisma.stripeEvent.create({
        data: {
          id: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      // Raced by a concurrent delivery of the same event. Harmless: whichever
      // one is processing it holds the CreditTransaction unique index too.
      if (!isUniqueViolation(err)) throw err
      return new Response("In flight", { status: 200 })
    }
  }

  try {
    await handleEvent(event)
    await prisma.stripeEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), error: null },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[stripe] handler failed for ${event.type} ${event.id}:`, err)
    await prisma.stripeEvent
      .update({ where: { id: event.id }, data: { error: message.slice(0, 2000) } })
      .catch(() => {})
    // 500 so Stripe retries. processedAt is still null, so the retry re-runs
    // the handler rather than being waved through as a duplicate.
    return new Response("Handler failed", { status: 500 })
  }

  return new Response("OK", { status: 200 })
}
