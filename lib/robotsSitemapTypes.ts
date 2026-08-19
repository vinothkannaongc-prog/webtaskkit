export type ValidatorCheckCategory =
  | "error"
  | "warning"
  | "crawler_specific"
  | "information"
  | "tool_limit"
  | "unverifiable"
  | "pass";

export type ValidatorCheck = {
  id: string;
  category: ValidatorCheckCategory;
  label: string;
  message: string;
  evidence?: string;
};

export type ValidatorSummary = {
  errors: number;
  warnings: number;
  crawlerSpecific: number;
  information: number;
  toolLimits: number;
  unverifiable: number;
  passed: number;
};

export type ValidatorFetch = {
  status: number;
  contentType: string | null;
  responseBytes: number;
  decodedBytes: number;
  redirects: number;
};

export type RobotsRule = {
  directive: "allow" | "disallow";
  pattern: string;
  line: number;
};

export type RobotsPreviewGroup = {
  userAgents: string[];
  rules: RobotsRule[];
};

export type RobotsEvaluation = {
  path: string;
  userAgent: string;
  verdict: "allowed" | "blocked" | "no_matching_group" | "unverifiable";
  matchedRule: RobotsRule | null;
};

export type RobotsValidatorResult = {
  schemaVersion: 1;
  reviewedAgainst: "2026-08-19";
  kind: "robots";
  requestedUrl: string;
  finalUrl: string;
  fetched: ValidatorFetch;
  summary: ValidatorSummary;
  checks: ValidatorCheck[];
  robots: {
    lineCount: number;
    groupCount: number;
    ruleCount: number;
    sitemapCount: number;
    userAgents: string[];
    sitemaps: string[];
    previewGroups: RobotsPreviewGroup[];
    truncated: boolean;
  };
  evaluation: RobotsEvaluation | null;
};

export type SitemapPreviewEntry = {
  location: string | null;
  lastModified: string | null;
  changeFrequency?: string | null;
  priority?: string | null;
  issues: string[];
};

export type SitemapValidatorResult = {
  schemaVersion: 1;
  reviewedAgainst: "2026-08-19";
  kind: "sitemap";
  requestedUrl: string;
  finalUrl: string;
  fetched: ValidatorFetch;
  summary: ValidatorSummary;
  checks: ValidatorCheck[];
  sitemap: {
    type: "urlset" | "sitemapindex";
    entryCount: number;
    validLocationCount: number;
    invalidLocationCount: number;
    duplicateLocationCount: number;
    lastModifiedCount: number;
    previewEntries: SitemapPreviewEntry[];
    truncated: boolean;
  };
};

export type RobotsValidatorRequest = {
  kind: "robots";
  url: string;
  path?: string;
  userAgent?: string;
};

export type SitemapValidatorRequest = {
  kind: "sitemap";
  url: string;
};

export type RobotsSitemapValidatorRequest = RobotsValidatorRequest | SitemapValidatorRequest;
export type RobotsSitemapValidatorResult = RobotsValidatorResult | SitemapValidatorResult;

export type RobotsSitemapApiErrorCode =
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
  | "invalid_document"
  | "validation_too_complex"
  | "fetch_failed";
