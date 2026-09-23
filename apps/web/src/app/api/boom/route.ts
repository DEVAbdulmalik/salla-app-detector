export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  throw new Error("temporary check of the error reporting path");
}
