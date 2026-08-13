import type { Metadata } from "next";
import { SvgEditorTool } from "@/components/tools/SvgEditorTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Free Online SVG Editor - Edit & Export",
  description: "Open or paste SVG code, preview changes safely and export a clean SVG locally in your browser.",
  alternates: { canonical: "/editors/svg" },
};

const tool = getTool("svg");

export default function SvgPage() {
  return (
    <ToolShell
      tool={tool}
      intro="Open or paste SVG source, make precise code changes, preview the result safely, and download the cleaned vector file."
      steps={[
        "Paste SVG markup or open a local SVG file up to 750 KB.",
        "Edit shapes, colors, dimensions, accessible text or the viewBox in the source panel.",
        "Read the cleanup notice, review the sandboxed preview and download the cleaned SVG.",
      ]}
      features={[
        { title: "Live validation", text: "Malformed XML, non-SVG documents and unsupported declarations are identified before export." },
        { title: "Safer preview", text: "Scripts, event handlers, embedded documents, stylesheets and external resource links are removed." },
        { title: "Vector output", text: "Keep the resolution-independent advantages of SVG for interfaces, diagrams and print artwork." },
      ]}
      practicalExamples={[
        { title: "Recolor an icon or logo", text: "Find a fill or stroke value, replace it with the approved color and confirm every shape in the live preview." },
        { title: "Repair scaling behavior", text: "Review width, height and viewBox values when artwork crops, stretches or refuses to fit a responsive container." },
        { title: "Inspect a downloaded asset", text: "Open unfamiliar SVG source, note what the cleaner removes and export a simpler local copy before placing it in a project." },
      ]}
      decisionGuide={[
        { title: "Use source editing for precise changes", text: "This editor suits known adjustments such as color values, coordinates, labels and dimensions. A visual drawing application is better for freehand design." },
        { title: "Keep a viewBox for flexible scaling", text: "A correct viewBox gives the browser an internal coordinate system, allowing the artwork to resize without changing every path." },
        { title: "Choose SVG for graphic shapes, not photos", text: "Logos, icons and diagrams usually benefit from vector output. Detailed photographs are generally smaller and more predictable as raster images." },
      ]}
      limitations={[
        "Files are limited to 750 KB, and the source must be well-formed XML with an SVG root element.",
        "Cleaning removes scripts, embedded documents, style elements, event handlers and external references, so an asset that depends on them may look different.",
        "The cleaner reduces common active-content risks but is not a substitute for your application's own security review and content policy.",
        "Editing and preview happen locally; WebTaskKit does not upload the SVG source or the cleaned download.",
      ]}
      workflowLinks={[
        { href: "/generators/qr-code", label: "Create a scalable QR code", text: "Generate a QR code as SVG, then inspect its dimensions before using it in print artwork." },
        { href: "/generators/barcode", label: "Create a vector barcode", text: "Export a standards-based barcode as SVG when a label or packaging workflow needs crisp lines." },
        { href: "/editors/text", label: "Prepare accessible labels", text: "Draft concise title and description text before adding it to an SVG's accessible markup." },
      ]}
      faqs={[
        { question: "Are SVG files edited locally?", answer: "Yes. Source parsing, cleanup, preview and download happen in your browser." },
        { question: "What is an SVG viewBox?", answer: "The viewBox defines the internal coordinate system and lets the graphic scale while preserving its proportions when configured correctly." },
        { question: "Is unsafe content removed?", answer: "The downloadable result removes common active-content vectors, including scripts, event attributes, embedded documents, style elements and external resource links. Review untrusted assets within your own security process as well." },
        { question: "When should I use SVG instead of PNG?", answer: "SVG is ideal for logos, icons and diagrams that must remain sharp at many sizes. PNG is generally better for complex pixel imagery and applications that do not accept SVG." },
      ]}
    >
      <SvgEditorTool />
    </ToolShell>
  );
}
