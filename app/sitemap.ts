import type { MetadataRoute } from "next";
import { tools } from "@/lib/tools";

const siteUrl = "https://webtaskkit.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/generators", "/converters", "/editors", "/about", "/privacy", ...tools.map((tool) => tool.href)];
  return paths.map((path, index) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : path === "/about" || path === "/privacy" ? 0.3 : 0.8,
  }));
}
