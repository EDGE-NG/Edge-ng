/**
 * Security headers sent with every response (next.config.ts headers()).
 *
 * - Content-Security-Policy: the browser only runs scripts, loads styles and
 *   connects to Edge itself (plus Google Fonts). AI providers, market data and
 *   Supabase are only called from the server (REQ-ARC-2), so the browser never
 *   needs them. No nonce: cacheComponents / partial prerendering serve static
 *   shells, which can't carry one, so inline scripts stay allowed (the Next.js
 *   "without nonces" setup). frame-ancestors 'none' stops other sites from
 *   framing Edge (clickjacking on Buy / Sell or Override).
 * - HSTS, nosniff, Referrer-Policy, frame and permissions headers: the usual
 *   hardening. The microphone stays allowed for Edge itself (voice notes).
 */

export interface HeaderOptions {
  /** `next dev` needs eval for fast refresh. */
  dev: boolean;
  /** Vercel preview builds load Vercel's comment toolbar from vercel.live. */
  preview: boolean;
}

export function contentSecurityPolicy({ dev, preview }: HeaderOptions): string {
  const vercelLive = preview ? " https://vercel.live" : "";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${vercelLive}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${vercelLive}`,
    `font-src 'self' https://fonts.gstatic.com${vercelLive}`,
    // data: for avatars and chart snapshots, blob: for upload previews
    `img-src 'self' data: blob:${vercelLive}`,
    "media-src 'self' blob:",
    // the browser only talks to Edge's own API (dev also needs the hot-reload socket)
    `connect-src 'self'${dev ? " ws: wss:" : ""}${vercelLive}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    `frame-src ${preview ? "https://vercel.live" : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function securityHeaders(opts: HeaderOptions): Array<{ key: string; value: string }> {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  // only over HTTPS; on localhost it would stick to the browser for every local port
  if (!opts.dev) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}
