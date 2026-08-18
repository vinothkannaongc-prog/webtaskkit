import type { Metadata } from "next";
import { PdfToImageTool } from "@/components/tools/PdfToImageTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

const title = "PDF to JPG Converter - Export PDF Pages as Images";
const description = "Convert selected PDF pages to JPG or PNG locally in your browser. Download one image or a neatly named ZIP, with no upload or signup.";
const canonical = "/converters/pdf-to-jpg";

export const metadata: Metadata = {
  title,
  description,
  keywords: ["PDF to JPG", "PDF to PNG", "convert PDF pages to images", "PDF page image converter"],
  alternates: { canonical },
  openGraph: {
    type: "website",
    url: canonical,
    siteName: "WebTaskKit",
    title,
    description,
    images: [],
  },
  twitter: { card: "summary", title, description, images: [] },
};

const tool = getTool("pdf-to-jpg");

export default function PdfToJpgPage() {
  return (
    <ToolShell
      tool={tool}
      intro="Turn the PDF pages you choose into JPG or PNG images, then download a single image or one orderly ZIP without sending the document to a server."
      privacyNote="The PDF is parsed, rendered and encoded on this device. WebTaskKit does not receive the document, page images or filenames."
      steps={[
        "Choose one unprotected PDF. The converter checks its header, file size and page count locally before enabling the output controls.",
        "Enter all or a page range such as 1-3,5, then choose JPG or PNG and a practical render resolution.",
        "Convert and open the download. A single page downloads as one image; multiple pages arrive in a ZIP with page-numbered filenames.",
      ]}
      features={[
        { title: "PDF content stays local", text: "A bundled PDF.js worker reads document bytes from browser memory. The source PDF and rendered images are not uploaded to WebTaskKit." },
        { title: "Choose only useful pages", text: "Forward ranges, duplicate removal and document-order output make it easy to export a cover, a figure or a bounded group of pages." },
        { title: "Predictable downloads", text: "One selected page becomes a directly downloadable image. Two or more pages are packaged into one ZIP with stable, padded page numbers." },
      ]}
      practicalExamples={[
        { title: "Share one slide as an image", text: "Export a single presentation page as JPG for a message, preview or content-management system that expects an image." },
        { title: "Capture charts for a draft", text: "Choose only the pages containing charts, use PNG for crisp labels, and review each image before placing it in another document." },
        { title: "Make page thumbnails", text: "Render a short page range at 108 DPI to create compact visual references without sending the source PDF to an online conversion service." },
      ]}
      decisionGuide={[
        { title: "JPG for scans and photographs", text: "JPG usually produces smaller downloads for photographed or scanned pages. Its compression is lossy, so inspect small text and line art." },
        { title: "PNG for flat graphics and text", text: "PNG preserves exact rendered pixels and often keeps diagrams or interface captures crisp, but complex pages may create much larger files." },
        { title: "Start at 144 DPI", text: "The recommended setting balances readability and browser memory for common A4 and Letter pages. Move higher only when fine detail needs it." },
      ]}
      limitations={[
        "Password-protected, damaged and unusually structured PDFs may not open. Remove protection only in a trusted PDF application and keep the original document.",
        "The output is a raster picture. Text is no longer selectable or searchable, and this tool does not run OCR or preserve an accessible reading order.",
        "Interactive form fields, links, comments and other annotation layers are not exported. Only the rendered page content is intended to appear in the image.",
        "PDF color profiles, transparency and specialty print features can display differently in a browser. Check brand colors and fine detail before publishing or printing.",
        "To protect browser stability, the converter limits source bytes, document pages, selected pages, page dimensions, total rendered pixels, processing work and encoded output size. Inspection stops after 30 seconds and a conversion stops after two minutes.",
        "The tool does not edit, reorder, merge or split PDF pages. It creates JPG or PNG representations of the selected pages only.",
      ]}
      workflowLinks={[
        { href: "/converters/image-to-pdf", label: "Image to PDF", text: "Combine reviewed JPG and PNG files into a new ordered A4 or Letter PDF." },
        { href: "/converters/txt-to-pdf", label: "TXT to PDF", text: "Turn plain-text notes into a readable PDF before sharing them." },
        { href: "/editors/text", label: "Text editor", text: "Prepare captions, alt-text drafts or accompanying notes for the exported page images." },
      ]}
      faqs={[
        { question: "Is my PDF uploaded?", answer: "No. The selected PDF is read from browser memory by a same-origin PDF.js worker, and page images are encoded locally. WebTaskKit does not receive the document or output files." },
        { question: "Can I convert PDF pages to PNG instead of JPG?", answer: "Yes. Use the output format control on this page. JPG is usually smaller for scans and photos; PNG is lossless and often better for flat graphics or sharp interface text." },
        { question: "How do I export only certain pages?", answer: "Enter individual pages or forward ranges separated by commas, such as 1-3,5. Duplicate selections are removed and images are created in the PDF's page order." },
        { question: "Why do multiple pages download as a ZIP?", answer: "Browsers handle one deliberate download more reliably than a burst of separate downloads. Each ZIP entry includes its original PDF page number, padded for correct sorting." },
        { question: "What resolution should I choose?", answer: "Start with the recommended 144 DPI option. Use 108 DPI for smaller previews or 180 DPI when fine details need closer inspection, subject to the page and memory limits." },
        { question: "Will form entries and comments appear?", answer: "Interactive annotation layers are not exported. A value or mark appears only if it is already flattened into the PDF page content. Check the images before relying on them." },
        { question: "Why was my page selection rejected?", answer: "The converter permits PDFs up to 100 pages and exports up to 30 pages at a time. It also rejects page dimensions, total pixel work or encoded outputs that exceed browser-safety limits." },
        { question: "Can I stop a conversion?", answer: "Yes. Use Cancel while the PDF is being read, rendered or packed. Active rendering, parsing and ZIP work is stopped, no download is created, and you can adjust the selection before trying again." },
      ]}
    >
      <PdfToImageTool />
    </ToolShell>
  );
}
