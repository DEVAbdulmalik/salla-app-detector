import { SallaClient } from "@salla-app-detector/salla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary: shows why the theme catalogue fails from this region. Fixed URL, no input.
export async function GET(): Promise<Response> {
  const direct = await fetch("https://salla.com/themes/api/themes", {
    headers: { accept: "application/json" },
  }).catch((error: unknown) => ({
    status: 0,
    headers: new Headers(),
    text: () => Promise.resolve(String(error)),
  }));
  const body = await direct.text();
  const viaClient = await new SallaClient({ timeoutMs: 20_000 }).fetchThemes();

  return Response.json({
    region: process.env.VERCEL_REGION,
    direct: {
      status: direct.status,
      server: direct.headers.get("server"),
      cfMitigated: direct.headers.get("cf-mitigated"),
      bodyStart: body.slice(0, 160),
    },
    client: viaClient.ok ? { themes: viaClient.value.length } : { error: viaClient.error },
  });
}
