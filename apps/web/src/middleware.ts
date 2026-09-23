import { NextResponse, type NextRequest } from "next/server";

/**
 * Report links carry a store key in the path, and a request whose path is not valid
 * percent-encoding fails inside the router before any page runs. Such a path cannot name
 * a store, so it is answered here rather than surfacing as a server error.
 */
export function middleware(request: NextRequest): NextResponse {
  try {
    decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/r/:path*" };
