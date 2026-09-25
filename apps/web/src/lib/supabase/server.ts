import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/** Reads the signed-in admin, if there is one. Returns undefined when auth is not set up. */
export async function currentUserEmail(): Promise<string | undefined> {
  const config = supabaseConfig();
  if (!config) {
    return undefined;
  }

  const store = await cookies();
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (entries) => {
        // A page render may not write cookies, and Supabase writes them whenever it
        // refreshes an expired token. Letting that throw would fail the whole page, so the
        // refreshed session is dropped here and renewed by the middleware instead.
        try {
          for (const entry of entries) {
            store.set(entry.name, entry.value, entry.options);
          }
        } catch {
          return;
        }
      },
    },
  });

  const { data } = await client.auth.getUser();
  return data.user?.email ?? undefined;
}
