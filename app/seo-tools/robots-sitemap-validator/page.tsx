import type { Metadata } from "next";
import { RobotsSitemapValidatorTool } from "@/components/tools/RobotsSitemapValidatorTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

const title = "Robots.txt Checker & XML Sitemap Validator";
const description = "Fetch one public robots.txt or XML sitemap safely, then review protocol errors, crawler-specific behavior and bounded validation limits without crawling listed pages.";
const canonical = "/seo-tools/robots-sitemap-validator";

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "robots.txt validator",
    "sitemap validator",
    "XML sitemap checker",
    "robots.txt checker",
    "robots txt file validator",
    "sitemap checker tool",
  ],
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

const tool = getTool("robots-sitemap-validator");

export default function RobotsSitemapValidatorPage() {
  return (
    <ToolShell
      tool={tool}
      intro="Check one public robots.txt or XML sitemap through a guarded server fetch. The report separates protocol errors, contextual warnings, crawler-specific behavior and WebTaskKit's own inspection limits—without an opaque score."
      privacyNote="The submitted public URL and optional robots path are used in memory for one check. They and the fetched file are not stored or written to WebTaskKit access or event logs; only this canonical tool path and an allowlisted action name may be counted."
      steps={[
        "Choose Robots.txt or XML sitemap. Submit only a public, canonical HTTP or HTTPS address with no credentials, query string, fragment or custom port.",
        "For robots.txt, enter the website origin. You may test one path against a crawler product token; that path is evaluated against the fetched rules and is never requested.",
        "For a sitemap, enter the exact .xml or .xml.gz file you want to inspect. Review the categorized findings, then verify ownership and indexation in the relevant search-engine console.",
      ]}
      features={[
        { title: "Two focused validation modes", text: "Inspect robots groups, rules and declared sitemaps, or parse one XML urlset or sitemap index with entry and metadata checks." },
        { title: "Crawler behavior stays explicit", text: "RFC-level findings are kept separate from Google-specific interpretation and from facts the file alone cannot prove." },
        { title: "One bounded public fetch", text: "The server validates every destination and redirect, pins public DNS results, and applies fixed time, redirect, header, body and parser limits." },
      ]}
      practicalExamples={[
        { title: "Check a deployment change", text: "Confirm that a production origin still serves a readable /robots.txt after an ingress, framework or CDN change, then test one important path without fetching it." },
        { title: "Review one sitemap before submission", text: "Inspect the root element, locations, duplicates and optional last-modified values before submitting the exact sitemap URL in a search console." },
        { title: "Investigate an unexpected crawl block", text: "Test the affected path with the crawler product token you care about and inspect the winning rule, while remembering that a live crawler may cache an older robots response." },
      ]}
      decisionGuide={[
        { title: "Fix definite protocol errors first", text: "A malformed document or unusable location is different from an optional field or a crawler-specific interpretation. Start with findings marked as errors." },
        { title: "Read warnings in site context", text: "A broad Disallow rule, cross-origin declaration or old lastmod value may be intentional. Confirm the publishing and ownership model before changing it." },
        { title: "Take tool limits literally", text: "A tool-limit finding identifies an intentionally shortened returned preview; the accepted document's counts and checks still cover what was parsed. A request rejected at a hard size or complexity cap is not fully validated." },
      ]}
      limitations={[
        "Each run fetches exactly one selected public file. Sitemap entries, sitemap-index children and URLs declared in robots.txt are summarized but never fetched or crawled.",
        "Robots mode requests only /robots.txt on the submitted origin. The optional path and crawler token are used only to evaluate the fetched rules; WebTaskKit never requests the tested path.",
        "Only public default-port HTTP or HTTPS destinations are accepted. Private, loopback, link-local, reserved, multicast, credential-bearing, query-bearing, fragment-bearing and unsafe redirect destinations are rejected.",
        "Every run has one aggregate 12-second DNS, connection, download, decoding and validation deadline and follows at most three separately validated redirects.",
        "Robots responses are limited to exactly 500 KiB (512,000 bytes) downloaded and decoded. The safety scan accepts at most 100,000 lines, 10,000 groups, 50,000 rules and 1,000 Sitemap fields; the returned preview is smaller and clearly labelled.",
        "Sitemap responses are limited to 1 MiB downloaded and 2 MiB decoded. Direct .xml.gz files are supported, while unexpected HTTP Content-Encoding compression is rejected so both size budgets remain enforceable.",
        "Sitemap validation inspects up to 100,000 entries, 250,000 XML elements and 64 levels of XML depth, and returns at most 100 entry previews. A document with more than 50,000 entries is reported as a protocol error even when the service can finish checking it. The protocol allows files up to 50 MB uncompressed, so WebTaskKit's smaller transfer limit may leave a valid large file unchecked.",
        "A tool-limit finding labels an intentionally shortened returned preview, not an invalid file. A response rejected at a hard size or complexity boundary was not fully validated; use an owner-authorized crawler when a complete inventory is required.",
        "Robots behavior can differ by crawler, cached response and temporary HTTP status. The report identifies notable Google behavior separately and does not claim to reproduce every crawler.",
        "A robots rule is not access control. A disallowed URL may still be discovered, and sensitive content must be protected with authentication and authorization.",
        "A valid sitemap is only a discovery hint. This tool cannot prove ownership, canonical selection, crawl eligibility, indexing, ranking, freshness or whether a search engine accepted the file.",
        "Optional sitemap changefreq and priority values are reported when present, but their absence is not an error. lastmod should describe a meaningful page change when used.",
        "The destination server can observe WebTaskKit's request like any other public HTTP client. Do not submit private dashboards, tokenized links or confidential endpoints.",
      ]}
      workflowLinks={[
        { href: "/seo-tools/on-page-seo-audit", label: "On-page SEO audit", text: "Inspect the initial HTML and page-level search metadata after crawl controls are in order." },
        { href: "/editors/text", label: "Text editor", text: "Draft or compare a small robots.txt change locally before updating the public file." },
        { href: "/seo-tools", label: "SEO tools hub", text: "Follow the crawl-to-page workflow and choose the next bounded check." },
      ]}
      references={[
        { href: "https://www.rfc-editor.org/rfc/rfc9309.html", label: "RFC 9309: Robots Exclusion Protocol", text: "The standardized location, encoding, group selection and rule-matching behavior for robots.txt." },
        { href: "https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec", label: "Google robots.txt interpretation", text: "Google-specific file limits, HTTP-status handling, supported fields and crawler behavior." },
        { href: "https://www.sitemaps.org/protocol.html", label: "Sitemaps XML protocol", text: "Required XML structure, location rules, optional fields and protocol limits." },
        { href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap", label: "Google sitemap guidance", text: "Supported formats, file limits, lastmod guidance and submission options." },
        { href: "https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html", label: "OWASP SSRF prevention", text: "Network and redirect risks considered by the guarded public-resource fetch." },
      ]}
      referenceNote="Protocol and crawler guidance reviewed August 19, 2026. Crawler policies can change; the report labels crawler-specific statements and never treats a sitemap as proof of indexation."
      faqs={[
        { question: "Does the validator crawl my website?", answer: "No. It fetches exactly one robots.txt or XML sitemap per run. It does not request the optional robots test path, sitemap entries, sitemap-index children or sitemap URLs declared in robots.txt." },
        { question: "What URL should I enter for robots.txt?", answer: "Enter the final public origin, such as https://example.com. WebTaskKit requests that origin's standard /robots.txt location. The origin cannot contain a query; the separate optional test path may include a query because it participates in robots matching, but that path is never fetched." },
        { question: "What URL should I enter for a sitemap?", answer: "Enter the exact public .xml or .xml.gz URL you want to validate. The tool does not guess, discover or recursively fetch a different sitemap." },
        { question: "Does Allowed mean Google will index the page?", answer: "No. A robots result concerns crawling rules for the tested path and product token. Indexation also depends on discovery, response content, canonical signals, quality, policies and search-engine systems." },
        { question: "Why can the report differ from Google's robots tester?", answer: "RFC 9309 defines a shared core, but crawlers add documented behavior for file size, redirects, caching and HTTP errors. WebTaskKit also uses stricter safety limits and cannot see a crawler's cached copy." },
        { question: "Is a missing changefreq or priority a sitemap error?", answer: "No. Both are optional in the protocol. The report surfaces values when present without treating their absence as a failure." },
        { question: "Can robots.txt protect a private file?", answer: "No. Robots rules are voluntary crawl instructions, not authentication. Protect private content at the application or server layer and avoid naming secrets in a public robots file." },
        { question: "Does a valid sitemap guarantee indexing?", answer: "No. A sitemap helps discovery and provides hints. Confirm processing, coverage and page-level reasons in the verified property for each search engine." },
        { question: "Are my submitted URL and fetched file stored?", answer: "No. They are used in memory for the response and are not written to WebTaskKit access or event logs. The destination may still log the incoming public request." },
      ]}
    >
      <RobotsSitemapValidatorTool />
    </ToolShell>
  );
}
