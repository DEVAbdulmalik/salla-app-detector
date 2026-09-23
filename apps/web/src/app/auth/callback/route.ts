import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Completes an email sign-in by exchanging the one-time code for a session. */
export async function GET(request: Request): Promise<Response> {
  const config = supabaseConfig();
  const code = new URL(request.url).searchParams.get("code");
  const home = new URL("/admin", request.url);

  if (!config || code === null) {
    return Response.redirect(home);
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

  await client.auth.exchangeCodeForSession(code);
  return Response.redirect(home);
}
