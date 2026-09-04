import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import { getCreditPacks, isBillingEnabled, type CreditPack } from "@/lib/server/stripe"

export const runtime = "nodejs"

export interface PacksResponse {
  /** False when this deployment has no billing configured — hide top-up. */
  enabled: boolean
  packs: CreditPack[]
}

/**
 * GET /api/billing/packs — what a user can buy, with amounts read from Stripe.
 *
 * Behind auth: the pack list is only useful to someone who can buy, and keeping
 * it authenticated means the price ids are not public.
 */
export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  if (!isBillingEnabled()) {
    return Response.json({ enabled: false, packs: [] } satisfies PacksResponse)
  }

  try {
    return Response.json({
      enabled: true,
      packs: await getCreditPacks(),
    } satisfies PacksResponse)
  } catch (error) {
    return internalError(error)
  }
}
