import type { Metadata } from "next";
import { CategoryPage } from "@/components/CategoryPage";

export const metadata: Metadata = { title: "Free Online Editors", description: "Edit SVG graphics and plain text locally in your browser, free and without signup.", alternates: { canonical: "/editors" } };
export default function EditorsPage() { return <CategoryPage category="Editors" />; }
