import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page and auth API without cookie
  if (pathname === "/login" || pathname === "/api/auth") {
    return NextResponse.next();
  }

  // Allow scan endpoint for Vercel cron (no cookie, uses bearer token)
  if (pathname === "/api/scan") {
    const hasCookie = req.cookies.get("auth_token")?.value === process.env.AUTH_SECRET;
    const hasCron = req.headers.get("x-vercel-cron") === "1";
    const hasBearer = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
    if (hasCookie || hasCron || hasBearer) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check auth cookie
  const token = req.cookies.get("auth_token")?.value;
  if (token !== process.env.AUTH_SECRET) {
    // Redirect browser requests to login, block API requests
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
