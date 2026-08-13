import { ToolCard } from "@/components/ToolCard";
import { toolsForCategory, type ToolCategory } from "@/lib/tools";

const copy: Record<ToolCategory, { lead: string; body: string }> = {
  Generators: {
    lead: "Create useful codes and sounds directly in your browser.",
    body: "Every generator opens instantly, keeps your inputs on this device, and gives you a practical result to download or use right away.",
  },
  Converters: {
    lead: "Turn everyday files and content into formats that are easier to share.",
    body: "WebTaskKit converters are designed around small, clear workflows. Your content is processed locally whenever the browser can do the work.",
  },
  Editors: {
    lead: "Make focused edits without installing a full desktop application.",
    body: "Open or paste your content, make the change, and download a clean result. No account and no server upload are required.",
  },
};

export function CategoryPage({ category }: { category: ToolCategory }) {
  const categoryTools = toolsForCategory(category);
  return (
    <main>
      <section className="page-hero section-wrap">
        <div className="breadcrumbs"><a href="/">Home</a><span>/</span><span>{category}</span></div>
        <p className="eyebrow">WebTaskKit collection</p>
        <h1>{category}</h1>
        <p className="page-lead">{copy[category].lead}</p>
        <p className="page-copy">{copy[category].body}</p>
      </section>
      <section className="section-wrap category-tool-section" aria-labelledby="category-tools-title">
        <div className="section-heading"><p className="eyebrow">Ready when you are</p><h2 id="category-tools-title">Choose a tool</h2></div>
        <div className="tool-grid">{categoryTools.map((tool) => <ToolCard key={tool.href} tool={tool} />)}</div>
      </section>
    </main>
  );
}
