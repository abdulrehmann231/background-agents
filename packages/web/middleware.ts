import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Allowed origins for Electron app and development
const ALLOWED_ORIGINS = [
  "app://.",                          // Electron custom protocol
  "file://",                          // Electron file protocol
  "http://localhost:4000",            // Local development
  "http://localhost:3000",            // Alternative local
  "https://agents.new",               // Production
]

// --- Maintenance mode ---------------------------------------------------
// Toggle the whole site off with the MAINTENANCE_MODE env var. When it is
// "true", every request (pages AND api) is served the maintenance page with a
// 503 status, so the site cannot be reached even by typing URLs manually.
//
// To still access the live site yourself during maintenance, hit any URL with
// ?bypass=<MAINTENANCE_BYPASS_SECRET>. That sets a cookie so subsequent
// navigation works normally for you only.
const MAINTENANCE_COOKIE = "maintenance-bypass"

function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE === "true"
}

function hasBypass(request: NextRequest) {
  const secret = process.env.MAINTENANCE_BYPASS_SECRET
  if (!secret) return false
  // Already bypassed via cookie?
  if (request.cookies.get(MAINTENANCE_COOKIE)?.value === secret) return true
  // Bypass requested via query param?
  return request.nextUrl.searchParams.get("bypass") === secret
}

function maintenanceResponse(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api")

  if (isApi) {
    const res = NextResponse.json(
      { error: "Service temporarily unavailable for maintenance." },
      { status: 503 }
    )
    res.headers.set("Retry-After", "3600")
    return res
  }

  const res = NextResponse.rewrite(new URL("/maintenance.html", request.url), {
    status: 503,
  })
  res.headers.set("Retry-After", "3600")
  // Don't let the maintenance page get cached as the "real" site.
  res.headers.set("Cache-Control", "no-store")
  return res
}

export function middleware(request: NextRequest) {
  // Maintenance gate runs first so nothing slips through.
  if (isMaintenanceMode()) {
    if (hasBypass(request)) {
      const res = NextResponse.next()
      // Persist the bypass so the operator can navigate freely.
      const secret = process.env.MAINTENANCE_BYPASS_SECRET
      if (secret) {
        res.cookies.set(MAINTENANCE_COOKIE, secret, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        })
      }
      return res
    }
    return maintenanceResponse(request)
  }

  const origin = request.headers.get("origin")
  const response = NextResponse.next()

  // Handle CORS for Electron and development (API routes only)
  if (origin && request.nextUrl.pathname.startsWith("/api")) {
    const isAllowed = ALLOWED_ORIGINS.some(
      (allowed) => origin === allowed || origin.startsWith(allowed)
    )

    if (isAllowed) {
      response.headers.set("Access-Control-Allow-Origin", origin)
      response.headers.set("Access-Control-Allow-Credentials", "true")
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      )
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      )
    }
  }

  // Handle preflight requests
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    })
  }

  return response
}

// Run on everything so maintenance mode can gate the whole site, but skip
// Next.js internals and the maintenance page asset itself (avoids a redirect
// loop and lets the page's own request through).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|maintenance.html).*)"],
}
