import type { Metadata } from "next";
import { TextEditorTool } from "@/components/tools/TextEditorTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = { title: "Free Online Text Editor - Write & Download", description: "Write, clean and transform plain text with live counts, then copy or download it privately." };
const tool = getTool("text");
export default function TextPage() {
  return <ToolShell tool={tool} intro="Write, paste and clean plain text without an account. Track useful counts, apply quick transformations, and download the result as a TXT file." steps={["Type, paste or open a plain-text file.", "Review the live counts and use a focused cleanup or case action.", "Copy the result or download it as a UTF-8 TXT file."]} features={[{ title: "Useful live counts", text: "See words, characters, lines and estimated reading time while you work." }, { title: "Quick cleanup", text: "Normalize spacing or switch between upper, lower and title case." }, { title: "Local by default", text: "Your document stays in this tab and is not autosaved or uploaded." }]} faqs={[{ question: "Is my text saved or uploaded?", answer: "No. It stays in the current browser tab unless you choose to copy or download it." }, { question: "Does it support rich text?", answer: "This editor intentionally works with plain text, making the output portable and predictable." }, { question: "How are words counted?", answer: "The editor uses browser-aware word segmentation where available, with a whitespace-based fallback." }, { question: "Which encoding is used for downloads?", answer: "Downloaded files use UTF-8, which is widely supported by modern editors and operating systems." }]}><TextEditorTool /></ToolShell>;
}
