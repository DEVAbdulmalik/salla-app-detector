/**
 * The public address of this deployment. Set NEXT_PUBLIC_SITE_URL once a custom domain is
 * in place; until then Vercel's own production URL is the right answer, and a local build
 * falls back to the dev server.
 */
export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured !== undefined && configured !== "") {
    return new URL(configured);
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return new URL(
    vercel === undefined || vercel === "" ? "http://localhost:3000" : `https://${vercel}`,
  );
}
