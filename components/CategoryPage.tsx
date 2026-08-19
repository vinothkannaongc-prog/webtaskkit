import { ToolCard } from "@/components/ToolCard";
import { categoryPath, toolsForCategory, type ToolCategory } from "@/lib/tools";

const siteUrl = "https://webtaskkit.com";

type CategoryCopy = {
  lead: string;
  body: string;
  choiceTitle: string;
  choices: { href: string; title: string; text: string }[];
  workflow: { title: string; text: string }[];
  boundaryTitle: string;
  boundary: string;
  related: { href: string; label: string; text: string }[];
};

const copy: Record<ToolCategory, CategoryCopy> = {
  Generators: {
    lead: "Create scannable codes and test tones directly in your browser.",
    body: "Start with the system that must receive the result: a phone camera, a barcode scanner or an audio playback chain. Generate locally, export only what you need and test in the real setting before relying on it.",
    choiceTitle: "Choose a generator by what must read the result",
    choices: [
      { href: "/generators/qr-code", title: "QR code for links and readable text", text: "Use a QR code when a phone camera should open a URL, contact action or short text payload." },
      { href: "/generators/barcode", title: "Barcode for inventory and retail systems", text: "Choose Code 128, UPC, EAN or ITF only when the receiving scanner and database expect that symbology." },
      { href: "/generators/tone", title: "Tone for controlled audio checks", text: "Generate a frequency and waveform for pitch comparisons or informal playback troubleshooting at a low volume." },
    ],
    workflow: [
      { title: "Define the receiver", text: "Confirm the scanner, phone, software or speaker that will consume the output and any format it requires." },
      { title: "Generate a conservative first version", text: "Use strong contrast for codes, the correct identifier standard for barcodes and low volume for audio." },
      { title: "Test the final context", text: "Scan the printed proof or listen through the actual playback chain. A browser preview cannot reproduce every production condition." },
    ],
    boundaryTitle: "Local creation does not remove real-world risk",
    boundary: "Code contents and tone settings are processed on this device, but the finished output still needs judgment. Do not encode secrets in a public graphic, do not invent retail identifiers, and do not treat browser audio as calibrated measurement equipment.",
    related: [
      { href: "/editors", label: "Prepare and inspect source material", text: "Clean text before encoding it or review a downloaded SVG before placing it in artwork." },
      { href: "/converters/txt-to-pdf", label: "Make a printable test sheet", text: "Turn plain-text instructions or observation notes into a simple PDF." },
    ],
  },
  Converters: {
    lead: "Turn plain text or images into a practical PDF, or export PDF pages as images, without uploading source files.",
    body: "Choose TXT to PDF for readable notes, Image to PDF when each JPG or PNG should become one ordered page, or PDF to JPG when selected document pages need to become images. Each converter runs locally and favors predictable output over elaborate document design.",
    choiceTitle: "Choose the right path into PDF",
    choices: [
      { href: "/converters/txt-to-pdf", title: "Convert notes, logs and instructions", text: "Choose page size, margins, font size and an optional title, then review the downloaded PDF." },
      { href: "/converters/image-to-pdf", title: "Combine JPG and PNG pages", text: "Arrange supported images, choose the paper setup and place each image on its own PDF page without cropping." },
      { href: "/converters/pdf-to-jpg", title: "Export PDF pages as images", text: "Choose a bounded page range, JPG or PNG, and a render resolution, then download one image or a page-numbered ZIP." },
    ],
    workflow: [
      { title: "Prepare the source", text: "Clean plain text, choose clear images or identify the PDF pages you need, preserving the original before conversion." },
      { title: "Choose for the reader", text: "Select a page setup for new PDFs, or choose JPG versus PNG and a practical resolution for page images." },
      { title: "Inspect before sending", text: "Open the result and check page order, breaks, characters, image rotation, form content and fine detail before sharing it." },
    ],
    boundaryTitle: "Focused conversion, not a document-design system",
    boundary: "Conversion stays in the browser, but these tools do not provide rich layouts, OCR, collaboration, PDF annotation export, image editing or archival certification. Use a full document or scanning application when you need styled mixed content, searchable image text, accessibility remediation or production print controls.",
    related: [
      { href: "/editors", label: "Edit before you convert", text: "Prepare plain text or work separately with vector artwork using the focused editors." },
      { href: "/generators", label: "Create a code for the next step", text: "Generate a QR code for a public document link or a barcode for a compatible identifier system." },
    ],
  },
  Editors: {
    lead: "Make focused changes to plain text or SVG source without installing a desktop application.",
    body: "Choose the editor by the material, not just the file extension. The text editor is for portable words and lists; the SVG editor validates vector markup and gives you a cleaned visual preview.",
    choiceTitle: "Choose the editor that understands the source",
    choices: [
      { href: "/editors/text", title: "Text editor for words, lists and logs", text: "Use live counts, whole-document case changes, whitespace cleanup and line sorting, then download UTF-8 TXT." },
      { href: "/editors/svg", title: "SVG editor for vector markup", text: "Change shapes, colors, dimensions or accessible labels while checking XML and a sandboxed visual preview." },
      { href: "/converters/txt-to-pdf", title: "Converter for a fixed reading copy", text: "Once plain text is final, paginate it into a simple A4 or Letter PDF without uploading it." },
    ],
    workflow: [
      { title: "Keep an original", text: "Transformations and SVG cleanup can change the whole document. Preserve the source when exact wording, order or markup matters." },
      { title: "Make one intentional change", text: "Apply a single cleanup or source edit, then review the text or preview before continuing." },
      { title: "Download before leaving", text: "Neither editor autosaves to an account. Export the finished file before refreshing or closing the tab." },
    ],
    boundaryTitle: "Focused source editors have deliberate limits",
    boundary: "These tools process content locally, but they are not collaborative word processors, visual illustration suites or complete security scanners. Proofread transformed text, review sanitized SVG output and apply the security rules of the system where the file will be used.",
    related: [
      { href: "/generators", label: "Generate an asset to inspect", text: "Create a QR code or barcode as SVG, or prepare text that will become a code payload." },
      { href: "/converters/txt-to-pdf", label: "Publish clean text as PDF", text: "Turn the final plain-text version into a paginated local download." },
    ],
  },
  "SEO Tools": {
    lead: "Inspect a public page's search signals, then check the robots and sitemap documents that help crawlers discover it.",
    body: "Use the on-page audit for one HTML response and the robots.txt checker or XML sitemap validator for one discovery document. Each explicit action makes one guarded fetch, reports observable findings and stops: there is no background crawl, automatic child-sitemap fetch or page-by-page request.",
    choiceTitle: "Choose the SEO check that matches the document",
    choices: [
      { href: "/seo-tools/on-page-seo-audit", title: "Audit one public HTML page", text: "Inspect response status, title, description, canonical, headings, structured-data syntax and social metadata in the initial response." },
      { href: "/seo-tools/robots-sitemap-validator", title: "Check a robots.txt file", text: "Review crawler groups, Allow and Disallow rules, Sitemap declarations and a test path without fetching the declared documents." },
      { href: "/seo-tools/robots-sitemap-validator", title: "Validate an XML sitemap", text: "Check one sitemap or sitemap-index document for syntax, required URL fields, limits, duplicates, host consistency and date formatting." },
    ],
    workflow: [
      { title: "Check discovery controls", text: "Validate the site's public robots.txt file and each important sitemap as separate, explicit checks. A declaration is not proof that the target was fetched or indexed." },
      { title: "Audit the preferred page", text: "Inspect the canonical public HTML URL, then fix definite metadata and structure issues before optional sharing refinements." },
      { title: "Verify with the search engine", text: "Use Search Console or Bing Webmaster Tools for live crawl, sitemap and indexation evidence; use schema and social preview tools for their specialist checks." },
    ],
    boundaryTitle: "Document checks, not a site crawler",
    boundary: "Each tool reads one public document only after destination and redirect validation. The page audit does not execute JavaScript; the robots and sitemap tool does not automatically fetch declarations, child sitemaps or listed pages. Neither tool proves crawl behavior, indexing, search appearance or rankings.",
    related: [
      { href: "/seo-tools/on-page-seo-audit", label: "Move from discovery to page signals", text: "After validating crawl documents, inspect the initial HTML of one important canonical page." },
      { href: "/seo-tools/robots-sitemap-validator", label: "Review crawl-discovery documents", text: "Check one public robots.txt file or XML sitemap and act on the reported document-level findings." },
    ],
  },
};

export function CategoryPage({ category }: { category: ToolCategory }) {
  const categoryTools = toolsForCategory(category);
  const categoryCopy = copy[category];
  const categoryUrl = `${siteUrl}${categoryPath(category)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ItemList",
        name: `${category} tools by WebTaskKit`,
        url: categoryUrl,
        numberOfItems: categoryTools.length,
        itemListElement: categoryTools.map((tool, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: tool.name,
          url: `${siteUrl}${tool.href}`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
          { "@type": "ListItem", position: 2, name: category, item: categoryUrl },
        ],
      },
    ],
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="page-hero section-wrap">
        <div className="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span>{category}</span></div>
        <p className="eyebrow">WebTaskKit collection</p>
        <h1>{category}</h1>
        <p className="page-lead">{categoryCopy.lead}</p>
        <p className="page-copy">{categoryCopy.body}</p>
      </section>

      <section className="section-wrap category-tool-section" aria-labelledby="category-tools-title">
        <div className="section-heading"><p className="eyebrow">Ready when you are</p><h2 id="category-tools-title">Choose a tool</h2></div>
        <div className="tool-grid">{categoryTools.map((tool) => <ToolCard key={tool.href} tool={tool} />)}</div>
      </section>

      <section className="category-guide-section section-wrap" aria-labelledby="category-guide-title">
        <div className="section-heading">
          <p className="eyebrow">Choose with confidence</p>
          <h2 id="category-guide-title">{categoryCopy.choiceTitle}</h2>
        </div>
        <div className="category-choice-grid">
          {categoryCopy.choices.map((choice) => (
            <a key={`${choice.href}-${choice.title}`} href={choice.href} className="category-choice-card">
              <h3>{choice.title}<span aria-hidden="true"> &rarr;</span></h3>
              <p>{choice.text}</p>
            </a>
          ))}
        </div>

        <div className="category-practice-grid">
          <article className="category-workflow-panel">
            <p className="eyebrow">A reliable workflow</p>
            <h2>From source to checked result</h2>
            <ol>
              {categoryCopy.workflow.map((step, index) => (
                <li key={step.title}>
                  <span>{index + 1}</span>
                  <div><h3>{step.title}</h3><p>{step.text}</p></div>
                </li>
              ))}
            </ol>
          </article>
          <aside className="category-boundary-panel">
            <p className="eyebrow">Privacy and limits</p>
            <h2>{categoryCopy.boundaryTitle}</h2>
            <p>{categoryCopy.boundary}</p>
          </aside>
        </div>

        <nav className="category-related-links" aria-label={`Related ${category.toLowerCase()} workflows`}>
          {categoryCopy.related.map((link) => (
            <a key={link.href} href={link.href}>
              <strong>{link.label}<span aria-hidden="true"> &rarr;</span></strong>
              <span>{link.text}</span>
            </a>
          ))}
        </nav>
      </section>
    </main>
  );
}
