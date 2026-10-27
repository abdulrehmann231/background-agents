/**
 * HTML page served at the end of an MCP connect popup (GitHub App install,
 * Google OAuth). It tells the opener which flow finished via postMessage, then
 * closes itself; the opener re-checks status on its own.
 */
import { escapeHtml } from "@/lib/html"

export function popupClosingPage(opts: {
  /** postMessage `source` the opener listens for. */
  source: string
  /** Provider name for the page title, e.g. "GitHub". */
  provider: string
  ok: boolean
  message: string
}): Response {
  const safe = escapeHtml(opts.message)
  const title = escapeHtml(`${opts.provider} setup ${opts.ok ? "complete" : "failed"}`)
  const message = JSON.stringify({ source: opts.source, ok: opts.ok })
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font: 14px system-ui, sans-serif; padding: 24px; color: #333; }
  .ok { color: #1a7f37; }
  .err { color: #cf222e; }
</style>
</head>
<body>
  <p class="${opts.ok ? "ok" : "err"}">${safe}</p>
  <p>You can close this window.</p>
  <script>
    try { window.opener && window.opener.postMessage(${message}, "*"); } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
  </script>
</body></html>`
  return new Response(body, {
    status: opts.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
