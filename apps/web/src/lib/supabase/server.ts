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
        for (const entry of entries) {
          store.set(entry.name, entry.value, entry.options);
        }
      },
    },
  });

  const { data } = await client.auth.getUser();
  return data.user?.email ?? undefined;
}
