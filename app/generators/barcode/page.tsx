import type { Metadata } from "next";
import { BarcodeTool } from "@/components/tools/BarcodeTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = { title: "Free Barcode Generator - UPC, EAN & Code 128", description: "Generate Code 128, UPC, EAN and ITF barcodes in your browser, then download SVG or PNG." };
const tool = getTool("barcode");
export default function BarcodePage() {
  return <ToolShell tool={tool} intro="Choose a common barcode format, enter valid data, adjust its size and label, and export a clean SVG or high-resolution PNG." steps={["Choose the barcode format that matches your system.", "Enter the data and adjust the dimensions or label.", "Test the preview with your scanner, then download it."]} features={[{ title: "Common standards", text: "Create CODE128, EAN-13, UPC-A, EAN-8 and ITF-14 barcode images." }, { title: "Check-digit help", text: "Retail formats calculate a missing check digit and validate a supplied one." }, { title: "Vector or raster", text: "Download editable SVG or a high-resolution PNG for everyday use." }]} faqs={[{ question: "Does this tool issue official UPC numbers?", answer: "No. It creates the barcode image only. Obtain and register official retail identifiers through the appropriate standards organization." }, { question: "What is Code 128 best for?", answer: "Code 128 is compact and flexible, making it useful for logistics, inventory and internal labels." }, { question: "Are check digits added automatically?", answer: "For supported numeric formats, a missing check digit is calculated. A supplied check digit is validated." }, { question: "How should I test a barcode?", answer: "Print at the intended size and scan it with the actual hardware and software used in your workflow." }]}><BarcodeTool /></ToolShell>;
}
