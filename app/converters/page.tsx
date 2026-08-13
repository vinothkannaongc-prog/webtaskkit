import type { Metadata } from "next";
import { CategoryPage } from "@/components/CategoryPage";

export const metadata: Metadata = { title: "Free Online Converters", description: "Convert text and files privately with focused tools that run in your browser.", alternates: { canonical: "/converters" } };
export default function ConvertersPage() { return <CategoryPage category="Converters" />; }
