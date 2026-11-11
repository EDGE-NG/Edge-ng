import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate (Next 16 renamed middleware -> proxy).
 * Cookie presence gates pages; API routes validate the session server-side.
 */
export function proxy(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get("edge_session")?.value);
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/app") && !hasSession) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/app/edge", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/login"],
};
