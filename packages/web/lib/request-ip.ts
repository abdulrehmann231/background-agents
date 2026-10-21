/**
 * Extract the originating client IP from a set of request headers.
 *
 * Behind a reverse proxy (Vercel, or any other), the client's real IP is the
 * first entry in `x-forwarded-for` — everything after it is an intermediate
 * proxy hop. Falls back to `x-real-ip` for proxies that set that instead.
 */
export function getClientIpFromHeaders(headersList: Headers): string | undefined {
  const forwardedFor = headersList.get("x-forwarded-for")
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim()
    if (first) return first
  }
  return headersList.get("x-real-ip") ?? undefined
}
