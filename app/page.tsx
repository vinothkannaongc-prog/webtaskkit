import type { Metadata } from "next";
import { ToolFinder } from "@/components/ToolFinder";
import { categoryLinks } from "@/lib/tools";

export const metadata: Metadata = {
  title: { absolute: "WebTaskKit — Fast, Private Online Tools" },
  description: "Free browser tools for QR codes, barcodes, PDF and image conversion, SVG and text editing, and tone generation. No signup; your files stay on your device.",
  alternates: { canonical: "/" },
};

const benefits = [
  ["Private by design", "Files and inputs stay on your device whenever the browser can do the work."],
  ["Fast by default", "Every tool opens without an account, onboarding flow or unnecessary steps."],
  ["Useful outputs", "Download practical, reusable files without watermarks or artificial friction."],
  ["Accessible everywhere", "A calm, responsive workspace that works across desktop, tablet and mobile."],
];

export default function Home() {
  const websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "WebTaskKit",
    url: "https://webtaskkit.com",
    description: "A focused toolkit for everyday web tasks, with no signup and private browser processing.",
    publisher: { "@type": "Organization", name: "WebTaskKit", url: "https://webtaskkit.com" },
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }} />
      <section className="home-hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="home-hero__inner section-wrap">
          <div className="hero-copy">
            <p className="eyebrow"><span className="pulse-dot" /> Local-first browser tools</p>
            <h1>A practical toolkit for<br /><em>everyday web tasks.</em></h1>
            <p className="hero-lead">Create codes, convert files, edit content and generate precise audio tones—fast, free and privately in your browser.</p>
            <div className="hero-actions">
              <a className="button button--primary" href="#tools">Explore the tools <span aria-hidden="true">↓</span></a>
              <a className="button button--ghost" href="/privacy">How privacy works</a>
            </div>
            <div className="trust-row" aria-label="Product benefits">
              <span>Runs in your browser</span><span>No signup</span><span>Free to use</span>
            </div>
          </div>
          <div className="hero-workbench" aria-label="WebTaskKit launch collection preview">
            <div className="workbench-bar"><span /><span /><span /><b>webtaskkit / workspace</b></div>
            <div className="workbench-body">
              <div className="workbench-label">Choose a task</div>
              <a href="/generators/qr-code" className="workbench-item is-active"><span>QR</span><b>Create a QR code</b><i>→</i></a>
              <a href="/converters/txt-to-pdf" className="workbench-item"><span>PDF</span><b>Convert text to PDF</b><i>→</i></a>
              <a href="/converters/image-to-pdf" className="workbench-item"><span>IMG</span><b>Combine images into PDF</b><i>→</i></a>
              <a href="/converters/pdf-to-jpg" className="workbench-item"><span>JPG</span><b>Export PDF pages</b><i>→</i></a>
              <a href="/generators/tone" className="workbench-item"><span>Hz</span><b>Play an audio tone</b><i>→</i></a>
              <div className="workbench-status"><span>●</span> Ready. Your work stays local.</div>
            </div>
          </div>
        </div>
      </section>

      <ToolFinder />

      <section className="categories-section section-wrap">
        <div className="section-heading"><p className="eyebrow">One focused collection</p><h2>Tools for the task at hand</h2></div>
        <div className="category-grid">
          {categoryLinks.map((category, index) => (
            <a href={category.href} className="category-card" key={category.name}>
              <span>0{index + 1}</span><h3>{category.name}</h3><p>{category.description}</p><b aria-hidden="true">↗</b>
            </a>
          ))}
        </div>
      </section>

      <section className="values-section">
        <div className="section-wrap">
          <div className="section-heading"><p className="eyebrow">Practical by design</p><h2>Designed around the work,<br />not the wait.</h2></div>
          <div className="values-grid">
            {benefits.map(([title, text], index) => (
              <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{text}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-faq section-wrap">
        <div className="section-heading"><p className="eyebrow">The short answer</p><h2>What makes WebTaskKit different?</h2></div>
        <div className="faq-list faq-list--home">
          <details><summary>Are the tools really free?<span>+</span></summary><p>Yes. The launch tools are free to use and do not require an account.</p></details>
          <details><summary>Do you upload or store my files?<span>+</span></summary><p>The launch collection processes inputs locally in your browser. WebTaskKit does not receive or store the content you work with.</p></details>
          <details><summary>Do the tools work on mobile?<span>+</span></summary><p>Yes. They are designed for current mobile and desktop browsers, although larger editing tasks are more comfortable on a larger screen.</p></details>
          <details><summary>Can I use the outputs commercially?<span>+</span></summary><p>WebTaskKit does not claim ownership of your inputs or outputs. You remain responsible for any underlying content, identifiers or rights involved.</p></details>
        </div>
      </section>
    </main>
  );
}
