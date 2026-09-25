import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// What Supabase does on a token refresh: a cookie write from inside an awaited listener.
export default async function Page() {
  const store = await cookies();
  await Promise.resolve().then(() => {
    store.set("probe", "1");
  });
  return <p>rendered</p>;
}
