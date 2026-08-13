import type { Metadata } from "next";
import { BarcodeTool } from "@/components/tools/BarcodeTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Free Barcode Generator - UPC, EAN & Code 128",
  description: "Generate Code 128, UPC, EAN and ITF barcodes in your browser, then download SVG or PNG.",
  alternates: { canonical: "/generators/barcode" },
};

const tool = getTool("barcode");

export default function BarcodePage() {
  return (
    <ToolShell
      tool={tool}
      intro="Choose a common barcode format, enter valid data, adjust its size and label, and export a clean SVG or high-resolution PNG."
      steps={[
        "Choose the symbology that the receiving scanner or database expects.",
        "Enter the identifier, then adjust bar width, height, colors and the visible label.",
        "Print at the intended size and test with the actual scanner before using it in production.",
      ]}
      features={[
        { title: "Common standards", text: "Create CODE128, EAN-13, UPC-A, EAN-8 and ITF-14 barcode images." },
        { title: "Check-digit help", text: "Retail formats calculate a missing check digit and validate a supplied one." },
        { title: "Vector or raster", text: "Download editable SVG for print workflows or a high-resolution PNG for everyday use." },
      ]}
      practicalExamples={[
        { title: "Internal stock labels", text: "Use Code 128 for letters, numbers and common punctuation when your own inventory system controls the identifier." },
        { title: "Retail product artwork", text: "Render an assigned UPC-A or EAN number for packaging, then verify size, contrast and scanning in the final printed design." },
        { title: "Outer cartons", text: "Use ITF-14 when a trading partner or logistics specification calls for a 14-digit shipping-container code." },
      ]}
      decisionGuide={[
        { title: "Code 128 for flexible internal IDs", text: "It handles printable ASCII text and is a practical choice for warehouse bins, assets and order references that are not retail GTINs." },
        { title: "UPC-A, EAN-13 or EAN-8 for assigned retail numbers", text: "Match the format to the identifier you have been issued. The tool can calculate a check digit, but it cannot create ownership of a number." },
        { title: "SVG when print quality matters", text: "Choose SVG for packaging or label software that accepts vectors. Choose PNG only when the destination application needs a bitmap." },
      ]}
      limitations={[
        "This tool draws a barcode; it does not issue, license or register UPC, EAN or GTIN identifiers.",
        "Code 128 input is limited here to 80 printable ASCII characters so the result remains manageable.",
        "A valid preview is not a production guarantee. Printer resolution, scaling, ink spread, material and scanner settings all affect readability.",
        "Values are processed locally and are not uploaded, but your own exported files may still contain business-sensitive identifiers.",
      ]}
      workflowLinks={[
        { href: "/generators/qr-code", label: "Link to web content", text: "Choose a QR code when the payload is a URL or longer text meant for phone cameras." },
        { href: "/editors/svg", label: "Review an SVG export", text: "Inspect the vector markup or dimensions before handing the barcode to a print workflow." },
        { href: "/editors/text", label: "Prepare an identifier list", text: "Clean spaces, normalize case or sort plain-text item references before generating labels." },
      ]}
      faqs={[
        { question: "Does this tool issue official UPC numbers?", answer: "No. It creates the barcode image only. Obtain and register official retail identifiers through the appropriate standards organization." },
        { question: "What is Code 128 best for?", answer: "Code 128 is compact and flexible, making it useful for logistics, inventory and internal labels when the receiving system supports it." },
        { question: "Are check digits added automatically?", answer: "For supported numeric formats, a missing check digit is calculated. A supplied check digit is validated." },
        { question: "How should I test a barcode?", answer: "Place it in the final artwork, print on the intended material and scan several samples with the hardware and software used in your workflow." },
      ]}
    >
      <BarcodeTool />
    </ToolShell>
  );
}
