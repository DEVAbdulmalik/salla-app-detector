import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const path = decodedPath(request);
  if (path === undefined) {
    // A report link carries a store key, and a path that is not valid percent-encoding
    // fails inside the router before any page runs. It cannot name a store either way.
    return new NextResponse(null, { status: 404 });
  }

  return path.startsWith("/admin") ? refreshSession(request) : NextResponse.next();
}

function decodedPath(request: NextRequest): string | undefined {
  try {
    return decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return undefined;
  }
}

/**
 * Keeps an admin signed in. An access token lasts an hour, and only a middleware or a
 * route handler may write the refreshed one back, so the panel would otherwise fail on the
 * first visit after the token expired.
 */
async function refreshSession(request: NextRequest): Promise<NextResponse> {
  const config = supabaseConfig();
  if (!config) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (entries) => {
        response = NextResponse.next({ request });
        for (const entry of entries) {
          response.cookies.set(entry.name, entry.value, entry.options);
        }
      },
    },
  });

  await client.auth.getUser();
  return response;
}

export const config = { matcher: ["/r/:path*", "/admin/:path*"] };
