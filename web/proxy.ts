import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gate (Next 16 renamed middleware -> proxy).
 *
 * Refreshes the Supabase session on every matched request (the access token
 * is short-lived) and writes any new session cookies to the response, as
 * @supabase/ssr requires. Signed-out visitors to app pages go to /login;
 * signed-in visitors to /login or /signup go to the checklist. API routes
 * check the session themselves.
 */
const PROTECTED = ["/app", "/checklist"];
const AUTH_PAGES = ["/login", "/signup"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // the chat moved to /checklist; keep old links working
  if (pathname === "/chat") {
    return NextResponse.redirect(new URL("/checklist" + req.nextUrl.search, req.url));
  }

  let res = NextResponse.next({ request: req });
  let signedIn = false;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(toSet, headers) {
          for (const { name, value } of toSet) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of toSet) res.cookies.set(name, value, options);
          for (const [h, v] of Object.entries(headers ?? {})) res.headers.set(h, v);
        },
      },
    });
    try {
      const { data } = await supabase.auth.getClaims();
      signedIn = Boolean(data?.claims?.sub);
    } catch {
      signedIn = false;
    }
  }

  const redirect = (to: string) => {
    const r = NextResponse.redirect(new URL(to, req.url));
    // keep refreshed (or cleared) session cookies on the redirect too
    for (const c of res.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/")) && !signedIn) {
    return redirect("/login");
  }
  if (AUTH_PAGES.includes(pathname) && signedIn) {
    return redirect("/checklist");
  }
  return res;
}

export const config = {
  matcher: ["/app/:path*", "/checklist/:path*", "/checklist", "/chat", "/login", "/signup"],
};
