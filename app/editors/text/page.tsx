import type { Metadata } from "next";
import { TextEditorTool } from "@/components/tools/TextEditorTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Free Online Text Editor - Write & Download",
  description: "Write, clean and transform plain text with live counts, then copy or download it privately.",
  alternates: { canonical: "/editors/text" },
};

const tool = getTool("text");

export default function TextPage() {
  return (
    <ToolShell
      tool={tool}
      intro="Write, paste and clean plain text without an account. Track useful counts, apply quick transformations, and download the result as a TXT file."
      steps={[
        "Type, paste or open a TXT, Markdown or log file up to 500 KB.",
        "Review the live counts, then apply one cleanup, case conversion or line-sort action at a time.",
        "Proofread the result and copy it or download a UTF-8 TXT file before closing the tab.",
      ]}
      features={[
        { title: "Useful live counts", text: "See words, Unicode characters, lines and estimated reading time while you work." },
        { title: "Focused transformations", text: "Normalize spacing, change letter case or sort a newline-separated list." },
        { title: "Local by default", text: "Your document stays in this tab and is not autosaved or uploaded." },
      ]}
      practicalExamples={[
        { title: "Clean copied notes", text: "Collapse repeated spaces, trim line endings and reduce oversized blank gaps after copying from email, chat or a document." },
        { title: "Normalize a short list", text: "Put one item on each line, sort the lines alphabetically and review duplicates manually before downloading the result." },
        { title: "Check content length", text: "Use word, character and reading-time estimates to fit a brief, description or script before moving it into its final system." },
      ]}
      decisionGuide={[
        { title: "Use plain text for portability", text: "TXT works well for notes, configuration fragments, logs and lists that should open consistently without fonts or layout." },
        { title: "Transform a copy when wording matters", text: "Case changes and line sorting apply to the entire document. Keep an original copy if capitalization, order or whitespace carries meaning." },
        { title: "Use a rich editor for formatted documents", text: "Choose a word processor or Markdown editor when you need headings, links, comments, images or collaborative revision history." },
      ]}
      limitations={[
        "The editor accepts up to 500 KB and opens TXT, MD and LOG files as plain text; it does not render Markdown.",
        "Nothing is autosaved. Copy or download the result before refreshing, navigating away or closing the tab.",
        "Title case follows a general language-aware rule and may change acronyms, product names or intentionally unusual capitalization. Proofread after conversion.",
        "Editing happens locally and WebTaskKit does not receive the text. Browser extensions and the device itself remain outside that guarantee.",
      ]}
      workflowLinks={[
        { href: "/converters/txt-to-pdf", label: "Turn the final copy into PDF", text: "Add an optional title, choose A4 or Letter and create a simple paginated document locally." },
        { href: "/generators/qr-code", label: "Encode short text or a link", text: "Create a scannable code after removing accidental spaces and confirming the exact payload." },
        { href: "/editors/svg", label: "Editing vector source?", text: "Use the SVG editor when XML validation and a visual preview matter more than general text cleanup." },
      ]}
      faqs={[
        { question: "Is my text saved or uploaded?", answer: "No. It stays in the current browser tab unless you choose to copy or download it. Because it is not autosaved, save your work before leaving." },
        { question: "Does it support rich text?", answer: "This editor intentionally works with plain text, making the output portable and predictable. Formatting such as headings, bold text and images is not retained." },
        { question: "How are words counted?", answer: "The editor uses browser-aware word segmentation where available, with a whitespace-based fallback. Counts can differ slightly from other editors for hyphens and some languages." },
        { question: "Which encoding is used for downloads?", answer: "Downloaded files use UTF-8, which is widely supported by modern editors and operating systems." },
      ]}
    >
      <TextEditorTool />
    </ToolShell>
  );
}
