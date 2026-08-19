import type {
  ValidatorCheck,
  ValidatorCheckCategory,
  ValidatorSummary,
} from "./robotsSitemapTypes.ts";

const SUMMARY_KEYS: Record<ValidatorCheckCategory, keyof ValidatorSummary> = {
  error: "errors",
  warning: "warnings",
  crawler_specific: "crawlerSpecific",
  information: "information",
  tool_limit: "toolLimits",
  unverifiable: "unverifiable",
  pass: "passed",
};

export function summarizeValidatorChecks(checks: ValidatorCheck[]): ValidatorSummary {
  const summary: ValidatorSummary = {
    errors: 0,
    warnings: 0,
    crawlerSpecific: 0,
    information: 0,
    toolLimits: 0,
    unverifiable: 0,
    passed: 0,
  };
  for (const check of checks) summary[SUMMARY_KEYS[check.category]] += 1;
  return summary;
}
