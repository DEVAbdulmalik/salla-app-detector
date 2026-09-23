import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Reports are shareable but not for search: each one describes someone else's store and
 * would fill an index with near-identical pages. The panel and the API stay out too.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/r/", "/admin", "/api/", "/auth/"] }],
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
