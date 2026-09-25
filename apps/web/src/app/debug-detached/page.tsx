export const dynamic = "force-dynamic";

// A rejection nobody awaits, which Next never sees as a render error.
export default function Page() {
  void Promise.reject(new Error("detached rejection during render"));
  return <p>rendered</p>;
}
