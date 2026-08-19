import { Buffer } from "node:buffer";
import { SecureHtmlFetchError } from "./secureHtmlFetch.ts";
import type {
  RobotsEvaluation,
  RobotsPreviewGroup,
  RobotsRule,
  ValidatorCheck,
} from "./robotsSitemapTypes.ts";

export const ROBOTS_VALIDATOR_LIMITS = Object.freeze({
  maximumBytes: 500 * 1_024,
  maximumLines: 100_000,
  maximumGroups: 10_000,
  maximumRules: 50_000,
  maximumSitemaps: 1_000,
  maximumReturnedSitemaps: 100,
  maximumPreviewGroups: 30,
  maximumPreviewRules: 300,
  maximumPathCharacters: 1_024,
  maximumUserAgentCharacters: 64,
  maximumParsedProductTokenCharacters: 64,
  maximumParsedRulePatternCharacters: 2_048,
});

type RobotsGroup = {
  userAgents: string[];
  rules: RobotsRule[];
};

export type ParsedRobots = {
  lineCount: number;
  groups: RobotsGroup[];
  ruleCount: number;
  sitemapCount: number;
  sitemaps: string[];
  invalidLines: number;
  unknownDirectives: number;
  duplicateUserAgents: number;
  crawlDelayDirectives: number;
  noindexDirectives: number;
  encodingIssueLines: number;
  nonstandardLeadingWildcardRules: number;
  limitedProductTokens: number;
  limitedRulePatterns: number;
  limitedRulesInExcludedGroups: number;
};

function decodeRobotsLines(body: Uint8Array) {
  const lines: Array<string | null> = [];
  let start = 0;
  for (let index = 0; index <= body.byteLength; index += 1) {
    const byte = body[index];
    if (index < body.byteLength && byte !== 0x0a && byte !== 0x0d) continue;
    const segment = body.subarray(start, index);
    try {
      lines.push(new TextDecoder("utf-8", { fatal: true }).decode(segment));
    } catch {
      lines.push(null);
    }
    if (byte === 0x0d && body[index + 1] === 0x0a) index += 1;
    start = index + 1;
  }
  if (lines[0]?.charCodeAt(0) === 0xfeff) lines[0] = lines[0].slice(1);
  return lines;
}

function ensureBudget(signal: AbortSignal, deadlineMilliseconds: number) {
  if (signal.aborted) throw new SecureHtmlFetchError("aborted");
  if (performance.now() >= deadlineMilliseconds) throw new SecureHtmlFetchError("timeout");
}

function trimRobotsWhitespace(value: string) {
  return value.replace(/^[\t ]+|[\t ]+$/g, "");
}

function validProductTokenSyntax(value: string) {
  return value === "*" || /^[a-z_-]+$/i.test(value);
}

function wellFormedPercentEscapes(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "%" && !/^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) return false;
  }
  return true;
}

function wellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function validPathPattern(value: string) {
  if (!value || !(value.startsWith("/") || value.startsWith("*"))) return false;
  if (!wellFormedPercentEscapes(value) || !wellFormedUnicode(value)) return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

function hasForbiddenRobotsControl(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint < 0x20 && codePoint !== 0x09) || codePoint === 0x7f) return true;
  }
  return false;
}

export function validateCrawlerProductToken(value: unknown) {
  if (value === undefined) return "*";
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > ROBOTS_VALIDATOR_LIMITS.maximumUserAgentCharacters
    || value !== trimRobotsWhitespace(value)
    || !validProductTokenSyntax(value)
  ) {
    throw new SecureHtmlFetchError("invalid_url");
  }
  return value.toLowerCase();
}

export function validateRobotsEvaluationPath(value: unknown) {
  if (value === undefined) return null;
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > ROBOTS_VALIDATOR_LIMITS.maximumPathCharacters
    || !value.startsWith("/")
    || value.includes("#")
    || value.includes("\\")
    || !wellFormedPercentEscapes(value)
    || !wellFormedUnicode(value)
  ) {
    throw new SecureHtmlFetchError("invalid_url");
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) throw new SecureHtmlFetchError("invalid_url");
  }
  return value;
}

function parseSitemapValue(value: string) {
  if (value.length < 1 || value.length > 2_048) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.hash
  ) return null;
  return parsed.href;
}

export function parseRobotsDocument(
  body: Uint8Array,
  context: { signal: AbortSignal; deadlineMilliseconds: number },
): ParsedRobots {
  if (body.byteLength > ROBOTS_VALIDATOR_LIMITS.maximumBytes) {
    throw new SecureHtmlFetchError("response_too_large");
  }
  ensureBudget(context.signal, context.deadlineMilliseconds);
  const lines = decodeRobotsLines(body);
  if (lines.length > ROBOTS_VALIDATOR_LIMITS.maximumLines) {
    throw new SecureHtmlFetchError("analysis_too_complex");
  }

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let rulesStarted = false;
  let ruleCount = 0;
  let sitemapCount = 0;
  let invalidLines = 0;
  let unknownDirectives = 0;
  let duplicateUserAgents = 0;
  let crawlDelayDirectives = 0;
  let noindexDirectives = 0;
  let encodingIssueLines = 0;
  let nonstandardLeadingWildcardRules = 0;
  let limitedProductTokens = 0;
  let limitedRulePatterns = 0;
  let limitedRulesInExcludedGroups = 0;
  let currentHasLimitedAgent = false;

  const finishGroup = () => {
    if (!current?.userAgents.length) {
      current = null;
      rulesStarted = false;
      currentHasLimitedAgent = false;
      return;
    }
    if (groups.length >= ROBOTS_VALIDATOR_LIMITS.maximumGroups) {
      throw new SecureHtmlFetchError("analysis_too_complex");
    }
    groups.push(current);
    current = null;
    rulesStarted = false;
    currentHasLimitedAgent = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    if ((index & 255) === 0) ensureBudget(context.signal, context.deadlineMilliseconds);
    const line = lines[index];
    if (line === null || line.includes("\0")) {
      encodingIssueLines += 1;
      invalidLines += 1;
      continue;
    }
    if (hasForbiddenRobotsControl(line)) {
      invalidLines += 1;
      continue;
    }
    const withoutComment = trimRobotsWhitespace(line.split("#", 1)[0]);
    if (!withoutComment) continue;
    const colon = withoutComment.indexOf(":");
    if (colon <= 0) {
      invalidLines += 1;
      continue;
    }
    const directive = trimRobotsWhitespace(withoutComment.slice(0, colon)).toLowerCase();
    const rawValue = trimRobotsWhitespace(withoutComment.slice(colon + 1));
    if (directive === "user-agent") {
      const normalized = rawValue.toLowerCase();
      if (!validProductTokenSyntax(normalized)) {
        invalidLines += 1;
        continue;
      }
      if (normalized.length > ROBOTS_VALIDATOR_LIMITS.maximumParsedProductTokenCharacters) {
        limitedProductTokens += 1;
        if (!current || rulesStarted) {
          finishGroup();
          current = { userAgents: [], rules: [] };
        }
        currentHasLimitedAgent = true;
        continue;
      }
      if (!current || rulesStarted) {
        finishGroup();
        current = { userAgents: [], rules: [] };
      }
      if (current.userAgents.includes(normalized)) duplicateUserAgents += 1;
      else current.userAgents.push(normalized);
      continue;
    }
    if (directive === "allow" || directive === "disallow") {
      if (!current) {
        invalidLines += 1;
        continue;
      }
      rulesStarted = true;
      if (!rawValue) continue;
      if (!validPathPattern(rawValue)) {
        invalidLines += 1;
        continue;
      }
      if (rawValue.length > ROBOTS_VALIDATOR_LIMITS.maximumParsedRulePatternCharacters) {
        limitedRulePatterns += 1;
        continue;
      }
      if (!current.userAgents.length && currentHasLimitedAgent) {
        limitedRulesInExcludedGroups += 1;
        continue;
      }
      if (!current.userAgents.length) {
        invalidLines += 1;
        continue;
      }
      if (rawValue.startsWith("*")) nonstandardLeadingWildcardRules += 1;
      ruleCount += 1;
      if (ruleCount > ROBOTS_VALIDATOR_LIMITS.maximumRules) {
        throw new SecureHtmlFetchError("analysis_too_complex");
      }
      current.rules.push({ directive, pattern: rawValue, line: index + 1 });
      continue;
    }
    if (directive === "sitemap") {
      sitemapCount += 1;
      if (sitemapCount > ROBOTS_VALIDATOR_LIMITS.maximumSitemaps) {
        throw new SecureHtmlFetchError("analysis_too_complex");
      }
      const sitemap = parseSitemapValue(rawValue);
      if (!sitemap) invalidLines += 1;
      else if (sitemaps.length < ROBOTS_VALIDATOR_LIMITS.maximumReturnedSitemaps) sitemaps.push(sitemap);
      continue;
    }
    if (directive === "crawl-delay") {
      crawlDelayDirectives += 1;
      continue;
    }
    if (directive === "noindex") {
      noindexDirectives += 1;
      continue;
    }
    unknownDirectives += 1;
  }
  finishGroup();

  return {
    lineCount: lines.length,
    groups,
    ruleCount,
    sitemapCount,
    sitemaps,
    invalidLines,
    unknownDirectives,
    duplicateUserAgents,
    crawlDelayDirectives,
    noindexDirectives,
    encodingIssueLines,
    nonstandardLeadingWildcardRules,
    limitedProductTokens,
    limitedRulePatterns,
    limitedRulesInExcludedGroups,
  };
}

const UNRESERVED = /^[A-Za-z0-9._~-]$/;

function percentEncodedUtf8(character: string) {
  return [...Buffer.from(character, "utf8")]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
}

function normalizeMatchingOctets(value: string, mode: "pattern" | "path") {
  let normalized = "";
  for (let index = 0; index < value.length;) {
    const character = value[index];
    if (character === "%" && /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      const byte = Number.parseInt(value.slice(index + 1, index + 3), 16);
      const decoded = String.fromCharCode(byte);
      normalized += UNRESERVED.test(decoded)
        ? decoded
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      index += 3;
      continue;
    }
    const codePoint = value.codePointAt(index) ?? 0;
    const fullCharacter = String.fromCodePoint(codePoint);
    if (
      codePoint > 0x7f
      || (mode === "path" && (fullCharacter === "*" || fullCharacter === "$"))
      || (mode === "pattern" && fullCharacter === "$")
    ) normalized += percentEncodedUtf8(fullCharacter);
    else normalized += fullCharacter;
    index += fullCharacter.length;
  }
  return normalized;
}

function matchingOctetLength(value: string) {
  let length = 0;
  for (let index = 0; index < value.length;) {
    if (value[index] === "%" && /^[0-9A-F]{2}$/.test(value.slice(index + 1, index + 3))) index += 3;
    else index += 1;
    length += 1;
  }
  return length;
}

function wildcardMatch(
  pattern: string,
  path: string,
  endAnchored: boolean,
  context: { signal: AbortSignal; deadlineMilliseconds: number },
) {
  let patternIndex = 0;
  let pathIndex = 0;
  let starIndex = -1;
  let retryPathIndex = -1;
  let operations = 0;
  while (pathIndex < path.length) {
    if ((operations += 1) % 256 === 0) ensureBudget(context.signal, context.deadlineMilliseconds);
    if (patternIndex === pattern.length) {
      if (!endAnchored) return true;
      if (starIndex >= 0) {
        patternIndex = starIndex + 1;
        retryPathIndex += 1;
        pathIndex = retryPathIndex;
        continue;
      }
      return false;
    }
    if (pattern[patternIndex] === "*") {
      starIndex = patternIndex;
      patternIndex += 1;
      retryPathIndex = pathIndex;
      continue;
    }
    if (pattern[patternIndex] === path[pathIndex]) {
      patternIndex += 1;
      pathIndex += 1;
      continue;
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      retryPathIndex += 1;
      pathIndex = retryPathIndex;
      continue;
    }
    return false;
  }
  while (pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

function ruleMatch(
  rule: RobotsRule,
  path: string,
  context: { signal: AbortSignal; deadlineMilliseconds: number },
) {
  const endAnchored = rule.pattern.endsWith("$");
  const source = endAnchored ? rule.pattern.slice(0, -1) : rule.pattern;
  const normalized = normalizeMatchingOctets(source, "pattern");
  if (!wildcardMatch(normalized, path, endAnchored, context)) return null;
  return matchingOctetLength(normalized.replace(/\*/g, ""));
}

export function evaluateRobotsPath(
  parsed: ParsedRobots,
  path: string,
  userAgent: string,
  context: { signal: AbortSignal; deadlineMilliseconds: number } = {
    signal: new AbortController().signal,
    deadlineMilliseconds: Number.POSITIVE_INFINITY,
  },
): RobotsEvaluation {
  const normalizedPath = normalizeMatchingOctets(path, "path");
  if (normalizedPath === "/robots.txt") {
    return { path, userAgent, verdict: "allowed", matchedRule: null };
  }
  const exactGroups = parsed.groups.filter((group) => group.userAgents.includes(userAgent));
  const selectedGroups = exactGroups.length
    ? exactGroups
    : parsed.groups.filter((group) => group.userAgents.includes("*"));
  if (!selectedGroups.length) {
    return { path, userAgent, verdict: "no_matching_group", matchedRule: null };
  }
  let best: { rule: RobotsRule; length: number } | null = null;
  for (const group of selectedGroups) {
    for (const rule of group.rules) {
      ensureBudget(context.signal, context.deadlineMilliseconds);
      const length = ruleMatch(rule, normalizedPath, context);
      if (length === null) continue;
      if (
        !best
        || length > best.length
        || (length === best.length && rule.directive === "allow" && best.rule.directive === "disallow")
      ) best = { rule, length };
    }
  }
  return {
    path,
    userAgent,
    verdict: best?.rule.directive === "disallow" ? "blocked" : "allowed",
    matchedRule: best?.rule ?? null,
  };
}

export function robotsPreview(parsed: ParsedRobots) {
  let remainingRules = ROBOTS_VALIDATOR_LIMITS.maximumPreviewRules;
  const previewGroups: RobotsPreviewGroup[] = [];
  for (const group of parsed.groups.slice(0, ROBOTS_VALIDATOR_LIMITS.maximumPreviewGroups)) {
    const rules = group.rules.slice(0, remainingRules);
    previewGroups.push({ userAgents: [...group.userAgents], rules });
    remainingRules -= rules.length;
    if (!remainingRules) break;
  }
  const userAgents = [...new Set(parsed.groups.flatMap((group) => group.userAgents))];
  return {
    userAgents: userAgents.slice(0, 100),
    previewGroups,
    truncated: parsed.groups.length > previewGroups.length
      || parsed.ruleCount > ROBOTS_VALIDATOR_LIMITS.maximumPreviewRules
      || parsed.sitemapCount > parsed.sitemaps.length
      || userAgents.length > 100,
  };
}

export function robotsChecks(parsed: ParsedRobots, evaluation: RobotsEvaluation | null) {
  const checks: ValidatorCheck[] = [
    parsed.encodingIssueLines
      ? {
        id: "robots-readable",
        category: "unverifiable",
        label: "Invalid bytes ignored",
        message: `${parsed.encodingIssueLines} line${parsed.encodingIssueLines === 1 ? " contained" : "s contained"} invalid UTF-8 or NUL data and was ignored. Crawler recovery can differ.`,
      }
      : {
        id: "robots-readable",
        category: "pass",
        label: "Robots document readable",
        message: "The response is a bounded UTF-8 robots.txt document.",
      },
    parsed.groups.length
      ? {
        id: "robots-groups",
        category: "pass",
        label: "Crawler groups",
        message: `${parsed.groups.length} valid crawler group${parsed.groups.length === 1 ? "" : "s"} found.`,
      }
      : {
        id: "robots-groups",
        category: "information",
        label: "No crawler rules",
        message: "No valid User-agent group with Allow or Disallow rules was found.",
      },
    parsed.invalidLines
      ? {
        id: "robots-invalid-lines",
        category: "warning",
        label: "Unusable directives",
        message: `${parsed.invalidLines} line${parsed.invalidLines === 1 ? " was" : "s were"} malformed or unsupported and ignored.`,
      }
      : {
        id: "robots-invalid-lines",
        category: "pass",
        label: "Directive syntax",
        message: "No malformed supported directives were found.",
      },
    parsed.sitemapCount
      ? {
        id: "robots-sitemaps",
        category: "pass",
        label: "Sitemap declarations",
        message: `${parsed.sitemapCount} Sitemap directive${parsed.sitemapCount === 1 ? "" : "s"} found.`,
      }
      : {
        id: "robots-sitemaps",
        category: "information",
        label: "No sitemap declaration",
        message: "A Sitemap directive is optional; discovery can also happen through search-console submission and links.",
      },
  ];
  if (parsed.unknownDirectives) checks.push({
    id: "robots-unknown-directives",
    category: "information",
    label: "Other directives",
    message: `${parsed.unknownDirectives} unrecognized directive${parsed.unknownDirectives === 1 ? " was" : "s were"} ignored for this RFC-style evaluation.`,
  });
  if (parsed.nonstandardLeadingWildcardRules) checks.push({
    id: "robots-leading-wildcard",
    category: "crawler_specific",
    label: "Leading wildcard rule",
    message: `${parsed.nonstandardLeadingWildcardRules} rule${parsed.nonstandardLeadingWildcardRules === 1 ? " begins" : "s begin"} with *. This appears in an RFC example but not its current path-pattern ABNF; crawler handling can vary.`,
  });
  if (parsed.limitedProductTokens || parsed.limitedRulePatterns || parsed.limitedRulesInExcludedGroups) checks.push({
    id: "robots-record-limits",
    category: "tool_limit",
    label: "Per-record safety limits",
    message: `${parsed.limitedProductTokens} product token${parsed.limitedProductTokens === 1 ? "" : "s"} over ${ROBOTS_VALIDATOR_LIMITS.maximumParsedProductTokenCharacters} characters, ${parsed.limitedRulePatterns} rule pattern${parsed.limitedRulePatterns === 1 ? "" : "s"} over ${ROBOTS_VALIDATOR_LIMITS.maximumParsedRulePatternCharacters.toLocaleString("en-US")} characters, and ${parsed.limitedRulesInExcludedGroups} rule${parsed.limitedRulesInExcludedGroups === 1 ? "" : "s"} belonging only to excluded tokens were not evaluated. They are tool limits, not RFC syntax errors.`,
  });
  if (parsed.crawlDelayDirectives) checks.push({
    id: "robots-crawl-delay",
    category: "crawler_specific",
    label: "crawl-delay is crawler-specific",
    message: `${parsed.crawlDelayDirectives} crawl-delay directive${parsed.crawlDelayDirectives === 1 ? " was" : "s were"} found. Support and interpretation vary by crawler.`,
  });
  if (parsed.noindexDirectives) checks.push({
    id: "robots-noindex",
    category: "crawler_specific",
    label: "noindex is not a standard robots.txt rule",
    message: `${parsed.noindexDirectives} noindex directive${parsed.noindexDirectives === 1 ? " was" : "s were"} found. Use page-level robots controls for indexing behavior.`,
  });
  if (parsed.duplicateUserAgents) checks.push({
    id: "robots-duplicate-agents",
    category: "information",
    label: "Repeated crawler tokens",
    message: `${parsed.duplicateUserAgents} repeated User-agent record${parsed.duplicateUserAgents === 1 ? " was" : "s were"} merged with its group.`,
  });
  if (parsed.sitemapCount > ROBOTS_VALIDATOR_LIMITS.maximumReturnedSitemaps) checks.push({
    id: "robots-sitemap-preview-limit",
    category: "tool_limit",
    label: "Sitemap preview limited",
    message: `The document was validated, but only the first ${ROBOTS_VALIDATOR_LIMITS.maximumReturnedSitemaps} Sitemap values are returned.`,
  });
  if (evaluation) checks.push({
    id: "robots-path-evaluation",
    category: "crawler_specific",
    label: "RFC-style crawler snapshot",
    message: evaluation.verdict === "blocked"
      ? `The longest matching rule blocks this path for ${evaluation.userAgent}.`
      : evaluation.verdict === "allowed"
        ? `The longest matching rule allows this path for ${evaluation.userAgent}.`
        : `No ${evaluation.userAgent} or wildcard group matched, so this snapshot found no blocking rule.`,
    evidence: evaluation.matchedRule
      ? `${evaluation.matchedRule.directive}: ${evaluation.matchedRule.pattern} (line ${evaluation.matchedRule.line})`
      : undefined,
  });
  return checks;
}
