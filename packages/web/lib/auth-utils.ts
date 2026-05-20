import { signIn } from "next-auth/react"

/**
 * Check if running in Electron (must be called at runtime, not module load)
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as { electron?: unknown }).electron
}

/**
 * Sign in with GitHub, handling Electron's special OAuth flow
 *
 * In Electron, redirects to /api/auth/electron-callback which then
 * redirects to background-agents://auth-callback to bring focus back
 * to the Electron app.
 */
export function signInWithGitHub() {
  const electron = isElectron()
  console.log("[signInWithGitHub] isElectron:", electron, "window.electron:", typeof window !== "undefined" ? !!(window as { electron?: unknown }).electron : "SSR")
  if (electron) {
    console.log("[signInWithGitHub] Using Electron callback URL")
    signIn("github", { callbackUrl: "/api/auth/electron-callback" })
  } else {
    console.log("[signInWithGitHub] Using default sign-in")
    signIn("github")
  }
}
