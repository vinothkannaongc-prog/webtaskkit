import type { Metadata } from "next";
import { CategoryPage } from "@/components/CategoryPage";

export const metadata: Metadata = {
  title: "Free SEO Tools",
  description: "Audit public page metadata and check one robots.txt or XML sitemap document with guarded, explainable SEO tools.",
  alternates: { canonical: "/seo-tools" },
};

export default function SeoToolsPage() {
  return <CategoryPage category="SEO Tools" />;
}
