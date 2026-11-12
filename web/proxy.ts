import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate (Next 16 renamed middleware -> proxy).
 * Cookie presence gates pages; API routes validate the session server-side.
 * A stale cookie is cleared by the checklist page (it calls /api/auth/logout on a
 * 401), so the /login <-> /checklist redirects below cannot loop.
 */
const PROTECTED = ["/app", "/checklist"];
const AUTH_PAGES = ["/login", "/signup"];

export function proxy(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get("edge_session")?.value);
  const { pathname } = req.nextUrl;

  // the chat moved to /checklist; keep old links working
  if (pathname === "/chat") {
    return NextResponse.redirect(new URL("/checklist" + req.nextUrl.search, req.url));
  }
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/")) && !hasSession) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (AUTH_PAGES.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL("/checklist", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/checklist/:path*", "/checklist", "/chat", "/login", "/signup"],
};
