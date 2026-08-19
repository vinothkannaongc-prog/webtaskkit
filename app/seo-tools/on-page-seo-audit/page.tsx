import type { Metadata } from "next";
import { SeoAuditTool } from "@/components/tools/SeoAuditTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

const title = "On-Page SEO Audit and Meta Tag Checker";
const description = "Audit a public page's title, description, canonical, headings, image alt text, JSON-LD syntax, Open Graph and card metadata with a guarded server fetch.";
const canonical = "/seo-tools/on-page-seo-audit";

export const metadata: Metadata = {
  title,
  description,
  keywords: ["on-page SEO audit", "meta tag checker", "Open Graph checker", "SEO checker"],
  alternates: { canonical },
  openGraph: {
    type: "website",
    url: canonical,
    siteName: "WebTaskKit",
    title,
    description,
    images: [],
  },
  twitter: { card: "summary", title, description, images: [] },
};

const tool = getTool("on-page-seo-audit");

export default function OnPageSeoAuditPage() {
  return (
    <ToolShell
      tool={tool}
      intro="Inspect the initial HTML that a guarded server fetch receives, then work through concrete search, page-structure and social-preview findings without an opaque ranking score."
      privacyNote="The submitted public URL is fetched once by WebTaskKit. The URL, query string and HTML body are not stored or written to access or event logs; only this tool's canonical path and an allowlisted action name may be counted."
      steps={[
        "Enter one public HTTP or HTTPS page on its normal port. Never submit a private dashboard, signed link or URL containing an access token.",
        "Run the audit and review definite issues before warnings. Each finding explains the observed signal instead of hiding it behind a score.",
        "Update the page, run the bounded check again, then confirm platform-specific behavior in Search Console, a schema validator and relevant social preview tools.",
      ]}
      features={[
        { title: "Search essentials together", text: "Review response status, HTTPS, title, meta description, canonical, robots directives, document language and primary heading in one report." },
        { title: "Meta and Open Graph checks", text: "Inspect the basic Open Graph properties, card fields, URL validity and the content that may shape search and social previews." },
        { title: "A fetch path built to fail closed", text: "Every destination and redirect is DNS-validated, pinned to a public address and bounded by response, redirect, header and absolute time limits." },
      ]}
      practicalExamples={[
        { title: "Review a page before publishing", text: "Catch a missing title, description, canonical or H1 in the server-rendered HTML before submitting a new landing page for indexing." },
        { title: "Diagnose a weak link preview", text: "Compare Open Graph and card fields when a shared URL shows the wrong title, description or image on messaging and social platforms." },
        { title: "Check a rendered-site migration", text: "Confirm that a framework migration still returns essential metadata and internal links in the initial response, not only after client JavaScript runs." },
      ]}
      decisionGuide={[
        { title: "Treat issues as observable gaps", text: "Missing page signals such as a non-empty title, description, canonical or H1 are clear review points, but their relevance still depends on the page's purpose." },
        { title: "Review warnings in context", text: "A noindex directive, different canonical or sparse social metadata may be intentional. Confirm the page's job before changing it." },
        { title: "Use platform tools for eligibility", text: "A parseable JSON-LD block is not proof of a valid rich result, and complete Open Graph tags do not guarantee identical previews everywhere." },
      ]}
      limitations={[
        "The audit reads only the first public HTML response after at most three separately validated redirects. It does not execute client JavaScript or wait for hydration.",
        "Only public IP literals and fully qualified public hostnames are accepted. Private, loopback, link-local, reserved, multicast, non-HTTP(S), credential-bearing, fragment-bearing, non-default-port and HTTPS-to-HTTP destinations are rejected.",
        "The fetch uses an absolute 12-second deadline, 16 KiB response-header limit and 512 KiB uncompressed body limit. Compressed responses are rejected rather than decompressed.",
        "This page audit does not crawl links or inspect robots.txt, XML sitemaps, HTTP X-Robots-Tag, Core Web Vitals, mobile rendering, backlinks, duplicate pages or live search-engine indexation.",
        "Title and description counts are editorial prompts, not fixed ranking limits. Search engines may rewrite or truncate display text based on the query and available width.",
        "JSON-LD is checked only for parseable JSON and surfaced types. Use a schema-specific validator for required properties and search-feature eligibility.",
        "The destination server can observe the WebTaskKit fetch like any other HTTP request. Do not audit confidential or tokenized URLs.",
      ]}
      workflowLinks={[
        { href: "/seo-tools/robots-sitemap-validator", label: "Robots.txt & sitemap validator", text: "Check one discovery document separately after reviewing the page's initial HTML." },
        { href: "/editors/text", label: "Text editor", text: "Draft concise title, description and heading alternatives locally before editing the site." },
        { href: "/generators/qr-code", label: "QR code generator", text: "Create and test a QR code for the final public landing-page URL." },
      ]}
      references={[
        { href: "https://developers.google.com/search/docs/appearance/title-link", label: "Google title-link guidance", text: "Descriptive, concise and page-specific title practices." },
        { href: "https://developers.google.com/search/docs/appearance/snippet", label: "Google snippet guidance", text: "How page content and meta descriptions may shape snippets." },
        { href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls", label: "Google canonical guidance", text: "Supported canonical signals and self-referential annotations." },
        { href: "https://ogp.me/", label: "Open Graph protocol", text: "The four basic properties used by the Open Graph protocol." },
        { href: "https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html", label: "OWASP SSRF prevention", text: "Redirect, URL and DNS-pinning risks considered by the fetch boundary." },
        { href: "https://www.iana.org/assignments/ipv6-unicast-address-assignments/", label: "IANA IPv6 global unicast registry", text: "Allocated public IPv6 prefixes; unlisted global-unicast space remains reserved." },
        { href: "https://www.iana.org/assignments/iana-ipv6-special-registry/", label: "IANA IPv6 special-purpose registry", text: "Special-purpose ranges excluded by the public-destination policy." },
      ]}
      referenceNote="Guidance reviewed August 19, 2026. Search appearance is not guaranteed; the report describes the fetched HTML and links to the source documentation behind its recommendations."
      faqs={[
        { question: "Does the audit store the URL or page HTML?", answer: "No. The submitted URL and fetched HTML are used in memory for one response and are not stored or written to WebTaskKit access or event logs. The destination server may still log the incoming WebTaskKit request." },
        { question: "Why does this tool use a server fetch?", answer: "Browsers normally prevent one site from reading another site's HTML. A bounded server fetch can inspect the public response while applying destination, redirect, size and time protections." },
        { question: "Can it check a localhost, staging or password-protected page?", answer: "No. The security policy rejects local, private, reserved and credential-bearing destinations. Publish a safe public preview or inspect private HTML with development tools inside the authorized environment." },
        { question: "Does it render JavaScript?", answer: "No. It analyzes the initial HTML response only. Content and metadata added exclusively by client JavaScript may not appear in the report." },
        { question: "Is a clean report proof that the page will rank?", answer: "No. The checks cover a bounded set of technical and editorial signals. Relevance, content quality, links, competition, crawlability, indexation and many other systems affect search visibility." },
        { question: "Why are compressed HTML responses rejected?", answer: "The client explicitly requests identity encoding. Rejecting unexpected compression keeps the raw and decoded byte budget identical and removes decompression-bomb ambiguity." },
        { question: "Does it validate structured data?", answer: "It checks whether JSON-LD blocks parse and lists bounded @type values. It does not validate schema requirements or eligibility for a particular rich result." },
        { question: "What should I fix first?", answer: "Start with a successful HTTPS response and one useful title, description, canonical and primary heading. Then review indexing intent, content structure and social preview fields in context." },
      ]}
    >
      <SeoAuditTool />
    </ToolShell>
  );
}
