import type { Metadata } from "next";
import { SvgEditorTool } from "@/components/tools/SvgEditorTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = { title: "Free Online SVG Editor - Edit & Export", description: "Open or paste SVG code, preview changes safely and export a clean SVG locally in your browser." };
const tool = getTool("svg");
export default function SvgPage() {
  return <ToolShell tool={tool} intro="Open or paste SVG source, make precise code changes, preview the result safely, and download the cleaned vector file." steps={["Paste SVG markup or open a local .svg file.", "Edit its shapes, colors, dimensions or viewBox in the source panel.", "Review the safe preview and download the cleaned SVG."]} features={[{ title: "Live validation", text: "Malformed XML and non-SVG files are identified before preview or export." }, { title: "Safer preview", text: "Scripts, event handlers, embedded documents and external links are removed from the preview." }, { title: "Vector output", text: "Keep the resolution-independent advantages of SVG for web and print." }]} faqs={[{ question: "Are SVG files edited locally?", answer: "Yes. Source parsing, cleanup, preview and download happen in your browser." }, { question: "What is an SVG viewBox?", answer: "The viewBox defines the internal coordinate system and lets the graphic scale without distortion." }, { question: "Is unsafe content removed?", answer: "The downloadable preview removes common active-content vectors, including scripts, event attributes, embedded documents and external resource links." }, { question: "When should I use SVG instead of PNG?", answer: "SVG is ideal for logos, icons and diagrams that must remain sharp at many sizes. PNG is better for complex pixel imagery." }]}><SvgEditorTool /></ToolShell>;
}
