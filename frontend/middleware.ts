import { type NextRequest, NextResponse } from "next/server";

// Paths that require authentication
const protectedRoutes = ["/chat", "/history", "/settings"];

export function middleware(request: NextRequest) {
  // Check if user has a session token
  const token = request.cookies.get("sb-qsaaipuaxcreiljnwcgs-auth-token");
  const pathname = request.nextUrl.pathname;

  // Check if the current route requires authentication
  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtected && !token) {
    // Redirect to login if no token
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
