import type { Metadata } from "next";
import { TxtToPdfTool } from "@/components/tools/TxtToPdfTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = {
  title: "TXT to PDF Converter - Free & Private",
  description: "Convert pasted text or a TXT file into a clean PDF in your browser. Choose page size and typography, with no upload.",
  alternates: { canonical: "/converters/txt-to-pdf" },
};

const tool = getTool("txt-to-pdf");

export default function TxtToPdfPage() {
  return (
    <ToolShell
      tool={tool}
      intro="Paste text or open a TXT file, choose how the page should look, and download a clean PDF generated directly in your browser."
      steps={[
        "Paste text or open a TXT, Markdown or log file up to 500 KB.",
        "Choose A4 or US Letter, then set a readable type size, margin and optional title.",
        "Create the PDF, open the download and check page breaks and character rendering before sharing it.",
      ]}
      features={[
        { title: "Local conversion", text: "The document is assembled in your browser, so the source text stays on this device." },
        { title: "Readable pagination", text: "Lines wrap to the page width and flow automatically across pages while blank lines are preserved." },
        { title: "Practical controls", text: "Choose A4 or Letter, margins, font size and a useful document title and filename." },
      ]}
      practicalExamples={[
        { title: "Meeting notes and handoffs", text: "Clean the notes, add a descriptive title and export a fixed-layout copy that colleagues can read without the original editor." },
        { title: "Logs and diagnostic records", text: "Convert a selected plain-text log into a paginated attachment while keeping line breaks and blank separators readable." },
        { title: "Simple printable instructions", text: "Turn a checklist, recipe or procedure into an A4 or Letter PDF without sending the source text to an upload service." },
      ]}
      decisionGuide={[
        { title: "A4 or Letter should match the reader", text: "Use A4 for most international workflows and US Letter where that is the expected office-paper standard." },
        { title: "Leave room before shrinking the type", text: "Use comfortable margins for printing and annotation. A smaller font fits more per page but makes long documents harder to scan." },
        { title: "Use a document editor for rich layouts", text: "This converter is best for plain text. Choose a word processor when you need headings, tables, images, clickable links or precise styling." },
      ]}
      limitations={[
        "Input is limited to 500 KB and supported uploads are TXT, MD and LOG files.",
        "Markdown symbols are treated as ordinary text; the converter does not render Markdown formatting.",
        "The built-in PDF font is best for Latin text. Complex scripts, many symbols and emoji may not render correctly.",
        "Conversion happens locally, but the downloaded PDF becomes an ordinary file that you are responsible for storing and sharing safely.",
      ]}
      workflowLinks={[
        { href: "/editors/text", label: "Clean the source text", text: "Normalize spacing, sort lines, review counts and finalize the wording before conversion." },
        { href: "/generators/qr-code", label: "Link to the finished document", text: "After hosting the PDF somewhere appropriate, create a QR code for its public share link." },
        { href: "/editors/svg", label: "Working with vector artwork?", text: "Use the SVG editor separately when the task requires editing an illustration rather than plain text." },
      ]}
      faqs={[
        { question: "Is my text uploaded to a server?", answer: "No. The PDF is created on your device and downloaded directly by your browser." },
        { question: "Does TXT-to-PDF preserve formatting?", answer: "It preserves line breaks and blank lines, expands tabs and wraps long text. It does not recreate rich-text or Markdown styling." },
        { question: "Are all languages supported?", answer: "The lightweight built-in PDF font is best for Latin text. For complex scripts and emoji, use an application with the needed fonts or your browser's Print and Save as PDF workflow." },
        { question: "Can I use it on a phone?", answer: "Yes, although large documents are easier to review on a larger screen. Always open the result and check the page breaks before sharing it." },
      ]}
    >
      <TxtToPdfTool />
    </ToolShell>
  );
}
