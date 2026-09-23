/**
 * Admin sign-in uses Supabase's email links. The keys below are the public ones intended
 * for browsers; access is decided server-side by the allowlist, never by the key itself.
 */
export interface SupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
}

export function supabaseConfig(): SupabaseConfig | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || url === "" || publishableKey === undefined || publishableKey === "") {
    return undefined;
  }
  return { url, publishableKey };
}

export function isAdminEmail(email: string | undefined): boolean {
  if (email === undefined) {
    return false;
  }
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  return allowed.includes(email.toLowerCase());
}
