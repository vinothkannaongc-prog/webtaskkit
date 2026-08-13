"use client";

import { useMemo, useState } from "react";
import { ToolCard } from "./ToolCard";
import { tools } from "@/lib/tools";

export function ToolFinder() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter((tool) =>
      `${tool.name} ${tool.category} ${tool.description}`.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <section className="tools-section section-wrap" id="tools">
      <div className="section-heading section-heading--split">
        <div>
          <p className="eyebrow">The launch collection</p>
          <h2>Start with a tool</h2>
        </div>
        <label className="tool-search">
          <span className="sr-only">Search tools</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a tool"
          />
        </label>
      </div>
      {filtered.length ? (
        <div className="tool-grid">
          {filtered.map((tool) => <ToolCard key={tool.href} tool={tool} />)}
        </div>
      ) : (
        <div className="empty-state">No tool matches “{query}” yet.</div>
      )}
    </section>
  );
}
