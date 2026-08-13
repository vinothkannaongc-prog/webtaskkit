import type { Metadata } from "next";
import Link from "next/link";
import { ToolFinder } from "@/components/ToolFinder";
import { categoryLinks } from "@/lib/tools";

export const metadata: Metadata = {
  title: { absolute: "QuietTools — Fast, Private Online Tools" },
  description: "Free browser tools for QR codes, barcodes, TXT-to-PDF, SVG and text editing, and tone generation. No signup; your files stay on your device.",
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
    name: "QuietTools",
    description: "Fast, private browser utilities with no signup and no clutter.",
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }} />
      <section className="home-hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="home-hero__inner section-wrap">
          <div className="hero-copy">
            <p className="eyebrow"><span className="pulse-dot" /> Local-first browser tools</p>
            <h1>Useful online tools.<br /><em>Nothing in the way.</em></h1>
            <p className="hero-lead">Create QR codes and barcodes, convert text to PDF, edit SVGs and plain text, or generate precise audio tones. No signup and no unnecessary steps.</p>
            <div className="hero-actions">
              <Link className="button button--primary" href="#tools">Explore the tools <span aria-hidden="true">↓</span></Link>
              <Link className="button button--ghost" href="/privacy/">How privacy works</Link>
            </div>
            <div className="trust-row" aria-label="Product benefits">
              <span>Runs in your browser</span><span>No signup</span><span>Free to use</span>
            </div>
          </div>
          <div className="hero-workbench" aria-label="QuietTools launch collection preview">
            <div className="workbench-bar"><span /><span /><span /><b>quiettools / workspace</b></div>
            <div className="workbench-body">
              <div className="workbench-label">Choose a task</div>
              <Link href="/generators/qr-code/" className="workbench-item is-active"><span>QR</span><b>Create a QR code</b><i>→</i></Link>
              <Link href="/converters/txt-to-pdf/" className="workbench-item"><span>PDF</span><b>Convert text to PDF</b><i>→</i></Link>
              <Link href="/editors/svg/" className="workbench-item"><span>&lt;/&gt;</span><b>Edit an SVG</b><i>→</i></Link>
              <Link href="/generators/tone/" className="workbench-item"><span>Hz</span><b>Play an audio tone</b><i>→</i></Link>
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
            <Link href={category.href} className="category-card" key={category.name}>
              <span>0{index + 1}</span><h3>{category.name}</h3><p>{category.description}</p><b aria-hidden="true">↗</b>
            </Link>
          ))}
        </div>
      </section>

      <section className="values-section">
        <div className="section-wrap">
          <div className="section-heading"><p className="eyebrow">Quiet on purpose</p><h2>Designed around the work,<br />not the wait.</h2></div>
          <div className="values-grid">
            {benefits.map(([title, text], index) => (
              <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{text}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-faq section-wrap">
        <div className="section-heading"><p className="eyebrow">The short answer</p><h2>What makes QuietTools different?</h2></div>
        <div className="faq-list faq-list--home">
          <details><summary>Are the tools really free?<span>+</span></summary><p>Yes. The launch tools are free to use and do not require an account.</p></details>
          <details><summary>Do you upload or store my files?<span>+</span></summary><p>The launch collection processes inputs locally in your browser. QuietTools does not receive or store the content you work with.</p></details>
          <details><summary>Do the tools work on mobile?<span>+</span></summary><p>Yes. They are designed for current mobile and desktop browsers, although larger editing tasks are more comfortable on a larger screen.</p></details>
          <details><summary>Can I use the outputs commercially?<span>+</span></summary><p>QuietTools does not claim ownership of your inputs or outputs. You remain responsible for any underlying content, identifiers or rights involved.</p></details>
        </div>
      </section>
    </main>
  );
}
