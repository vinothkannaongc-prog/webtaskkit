import Link from "next/link";
import type { ToolDefinition } from "@/lib/tools";

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  return (
    <Link className={`tool-card accent-${tool.accent}`} href={tool.href}>
      <div className="tool-card__top">
        <span className="tool-symbol" aria-hidden="true">{tool.symbol}</span>
        <span className="tool-category">{tool.category}</span>
      </div>
      <h3>{tool.name}</h3>
      <p>{tool.description}</p>
      <span className="tool-card__action">Open tool <span aria-hidden="true">→</span></span>
    </Link>
  );
}
