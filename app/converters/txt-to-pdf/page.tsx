import type { Metadata } from "next";
import { TxtToPdfTool } from "@/components/tools/TxtToPdfTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = { title: "TXT to PDF Converter - Free & Private", description: "Convert pasted text or a TXT file into a clean PDF in your browser. Choose page size and typography, with no upload.", alternates: { canonical: "/converters/txt-to-pdf" } };
const tool = getTool("txt-to-pdf");
export default function TxtToPdfPage() {
  return <ToolShell tool={tool} intro="Paste text or open a TXT file, choose how the page should look, and download a clean PDF generated directly in your browser." steps={["Paste text or open a .txt, .md or .log file.", "Choose page size, margins, type size and document title.", "Create and download the PDF without uploading your content."]} features={[{ title: "Local conversion", text: "The document is assembled in your browser, so the source text stays on this device." }, { title: "Readable pagination", text: "Lines wrap to the page width and flow automatically across pages." }, { title: "Practical controls", text: "Choose A4 or Letter, margins, font size and a useful filename." }]} faqs={[{ question: "Is my text uploaded to a server?", answer: "No. The PDF is created on your device and downloaded directly by your browser." }, { question: "Does TXT-to-PDF preserve formatting?", answer: "It preserves line breaks and blank lines, expands tabs and wraps long text. Rich-text styling is not part of plain TXT files." }, { question: "Are all languages supported?", answer: "The lightweight built-in PDF font is best for Latin text. Complex scripts and emoji may require your browser's Print and Save as PDF workflow." }, { question: "Can I use it on a phone?", answer: "Yes, although large documents are easier to review on a larger screen." }]}><TxtToPdfTool /></ToolShell>;
}
