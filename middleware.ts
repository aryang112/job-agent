import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page and auth API
  if (pathname === "/login" || pathname === "/api/auth") {
    return NextResponse.next();
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
