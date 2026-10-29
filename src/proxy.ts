import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.has("acts_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
