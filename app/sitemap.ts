import type { MetadataRoute } from "next";
import { tools } from "@/lib/tools";

const siteUrl = "https://webtaskkit.com";
const lastModifiedByPath: Record<string, string> = {
  "/": "2026-08-18T21:35:16.000Z",
  "/about": "2026-08-18T21:35:16.000Z",
  "/privacy": "2026-08-18T21:35:16.000Z",
  "/seo-tools": "2026-08-18T21:35:16.000Z",
  "/seo-tools/on-page-seo-audit": "2026-08-18T21:35:16.000Z",
};

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/generators", "/converters", "/editors", "/seo-tools", "/about", "/privacy", ...tools.map((tool) => tool.href)];
  return paths.map((path, index) => ({
    url: `${siteUrl}${path}`,
    ...(lastModifiedByPath[path] ? { lastModified: lastModifiedByPath[path] } : {}),
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : path === "/about" || path === "/privacy" ? 0.3 : 0.8,
  }));
}
