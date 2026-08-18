export type SeoAuditStatus = "issue" | "warning" | "pass";

export type SeoAuditGroup =
  | "Fetch and indexability"
  | "Search appearance"
  | "Page structure"
  | "Social sharing";

export type SeoAuditCheck = {
  id: string;
  group: SeoAuditGroup;
  label: string;
  status: SeoAuditStatus;
  message: string;
  evidence?: string;
};

export type SeoAuditResult = {
  schemaVersion: 1;
  reviewedAgainst: "2026-08-19";
  finalUrl: string;
  fetched: {
    status: number;
    contentType: string;
    responseBytes: number;
    redirects: number;
  };
  summary: {
    issues: number;
    warnings: number;
    passed: number;
  };
  page: {
    title: string | null;
    titleCharacters: number;
    description: string | null;
    descriptionCharacters: number;
    canonical: string | null;
    robots: string | null;
    language: string | null;
    firstHeading: string | null;
    headings: number;
    images: number;
    imagesMissingAlt: number;
    internalLinks: number;
    externalLinks: number;
    structuredDataBlocks: number;
  };
  social: {
    openGraph: Record<string, string | null>;
    twitter: Record<string, string | null>;
  };
  checks: SeoAuditCheck[];
};

export type SeoAuditApiErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "blocked_destination"
  | "dns_failed"
  | "fetch_timeout"
  | "too_many_redirects"
  | "unsafe_redirect"
  | "remote_status"
  | "unsupported_content"
  | "response_too_large"
  | "analysis_too_complex"
  | "fetch_failed";
