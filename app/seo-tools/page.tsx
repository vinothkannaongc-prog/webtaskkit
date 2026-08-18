import type { Metadata } from "next";
import { CategoryPage } from "@/components/CategoryPage";

export const metadata: Metadata = {
  title: "Free SEO Tools",
  description: "Inspect public page metadata, structure and social sharing tags with guarded, explainable SEO checks.",
  alternates: { canonical: "/seo-tools" },
};

export default function SeoToolsPage() {
  return <CategoryPage category="SEO Tools" />;
}
