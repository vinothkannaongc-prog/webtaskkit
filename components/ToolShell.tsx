import type { ReactNode } from "react";
import { ToolCard } from "./ToolCard";
import { categoryPath, tools, type ToolDefinition } from "@/lib/tools";

type FAQ = { question: string; answer: string };
type PracticalExample = { title: string; text: string };
type DecisionPoint = { title: string; text: string };
type WorkflowLink = { href: string; label: string; text: string };
type ReferenceLink = { href: string; label: string; text: string };

type ToolShellProps = {
  tool: ToolDefinition;
  intro: string;
  children: ReactNode;
  steps: string[];
  features: { title: string; text: string }[];
  faqs: FAQ[];
  practicalExamples: PracticalExample[];
  decisionGuide: DecisionPoint[];
  limitations: string[];
  workflowLinks: WorkflowLink[];
  references?: ReferenceLink[];
  referenceNote?: string;
  privacyNote?: string;
};

const siteUrl = "https://webtaskkit.com";

const relatedToolSlugs: Record<string, string[]> = {
  "qr-code": ["barcode", "tone", "svg"],
  barcode: ["qr-code", "tone", "txt-to-pdf"],
  "txt-to-pdf": ["image-to-pdf", "pdf-to-jpg", "text"],
  "image-to-pdf": ["pdf-to-jpg", "txt-to-pdf", "svg"],
  "pdf-to-jpg": ["image-to-pdf", "txt-to-pdf", "text"],
  svg: ["text", "qr-code", "barcode"],
  text: ["svg", "txt-to-pdf", "qr-code"],
  tone: ["qr-code", "barcode", "text"],
  "on-page-seo-audit": ["robots-sitemap-validator", "text", "qr-code"],
  "robots-sitemap-validator": ["on-page-seo-audit", "text", "qr-code"],
};

export function ToolShell({
  tool,
  intro,
  children,
  steps,
  features,
  faqs,
  practicalExamples,
  decisionGuide,
  limitations,
  workflowLinks,
  references = [],
  referenceNote,
  privacyNote = "This tool runs locally in your browser. Your input is not uploaded to WebTaskKit.",
}: ToolShellProps) {
  const related = (relatedToolSlugs[tool.slug] ?? [])
    .map((slug) => tools.find((item) => item.slug === slug))
    .filter((item): item is ToolDefinition => Boolean(item));
  const toolUrl = `${siteUrl}${tool.href}`;
  const categoryHref = categoryPath(tool.category);
  const categoryUrl = `${siteUrl}${categoryHref}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: `${tool.name} by WebTaskKit`,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any modern web browser",
        description: intro,
        url: toolUrl,
        isAccessibleForFree: true,
        publisher: { "@type": "Organization", name: "WebTaskKit", url: siteUrl },
        offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
          { "@type": "ListItem", position: 2, name: tool.category, item: categoryUrl },
          { "@type": "ListItem", position: 3, name: tool.name, item: toolUrl },
        ],
      },
    ],
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="tool-hero section-wrap">
        <div className="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span aria-hidden="true">/</span>
          <a href={categoryHref}>{tool.category}</a><span aria-hidden="true">/</span>
          <span>{tool.shortName}</span>
        </div>
        <div className="tool-title-row">
          <span className={`tool-symbol tool-symbol--large accent-${tool.accent}`} aria-hidden="true">{tool.symbol}</span>
          <div>
            <p className="eyebrow">Free · no signup</p>
            <h1>{tool.name}</h1>
            <p className="tool-intro">{intro}</p>
          </div>
        </div>
      </section>

      <section className="tool-workspace-wrap section-wrap" aria-label={`${tool.name} workspace`}>
        {children}
        <div className="local-note"><span aria-hidden="true">●</span>{privacyNote}</div>
      </section>

      <section className="content-section section-wrap">
        <div className="reading-column">
          <p className="eyebrow">Simple by design</p>
          <h2>How to use {tool.shortName}</h2>
          <ol className="steps-list">
            {steps.map((step, index) => (
              <li key={step}><span>{index + 1}</span><p>{step}</p></li>
            ))}
          </ol>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="feature-card">
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="practical-section section-wrap" aria-labelledby="practical-title">
        <div className="section-heading">
          <p className="eyebrow">Put it to work</p>
          <h2 id="practical-title">Practical ways to use {tool.shortName}</h2>
        </div>
        <div className="practical-example-grid">
          {practicalExamples.map((example) => (
            <article key={example.title} className="practical-example-card">
              <h3>{example.title}</h3>
              <p>{example.text}</p>
            </article>
          ))}
        </div>

        <div className="decision-grid">
          <article className="decision-panel">
            <p className="eyebrow">Choose deliberately</p>
            <h2>Make the right output</h2>
            <div className="decision-list">
              {decisionGuide.map((item) => (
                <div key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </article>
          <aside className="limits-panel" aria-labelledby="limits-title">
            <p className="eyebrow">Know the boundaries</p>
            <h2 id="limits-title">Before you rely on the result</h2>
            <ul>
              {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </aside>
        </div>

        <div className="workflow-panel">
          <div>
            <p className="eyebrow">Continue the workflow</p>
            <h2>Useful next steps</h2>
          </div>
          <div className="workflow-link-list">
            {workflowLinks.map((link) => (
              <a key={link.href} href={link.href}>
                <strong>{link.label}<span aria-hidden="true"> &rarr;</span></strong>
                <span>{link.text}</span>
              </a>
            ))}
          </div>
        </div>

        {references.length ? (
          <div className="reference-panel" id="source-guidance">
            <div>
              <p className="eyebrow">Primary guidance</p>
              <h2>What the checks are based on</h2>
              {referenceNote ? <p>{referenceNote}</p> : null}
            </div>
            <nav className="reference-link-list" aria-label="Primary technical references">
              {references.map((reference) => (
                <a key={reference.href} href={reference.href} target="_blank" rel="noopener noreferrer">
                  <strong>{reference.label}<span aria-hidden="true"> ↗</span></strong>
                  <span>{reference.text}</span>
                </a>
              ))}
            </nav>
          </div>
        ) : null}
      </section>

      <section className="faq-section section-wrap">
        <div className="section-heading"><p className="eyebrow">Good to know</p><h2>Frequently asked questions</h2></div>
        <div className="faq-list">
          {faqs.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}<span aria-hidden="true">+</span></summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="related-section section-wrap">
        <div className="section-heading"><p className="eyebrow">Keep working</p><h2>Related tools</h2></div>
        <div className="tool-grid tool-grid--three">
          {related.map((item) => <ToolCard key={item.href} tool={item} />)}
        </div>
      </section>
    </main>
  );
}
