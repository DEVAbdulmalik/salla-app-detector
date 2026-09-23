import { z } from "zod";
import { reportError } from "@/lib/report-error";
import { scan } from "@/lib/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ url: z.string().min(1).max(2048) });

const STATUS_BY_ERROR: Record<string, number> = {
  "rate-limited": 429,
  busy: 503,
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

  try {
    const result = await scan(parsed.data.url, clientIp(request));
    if (!result.ok) {
      return Response.json(
        { error: result.error },
        { status: STATUS_BY_ERROR[result.error] ?? 400 },
      );
    }
    return Response.json({ store: result.key, status: result.report.status });
  } catch (cause) {
    await reportError("scan-failed", cause, { url: parsed.data.url });
    return Response.json({ error: "unknown" }, { status: 500 });
  }
}

/** The first hop in the forwarding chain is the visitor; the rest are proxies. */
function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first === undefined || first === "" ? undefined : first;
}
