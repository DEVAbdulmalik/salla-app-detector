import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Completes an email sign-in by exchanging the one-time code for a session. The exchange
 * needs the verifier cookie set when the link was requested, so a link opened in another
 * browser — a mail app's built-in one, typically — cannot finish here. That case says so
 * rather than bouncing the visitor back to a sign-in form with no explanation.
 */
export async function GET(request: Request): Promise<Response> {
  const config = supabaseConfig();
  const requested = new URL(request.url);
  const code = requested.searchParams.get("code");
  const failed =
    requested.searchParams.get("error_description") ?? requested.searchParams.get("error");

  if (failed !== null) {
    return Response.redirect(signIn(request, "expired"));
  }
  if (!config || code === null) {
    return Response.redirect(signIn(request, "wrong-browser"));
  }

  const store = await cookies();
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (entries) => {
        for (const entry of entries) {
          store.set(entry.name, entry.value, entry.options);
        }
      },
    },
  });

  const { error } = await client.auth.exchangeCodeForSession(code);
  return Response.redirect(
    error ? signIn(request, "wrong-browser") : new URL("/admin", request.url),
  );
}

function signIn(request: Request, reason: string): URL {
  const url = new URL("/admin/sign-in", request.url);
  url.searchParams.set("error", reason);
  return url;
}
