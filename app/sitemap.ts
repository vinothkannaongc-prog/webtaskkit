import type { MetadataRoute } from "next";
import { tools } from "@/lib/tools";

const siteUrl = "https://webtaskkit.com";
const lastModifiedByPath: Record<string, string> = {
  "/": "2026-08-19T03:13:47.894Z",
  "/about": "2026-09-01T06:50:35.918Z",
  "/privacy": "2026-09-01T06:50:35.918Z",
  "/seo-tools": "2026-09-01T06:50:35.918Z",
  "/seo-tools/on-page-seo-audit": "2026-08-19T03:13:47.894Z",
  "/seo-tools/robots-sitemap-validator": "2026-08-19T03:13:47.894Z",
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
