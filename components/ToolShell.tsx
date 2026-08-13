import type { ReactNode } from "react";
import { ToolCard } from "./ToolCard";
import { tools, type ToolDefinition } from "@/lib/tools";

type FAQ = { question: string; answer: string };

type ToolShellProps = {
  tool: ToolDefinition;
  intro: string;
  children: ReactNode;
  steps: string[];
  features: { title: string; text: string }[];
  faqs: FAQ[];
  privacyNote?: string;
};

export function ToolShell({
  tool,
  intro,
  children,
  steps,
  features,
  faqs,
  privacyNote = "This tool runs locally in your browser. Your input is not uploaded to WebTaskKit.",
}: ToolShellProps) {
  const related = tools.filter((item) => item.href !== tool.href).slice(0, 3);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: `${tool.name} by WebTaskKit`,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any modern web browser",
        description: intro,
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
    ],
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="tool-hero section-wrap">
        <div className="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span aria-hidden="true">/</span>
          <a href={`/${tool.category.toLowerCase()}`}>{tool.category}</a><span aria-hidden="true">/</span>
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
