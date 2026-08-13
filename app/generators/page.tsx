import type { Metadata } from "next";
import { CategoryPage } from "@/components/CategoryPage";

export const metadata: Metadata = { title: "Free Online Generators", description: "Create QR codes, barcodes and precise audio tones privately in your browser." };
export default function GeneratorsPage() { return <CategoryPage category="Generators" />; }
