import { NextRequest, NextResponse } from "next/server"

import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import {
  appUrl,
  getStripe,
  isBillingEnabled,
  resolvePriceId,
} from "@/lib/server/stripe"

export const runtime = "nodejs"

/**
 * POST /api/billing/checkout
 *
 * Starts a credit top-up. Returns the hosted Checkout URL for the client to
 * redirect to; it does not credit anything. Credits are granted by the webhook
 * and nowhere else, because this response can be replayed, bookmarked, or never
 * reached at all, while the payment still succeeded.
 *
 * The body carries a pack id, never an amount. The id is resolved against
 * STRIPE_PRICE_MAP on the server, so the set of things that can be bought is
 * fixed by the environment rather than by whatever the browser sends.
 */
export async function POST(request: NextRequest) {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Billing is not enabled" }, { status: 404 })
  }

  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  let body: { packId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const packId = body.packId
  if (typeof packId !== "string" || !packId) {
    return NextResponse.json({ error: "packId is required" }, { status: 400 })
  }

  const priceId = resolvePriceId(packId)
  if (!priceId) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 400 })
  }

  try {
    const stripe = getStripe()

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true, email: true, name: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Reuse the customer across top-ups so a person's payment history, receipts
    // and disputes stay on one Stripe customer instead of scattering across a
    // new one per purchase.
    let customerId = user.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        metadata: { userId },
      })
      customerId = customer.id
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Three places to find the user, because the webhook must never guess.
      // client_reference_id and metadata cover the session events;
      // payment_intent_data.metadata carries the id onto the PaymentIntent, so
      // a refund or dispute months later can still be attributed.
      client_reference_id: userId,
      metadata: { userId, packId },
      payment_intent_data: { metadata: { userId, packId } },
      success_url: appUrl("/?topup=success&session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: appUrl("/?topup=cancelled"),
    })

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL" },
        { status: 502 }
      )
    }

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    console.error("[billing] checkout session failed:", error)
    return internalError(error)
  }
}
