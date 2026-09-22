import { z } from "zod";
import { scan } from "@/lib/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ url: z.string().min(1).max(2048) });

const STATUS_BY_ERROR: Record<string, number> = {
  "rate-limited": 429,
  unreachable: 502,
  unknown: 500,
};

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const result = await scan(parsed.data.url, clientIp(request));
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: STATUS_BY_ERROR[result.error] ?? 400 });
  }

  return Response.json({ host: result.host, status: result.report.status });
}

/** The first hop in the forwarding chain is the visitor; the rest are proxies. */
function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first === undefined || first === "" ? undefined : first;
}
