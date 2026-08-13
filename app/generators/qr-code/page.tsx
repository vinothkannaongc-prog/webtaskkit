import type { Metadata } from "next";
import { QRCodeTool } from "@/components/tools/QRCodeTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Free QR Code Generator - PNG & SVG",
  description: "Create a custom QR code for a link or text and download PNG or SVG. Free, private and no signup.",
  alternates: { canonical: "/generators/qr-code" },
};

const tool = getTool("qr-code");

export default function QRCodePage() {
  return (
    <ToolShell
      tool={tool}
      intro="Turn links, text and contact details into a scannable QR code. Customize the colors and size, then download a crisp PNG or SVG."
      steps={[
        "Enter the final link or text you want the code to contain.",
        "Choose its size, colors, margin and error-correction level.",
        "Scan the preview on more than one phone, then download PNG or SVG.",
      ]}
      features={[
        { title: "Static and dependable", text: "The destination is encoded directly in the image, so the QR code does not depend on a WebTaskKit redirect." },
        { title: "Print-friendly output", text: "Export a high-resolution PNG for everyday documents or scalable SVG for layouts and signage." },
        { title: "Private generation", text: "Your content is encoded on this device and never sent to our servers." },
      ]}
      practicalExamples={[
        { title: "Printed menus and instructions", text: "Encode the final public URL, export SVG for the layout, and scan a physical proof before printing the full batch." },
        { title: "Event handouts", text: "Link directly to a registration page, map or shared schedule. A wider quiet margin helps when the code sits near other design elements." },
        { title: "Contact and follow-up cards", text: "Encode a short mailto:, tel: or public profile link so a recipient can act without retyping it." },
      ]}
      decisionGuide={[
        { title: "PNG for slides, email and office documents", text: "Choose 1024 px or 2048 px when the image may be resized. Avoid screenshots, which can soften module edges." },
        { title: "SVG for professional print", text: "Vector output stays sharp when a designer scales it for cards, posters or packaging." },
        { title: "Higher correction is not always better", text: "Q or H can tolerate more damage, but adds denser modules. Start with M for an undisturbed code and test at the final size." },
      ]}
      limitations={[
        "A static QR code cannot be redirected after printing; changing the destination requires a new code.",
        "The generator encodes what you enter but does not verify that a URL is safe, public or permanently available.",
        "Generation is local, but anyone who can scan the finished code can read its contents. Do not encode passwords or private data.",
      ]}
      workflowLinks={[
        { href: "/editors/text", label: "Clean the destination text", text: "Remove stray spaces or line breaks before encoding a longer text payload." },
        { href: "/editors/svg", label: "Inspect the vector file", text: "Open the downloaded SVG to review its dimensions and source before placing it in a design." },
        { href: "/generators/barcode", label: "Need an item identifier?", text: "Use a one-dimensional barcode when the receiving inventory or retail system expects one." },
      ]}
      faqs={[
        { question: "Do generated QR codes expire?", answer: "No. These are static QR codes, so they continue to work as long as the encoded content remains useful and any linked destination remains available." },
        { question: "Is the information inside my QR code stored?", answer: "No. Generation happens locally in your browser and WebTaskKit does not receive the content." },
        { question: "Which colors scan best?", answer: "Use a dark foreground on a light background, preserve the blank margin around the code and test the final physical or digital version." },
        { question: "Is SVG or PNG better for printing?", answer: "SVG scales cleanly for professional print. PNG is convenient for documents, email and web pages when used at sufficient resolution." },
      ]}
    >
      <QRCodeTool />
    </ToolShell>
  );
}
