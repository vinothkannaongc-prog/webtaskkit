import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { tools } from "@/lib/tools";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:5173";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const paths = ["/", "/generators/", "/converters/", "/editors/", "/about/", "/privacy/", ...tools.map((tool) => tool.href)];
  return paths.map((path, index) => ({
    url: `${origin}${path}`,
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : path === "/about/" || path === "/privacy/" ? 0.3 : 0.8,
  }));
}
