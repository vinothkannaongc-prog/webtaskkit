import {
  Parser,
  defaultTreeAdapter,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes,
  type TreeAdapter,
} from "parse5";
import type {
  SeoAuditCheck,
  SeoAuditGroup,
  SeoAuditResult,
  SeoAuditStatus,
} from "./seoAuditTypes.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

const MAX_EVIDENCE_CHARACTERS = 320;
const MAX_HTML_CHARACTERS = 512 * 1_024;
const PARSER_CHUNK_CHARACTERS = 4 * 1_024;
const MAX_MARKUP_OPENERS = 60_000;
const MAX_ENTITY_OPENERS = 80_000;
const MAX_MARKUP_TOKEN_CHARACTERS = 8 * 1_024;
const MAX_MARKUP_TOKEN_SEGMENTS = 257; // one tag name plus at most 256 attributes
const MAX_DOCUMENT_NODES = 60_000;
const MAX_DOCUMENT_DEPTH = 256;
const MAX_TEXT_NODES = 20_000;
const MAX_STRUCTURED_DATA_VALUES = 20_000;
const MAX_STRUCTURED_DATA_DEPTH = 64;
const MAX_JSON_LD_BLOCKS = 64;
const MAX_JSON_LD_CHARACTERS_PER_BLOCK = 64 * 1_024;
const MAX_JSON_LD_CHARACTERS_TOTAL = 128 * 1_024;
const MAX_ATTRIBUTES_PER_ELEMENT = 256;
const MAX_ATTRIBUTES_TOTAL = 20_000;
const MAX_TREE_MUTATION_WORK = MAX_DOCUMENT_NODES * 4;
const RAW_TEXT_ELEMENTS = new Set([
  "iframe", "noembed", "noframes", "plaintext", "script", "style", "textarea", "title", "xmp",
]);

function isHtmlSpace(character: string) {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";
}

function rawTextClosingTagAt(html: string, index: number, tagName: string) {
  if (html[index] !== "<" || html[index + 1] !== "/") return false;
  const candidate = html.slice(index + 2, index + 2 + tagName.length).toLowerCase();
  if (candidate !== tagName) return false;
  const delimiter = html[index + 2 + tagName.length] ?? "";
  return delimiter === ">" || delimiter === "/" || isHtmlSpace(delimiter);
}

export type SeoAuditLimitCode = "aborted" | "timeout" | "too_complex";

export class SeoAuditLimitError extends Error {
  readonly code: SeoAuditLimitCode;

  constructor(code: SeoAuditLimitCode) {
    super("The HTML analysis exceeded a fixed safety budget.");
    this.name = "SeoAuditLimitError";
    this.code = code;
  }
}

type WorkBudget = {
  signal?: AbortSignal;
  deadlineMilliseconds?: number;
  monotonicNow?: () => number;
  yieldControl?: () => Promise<void>;
};

function createWorkGuard(budget: WorkBudget) {
  const now = budget.monotonicNow ?? (() => performance.now());
  const deadline = budget.deadlineMilliseconds ?? Number.POSITIVE_INFINITY;
  let operations = 0;
  let nodes = 0;
  let attributes = 0;
  let textCharacters = 0;
  let treeMutationWork = 0;

  const check = (force = false) => {
    operations += 1;
    if (!force && operations % 128 !== 0) return;
    if (budget.signal?.aborted) throw new SeoAuditLimitError("aborted");
    if (now() >= deadline) throw new SeoAuditLimitError("timeout");
  };
  const tooComplex = () => {
    throw new SeoAuditLimitError("too_complex");
  };
  const addAttributes = (attributeCount: number) => {
    check(true);
    attributes += attributeCount;
    if (attributeCount > MAX_ATTRIBUTES_PER_ELEMENT || attributes > MAX_ATTRIBUTES_TOTAL) {
      tooComplex();
    }
  };

  return {
    check,
    tooComplex,
    addAttributes,
    addNode(attributeCount = 0) {
      check(true);
      nodes += 1;
      if (nodes > MAX_DOCUMENT_NODES) tooComplex();
      addAttributes(attributeCount);
    },
    addText(characters: number) {
      check();
      textCharacters += characters;
      if (textCharacters > MAX_HTML_CHARACTERS * 2) tooComplex();
    },
    addTreeMutationWork(work: number) {
      check();
      treeMutationWork += work;
      if (treeMutationWork > MAX_TREE_MUTATION_WORK) tooComplex();
    },
    async yield() {
      check(true);
      await (budget.yieldControl
        ? budget.yieldControl()
        : new Promise<void>((resolve) => setImmediate(resolve)));
      check(true);
    },
  };
}

type WorkGuard = ReturnType<typeof createWorkGuard>;

function guardedTreeAdapter(guard: WorkGuard): TreeAdapter<DefaultTreeAdapterMap> {
  const templateOwners = new WeakMap<DefaultTreeAdapterTypes.DocumentFragment, Element>();

  const nodeParent = (node: Node): ParentNode | null => {
    if (node.nodeName === "#document-fragment") return templateOwners.get(node) ?? null;
    return "parentNode" in node ? node.parentNode : null;
  };
  const depthOf = (node: Node) => {
    let depth = 0;
    let current: Node | null = node;
    while (current) {
      guard.addTreeMutationWork(1);
      current = nodeParent(current);
      if (current) depth += 1;
      if (depth > MAX_DOCUMENT_DEPTH) guard.tooComplex();
    }
    return depth;
  };
  const relativeSubtreeDepth = (root: Node) => {
    let maximum = 0;
    const stack: Array<{ node: Node; depth: number }> = [{ node: root, depth: 0 }];
    while (stack.length) {
      const current = stack.pop();
      if (!current) break;
      guard.addTreeMutationWork(1);
      maximum = Math.max(maximum, current.depth);
      if (maximum > MAX_DOCUMENT_DEPTH) guard.tooComplex();
      if (isElement(current.node) && current.node.tagName === "template" && "content" in current.node) {
        stack.push({ node: current.node.content, depth: current.depth + 1 });
      }
      for (const child of childrenOf(current.node)) {
        stack.push({ node: child, depth: current.depth + 1 });
      }
    }
    return maximum;
  };
  const checkAttachment = (parent: ParentNode, child: ChildNode) => {
    guard.check(true);
    if (depthOf(parent) + 1 + relativeSubtreeDepth(child) > MAX_DOCUMENT_DEPTH) {
      guard.tooComplex();
    }
  };

  const adapter: TreeAdapter<DefaultTreeAdapterMap> = {
    ...defaultTreeAdapter,
    createDocument() {
      guard.addNode();
      return defaultTreeAdapter.createDocument();
    },
    createDocumentFragment() {
      guard.addNode();
      return defaultTreeAdapter.createDocumentFragment();
    },
    createElement(tagName, namespaceURI, attrs) {
      guard.addNode(attrs.length);
      return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
    },
    createCommentNode(data) {
      guard.addNode();
      guard.addText(data.length);
      return defaultTreeAdapter.createCommentNode(data);
    },
    createTextNode(value) {
      guard.addNode();
      guard.addText(value.length);
      return defaultTreeAdapter.createTextNode(value);
    },
    appendChild(parentNode, newNode) {
      checkAttachment(parentNode, newNode);
      defaultTreeAdapter.appendChild(parentNode, newNode);
    },
    insertBefore(parentNode, newNode, referenceNode) {
      guard.addTreeMutationWork(parentNode.childNodes.length);
      checkAttachment(parentNode, newNode);
      defaultTreeAdapter.insertBefore(parentNode, newNode, referenceNode);
    },
    setTemplateContent(templateElement, contentElement) {
      guard.check(true);
      templateOwners.set(contentElement, templateElement);
      defaultTreeAdapter.setTemplateContent(templateElement, contentElement);
    },
    setDocumentType(document, name, publicId, systemId) {
      if (!document.childNodes.some((node) => node.nodeName === "#documentType")) {
        guard.addNode();
      }
      guard.addText(name.length + publicId.length + systemId.length);
      defaultTreeAdapter.setDocumentType(document, name, publicId, systemId);
    },
    detachNode(node) {
      guard.check(true);
      if (node.parentNode) guard.addTreeMutationWork(node.parentNode.childNodes.length);
      defaultTreeAdapter.detachNode(node);
    },
    adoptAttributes(recipient, attrs) {
      guard.check(true);
      const existing = new Set(recipient.attrs.map((item) => item.name));
      const additions = attrs.filter((item) => !existing.has(item.name)).length;
      if (recipient.attrs.length + additions > MAX_ATTRIBUTES_PER_ELEMENT) guard.tooComplex();
      guard.addAttributes(additions);
      defaultTreeAdapter.adoptAttributes(recipient, attrs);
    },
    insertText(parentNode, text) {
      guard.check();
      const previous = parentNode.childNodes.at(-1);
      if (previous && adapter.isTextNode(previous)) {
        guard.addText(text.length);
        previous.value += text;
        return;
      }
      adapter.appendChild(parentNode, adapter.createTextNode(text));
    },
    insertTextBefore(parentNode, text, referenceNode) {
      guard.check();
      guard.addTreeMutationWork(parentNode.childNodes.length);
      const referenceIndex = parentNode.childNodes.indexOf(referenceNode);
      const previous = parentNode.childNodes[referenceIndex - 1];
      if (previous && adapter.isTextNode(previous)) {
        guard.addText(text.length);
        previous.value += text;
        return;
      }
      adapter.insertBefore(parentNode, adapter.createTextNode(text), referenceNode);
    },
  };
  return adapter;
}

async function preflightAndParseHtml(html: string, guard: WorkGuard) {
  if (html.length > MAX_HTML_CHARACTERS) guard.tooComplex();
  let markupOpeners = 0;
  let entityOpeners = 0;
  let markupCharacters = 0;
  let markupStart = -1;
  let markupSegments = 0;
  let insideMarkupSegment = false;
  let markupQuote: "\"" | "'" | null = null;
  let commentToken = false;
  let rawTextElement: string | null = null;
  for (let index = 0; index < html.length; index += 1) {
    if (index % PARSER_CHUNK_CHARACTERS === 0) {
      guard.check(true);
      if (index) await guard.yield();
    }
    const character = html[index];
    if (character === "&") entityOpeners += 1;
    if (!markupCharacters) {
      const next = html[index + 1] ?? "";
      const following = html[index + 2] ?? "";
      const startsMarkup = character === "<" && (
        /[A-Za-z!?]/.test(next)
        || (next === "/" && /[A-Za-z]/.test(following))
      );
      const closesRawText = rawTextElement
        ? rawTextClosingTagAt(html, index, rawTextElement)
        : false;
      if (character === "<" && ((!rawTextElement && startsMarkup) || closesRawText)) {
        markupOpeners += 1;
        markupCharacters = 1;
        markupStart = index;
        markupSegments = 0;
        insideMarkupSegment = false;
        markupQuote = null;
        commentToken = html.startsWith("<!--", index);
      }
    } else {
      markupCharacters += 1;
      if (markupCharacters > MAX_MARKUP_TOKEN_CHARACTERS) guard.tooComplex();
      if (commentToken) {
        if (index >= 2 && html.slice(index - 2, index + 1) === "-->") {
          markupCharacters = 0;
          markupStart = -1;
          commentToken = false;
        }
      } else if (markupQuote) {
        if (character === markupQuote) markupQuote = null;
      } else if (character === '"' || character === "'") {
        markupQuote = character;
      } else if (character === ">") {
        const token = html.slice(markupStart, index + 1);
        const match = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(token);
        if (match) {
          const closing = Boolean(match[1]);
          const name = match[2].toLowerCase();
          if (closing && rawTextElement === name) rawTextElement = null;
          else if (!closing && RAW_TEXT_ELEMENTS.has(name) && !/\/\s*>$/.test(token)) {
            rawTextElement = name;
          }
        }
        markupCharacters = 0;
        markupStart = -1;
        markupSegments = 0;
        insideMarkupSegment = false;
      } else if (isHtmlSpace(character)) {
        insideMarkupSegment = false;
      } else if (!insideMarkupSegment) {
        insideMarkupSegment = true;
        markupSegments += 1;
        if (markupSegments > MAX_MARKUP_TOKEN_SEGMENTS) guard.tooComplex();
      }
    }
    if (markupOpeners > MAX_MARKUP_OPENERS || entityOpeners > MAX_ENTITY_OPENERS) {
      guard.tooComplex();
    }
  }
  await guard.yield();

  const parser = new Parser({
    scriptingEnabled: true,
    sourceCodeLocationInfo: false,
    treeAdapter: guardedTreeAdapter(guard),
  });
  if (!html.length) {
    parser.tokenizer.write("", true);
  } else {
    for (let offset = 0; offset < html.length; offset += PARSER_CHUNK_CHARACTERS) {
      guard.check(true);
      const end = Math.min(html.length, offset + PARSER_CHUNK_CHARACTERS);
      parser.tokenizer.write(html.slice(offset, end), end === html.length);
      guard.check(true);
      if (end !== html.length) await guard.yield();
    }
  }
  guard.check(true);
  return parser.document;
}

function isElement(node: Node): node is Element {
  return "tagName" in node && typeof node.tagName === "string";
}

function childrenOf(node: Node): Node[] {
  if ("childNodes" in node) return node.childNodes;
  return [];
}

function indexElements(root: Node, guard: WorkGuard) {
  const all: Element[] = [];
  const byTag = new Map<string, Element[]>();
  const stack: Array<{ node: Node; depth: number }> = [{ node: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    guard.check();
    visited += 1;
    if (visited > MAX_DOCUMENT_NODES || current.depth > MAX_DOCUMENT_DEPTH) {
      guard.tooComplex();
    }
    if (isElement(current.node)) {
      all.push(current.node);
      const tagged = byTag.get(current.node.tagName) ?? [];
      tagged.push(current.node);
      byTag.set(current.node.tagName, tagged);
    }
    const children = childrenOf(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
  return { all, byTag };
}

function attribute(element: Element, name: string) {
  const expected = name.toLowerCase();
  return element.attrs.find((item) => item.name.toLowerCase() === expected)?.value ?? null;
}

function cleanText(value: string, maximum = MAX_EVIDENCE_CHARACTERS) {
  const boundedSource = value.length > maximum * 4 ? value.slice(0, maximum * 4) : value;
  const withoutControls = [...boundedSource.normalize("NFC")].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
  }).join("");
  const normalized = withoutControls
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function textContent(node: Node, guard: WorkGuard, maximumCharacters = 2_000): string {
  const pieces: string[] = [];
  const stack: Node[] = [node];
  let visited = 0;
  let characters = 0;
  while (stack.length && characters <= maximumCharacters) {
    const current = stack.pop();
    if (!current) break;
    guard.check();
    visited += 1;
    if (visited > MAX_TEXT_NODES) break;
    if (current.nodeName === "#text" && "value" in current) {
      const remaining = maximumCharacters - characters;
      const value = current.value.slice(0, Math.max(0, remaining));
      pieces.push(value);
      characters += value.length;
      continue;
    }
    const children = childrenOf(current);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return pieces.join(" ");
}

function exactMeta(scope: Element[], selector: "name" | "property", key: string) {
  return scope.filter((meta) => meta.tagName === "meta" && (
    attribute(meta, selector)?.trim().toLowerCase() === key
  ));
}

function metaContent(nodes: Element[]) {
  return nodes.map((node) => cleanText(attribute(node, "content") ?? "", 500)).filter(Boolean);
}

function safePageUrl(value: string | null, base: URL) {
  if (!value || value.length > 2_048) return null;
  try {
    const parsed = new URL(value, base);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function boundedJsonNesting(value: string, guard: WorkGuard) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    if (index % 1_024 === 0) guard.check(true);
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAX_STRUCTURED_DATA_DEPTH) return false;
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  guard.check(true);
  return depth === 0 && !quoted && !escaped;
}

function structuredDataTypes(value: unknown, output: Set<string>, guard: WorkGuard) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    guard.check();
    visited += 1;
    if (visited > MAX_STRUCTURED_DATA_VALUES || entry.depth > MAX_STRUCTURED_DATA_DEPTH) {
      guard.tooComplex();
    }
    const current = entry.value;
    if (Array.isArray(current)) {
      for (const item of current) stack.push({ value: item, depth: entry.depth + 1 });
      continue;
    }
    if (!current || typeof current !== "object") continue;
    const record = current as Record<string, unknown>;
    const type = record["@type"];
    if (typeof type === "string") output.add(cleanText(type, 80));
    if (Array.isArray(type)) {
      for (const item of type) if (typeof item === "string") output.add(cleanText(item, 80));
    }
    if (record["@graph"]) stack.push({ value: record["@graph"], depth: entry.depth + 1 });
  }
}

type AnalyzeInput = {
  html: string;
  finalUrl: string;
  status: number;
  contentType: string;
  responseBytes: number;
  redirects: number;
} & WorkBudget;

export async function analyzeSeoHtml(input: AnalyzeInput): Promise<SeoAuditResult> {
  const guard = createWorkGuard(input);
  guard.check(true);
  const document = await preflightAndParseHtml(input.html, guard);
  guard.check(true);
  const base = new URL(input.finalUrl);
  const documentIndex = indexElements(document, guard);
  const head = documentIndex.byTag.get("head")?.[0] ?? null;
  const headIndex = head ? indexElements(head, guard) : documentIndex;
  const htmlElement = documentIndex.byTag.get("html")?.[0] ?? null;
  const activeBaseHref = (headIndex.byTag.get("base") ?? [])
    .map((node) => attribute(node, "href"))
    .find((value) => value !== null) ?? null;
  const documentBaseHref = safePageUrl(activeBaseHref, base);
  const documentBase = documentBaseHref ? new URL(documentBaseHref) : base;
  const checks: SeoAuditCheck[] = [];

  const add = (
    id: string,
    group: SeoAuditGroup,
    label: string,
    status: SeoAuditStatus,
    message: string,
    evidence?: string,
  ) => checks.push({
    id,
    group,
    label,
    status,
    message: cleanText(message, 500),
    ...(evidence ? { evidence: cleanText(evidence) } : {}),
  });

  if (activeBaseHref !== null) {
    add(
      "document-base",
      "Fetch and indexability",
      "Document base URL",
      documentBaseHref ? "pass" : "warning",
      documentBaseHref
        ? "The first active base href is a valid HTTP(S) URL and is used to resolve relative metadata and links."
        : "The first active base href is unusable or credential-bearing. Relative metadata and links were resolved against the fetched page URL instead.",
      documentBaseHref ?? undefined,
    );
  }

  add(
    "https",
    "Fetch and indexability",
    "HTTPS delivery",
    base.protocol === "https:" ? "pass" : "warning",
    base.protocol === "https:"
      ? "The final page was delivered over HTTPS."
      : "The final page uses HTTP. Move public pages to HTTPS and redirect HTTP consistently.",
  );
  add(
    "http-status",
    "Fetch and indexability",
    "Successful HTML response",
    "pass",
    `The server returned HTTP ${input.status} with an allowed HTML media type.`,
  );
  add(
    "document-mode",
    "Page structure",
    "Standards mode",
    document.mode === "no-quirks" ? "pass" : "warning",
    document.mode === "no-quirks"
      ? "The document includes a standards-mode doctype."
      : "The parsed document entered quirks mode. Add a modern <!doctype html> declaration.",
  );

  const titleNodes = headIndex.byTag.get("title") ?? [];
  const titles = titleNodes.map((node) => cleanText(textContent(node, guard), 500)).filter(Boolean);
  const title = titles[0] ?? null;
  if (titleNodes.length !== 1 || !title) {
    add(
      "title",
      "Search appearance",
      "Page title",
      "issue",
      titleNodes.length === 0
        ? "No non-empty <title> was found. Add one concise, page-specific title."
        : "The document should contain exactly one non-empty <title> element.",
      title ?? undefined,
    );
  } else if (title.length < 10 || title.length > 80) {
    add(
      "title",
      "Search appearance",
      "Page title",
      "warning",
      `The title is present and ${title.length} characters long. Review it for concise, descriptive wording; search display uses available width rather than a fixed character limit.`,
      title,
    );
  } else {
    add("title", "Search appearance", "Page title", "pass", `One descriptive title was found (${title.length} characters).`, title);
  }

  const descriptionNodes = exactMeta(headIndex.all, "name", "description");
  const descriptions = metaContent(descriptionNodes);
  const description = descriptions[0] ?? null;
  if (descriptionNodes.length !== 1 || !description) {
    add(
      "meta-description",
      "Search appearance",
      "Meta description",
      descriptionNodes.length === 0 ? "issue" : "warning",
      descriptionNodes.length === 0
        ? "No meta description was found. Add a useful page-specific summary."
        : "Use exactly one non-empty meta description.",
      description ?? undefined,
    );
  } else {
    add(
      "meta-description",
      "Search appearance",
      "Meta description",
      description.length < 50 || description.length > 200 ? "warning" : "pass",
      `One meta description was found (${description.length} characters). Search engines may choose a different snippet and truncate to the available display width.`,
      description,
    );
  }

  const canonicalNodes = (headIndex.byTag.get("link") ?? []).filter((link) => (
    (attribute(link, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical")
  ));
  const canonicalValues = canonicalNodes.map((node) => safePageUrl(attribute(node, "href"), documentBase));
  const canonical = canonicalValues[0] ?? null;
  if (canonicalNodes.length !== 1 || !canonical) {
    add(
      "canonical",
      "Fetch and indexability",
      "Canonical URL",
      canonicalNodes.length === 0 ? "issue" : "warning",
      canonicalNodes.length === 0
        ? "No HTML canonical link was found. Add one self-referential canonical when this URL is the preferred version."
        : "Use one valid HTTP(S) canonical link without embedded credentials.",
    );
  } else {
    const canonicalUrl = new URL(canonical);
    const samePage = canonicalUrl.href === base.href;
    add(
      "canonical",
      "Fetch and indexability",
      "Canonical URL",
      samePage ? "pass" : "warning",
      samePage
        ? "The page declares one self-referential canonical URL."
        : "The canonical points to a different URL. Confirm that this consolidation is intentional.",
      canonical,
    );
  }

  const robotsValues = [
    ...metaContent(exactMeta(headIndex.all, "name", "robots")),
    ...metaContent(exactMeta(headIndex.all, "name", "googlebot")),
  ];
  const robots = robotsValues.length ? robotsValues.join("; ") : null;
  const noindex = robotsValues.some((value) => {
    const directives = value.toLowerCase().split(/[\s,]+/);
    return directives.includes("noindex") || directives.includes("none");
  });
  add(
    "robots",
    "Fetch and indexability",
    "Indexing directive",
    noindex ? "warning" : "pass",
    noindex
      ? "A noindex directive was found. Confirm that the page is intentionally excluded from search results."
      : "No HTML noindex directive was found. This does not guarantee indexing and does not inspect HTTP X-Robots-Tag headers.",
    robots ?? "No meta robots directive",
  );

  const viewport = metaContent(exactMeta(headIndex.all, "name", "viewport"))[0] ?? null;
  add(
    "viewport",
    "Page structure",
    "Mobile viewport",
    viewport ? "pass" : "warning",
    viewport
      ? "A viewport declaration is present."
      : "No viewport declaration was found. Responsive pages normally need width=device-width.",
    viewport ?? undefined,
  );

  const language = cleanText(htmlElement ? attribute(htmlElement, "lang") ?? "" : "", 80) || null;
  add(
    "language",
    "Page structure",
    "Document language",
    language ? "pass" : "warning",
    language
      ? "The root HTML element declares a language."
      : "Add a valid lang attribute to the root HTML element for browsers and assistive technology.",
    language ?? undefined,
  );

  const headings = documentIndex.all.filter((node) => /^h[1-6]$/.test(node.tagName));
  const h1s = headings.filter((node) => node.tagName === "h1");
  const firstHeading = headings.length ? cleanText(textContent(headings[0], guard), 500) || null : null;
  add(
    "h1",
    "Page structure",
    "Primary heading",
    h1s.length === 1 ? "pass" : h1s.length === 0 ? "issue" : "warning",
    h1s.length === 1
      ? "One H1 was found."
      : h1s.length === 0
        ? "No H1 was found. Give the page one clear primary heading."
        : `${h1s.length} H1 elements were found. Confirm that one heading is visually and semantically primary.`,
    h1s[0] ? cleanText(textContent(h1s[0], guard)) : undefined,
  );
  let skippedHeadingLevels = 0;
  for (let index = 1; index < headings.length; index += 1) {
    guard.check();
    const previous = Number(headings[index - 1].tagName.slice(1));
    const current = Number(headings[index].tagName.slice(1));
    if (current > previous + 1) skippedHeadingLevels += 1;
  }
  add(
    "heading-order",
    "Page structure",
    "Heading sequence",
    skippedHeadingLevels ? "warning" : "pass",
    skippedHeadingLevels
      ? `${skippedHeadingLevels} forward heading-level jump${skippedHeadingLevels === 1 ? " was" : "s were"} found. Review the outline rather than choosing levels for appearance.`
      : "No forward heading-level jumps were detected in the parsed HTML.",
  );

  const images = documentIndex.byTag.get("img") ?? [];
  const missingAlt = images.filter((image) => attribute(image, "alt") === null).length;
  add(
    "image-alt",
    "Page structure",
    "Image alternative text",
    missingAlt ? "warning" : "pass",
    missingAlt
      ? `${missingAlt} of ${images.length} image${images.length === 1 ? "" : "s"} omit the alt attribute. Add meaningful text or alt="" for decorative images.`
      : images.length
        ? `All ${images.length} image elements include an alt attribute; empty values may be appropriate for decorative images.`
        : "No image elements were found in the initial HTML.",
  );

  let internalLinks = 0;
  let externalLinks = 0;
  for (const anchor of documentIndex.byTag.get("a") ?? []) {
    guard.check();
    const href = safePageUrl(attribute(anchor, "href"), documentBase);
    if (!href) continue;
    if (new URL(href).origin === base.origin) internalLinks += 1;
    else externalLinks += 1;
  }
  add(
    "links",
    "Page structure",
    "Discoverable links",
    internalLinks ? "pass" : "warning",
    internalLinks
      ? `${internalLinks} internal and ${externalLinks} external HTTP(S) links were found in the initial HTML.`
      : `No internal HTTP(S) links were found; ${externalLinks} external link${externalLinks === 1 ? " was" : "s were"} detected.`,
  );

  const jsonLdNodes = (documentIndex.byTag.get("script") ?? []).filter((script) => (
    attribute(script, "type")?.trim().toLowerCase() === "application/ld+json"
  ));
  let invalidJsonLd = Math.max(0, jsonLdNodes.length - MAX_JSON_LD_BLOCKS);
  let jsonLdCharacters = 0;
  const jsonLdTypes = new Set<string>();
  for (const script of jsonLdNodes.slice(0, MAX_JSON_LD_BLOCKS)) {
    guard.check(true);
    const source = textContent(script, guard, MAX_JSON_LD_CHARACTERS_PER_BLOCK + 1);
    jsonLdCharacters += source.length;
    if (
      source.length > MAX_JSON_LD_CHARACTERS_PER_BLOCK
      || jsonLdCharacters > MAX_JSON_LD_CHARACTERS_TOTAL
      || !boundedJsonNesting(source, guard)
    ) {
      invalidJsonLd += 1;
      continue;
    }
    try {
      guard.check(true);
      const value: unknown = JSON.parse(source);
      guard.check(true);
      structuredDataTypes(value, jsonLdTypes, guard);
    } catch (error) {
      if (error instanceof SeoAuditLimitError && error.code !== "too_complex") throw error;
      invalidJsonLd += 1;
    }
  }
  add(
    "structured-data",
    "Search appearance",
    "JSON-LD syntax",
    invalidJsonLd ? "warning" : "pass",
    invalidJsonLd
      ? `${invalidJsonLd} of ${jsonLdNodes.length} JSON-LD block${jsonLdNodes.length === 1 ? "" : "s"} was invalid or exceeded the fixed syntax, size, depth or work limits.`
      : jsonLdNodes.length
        ? `${jsonLdNodes.length} parseable JSON-LD block${jsonLdNodes.length === 1 ? " was" : "s were"} found. Eligibility and schema-specific requirements still need a dedicated validator.`
        : "No JSON-LD was found. Structured data is optional unless a supported search feature applies.",
    jsonLdTypes.size ? `Types: ${[...jsonLdTypes].slice(0, 8).join(", ")}` : undefined,
  );

  const ogKeys = ["og:title", "og:type", "og:image", "og:url", "og:description"] as const;
  const openGraph: Record<string, string | null> = {};
  const missingOg: string[] = [];
  const duplicateOg: string[] = [];
  for (const key of ogKeys) {
    const nodes = exactMeta(headIndex.all, "property", key);
    const values = metaContent(nodes);
    openGraph[key] = values[0] ?? null;
    if (!values[0]) missingOg.push(key);
    if (nodes.length > 1 && key !== "og:image") duplicateOg.push(key);
  }
  const requiredOgMissing = missingOg.filter((key) => key !== "og:description");
  add(
    "open-graph",
    "Social sharing",
    "Open Graph basics",
    requiredOgMissing.length || duplicateOg.length ? "warning" : "pass",
    requiredOgMissing.length || duplicateOg.length
      ? `Review Open Graph metadata. Missing required basics: ${requiredOgMissing.join(", ") || "none"}; duplicated properties: ${duplicateOg.join(", ") || "none"}.`
      : missingOg.includes("og:description")
        ? "The four basic Open Graph properties are present; consider adding og:description for a useful preview summary."
        : "The four basic Open Graph properties and og:description are present; repeated og:image entries are valid image alternatives.",
  );
  const ogUrl = safePageUrl(openGraph["og:url"], documentBase);
  const ogImage = safePageUrl(openGraph["og:image"], documentBase);
  add(
    "open-graph-urls",
    "Social sharing",
    "Open Graph URLs",
    (openGraph["og:url"] && !ogUrl) || (openGraph["og:image"] && !ogImage) ? "warning" : "pass",
    (openGraph["og:url"] && !ogUrl) || (openGraph["og:image"] && !ogImage)
      ? "Use valid HTTP(S) URLs without embedded credentials for og:url and og:image."
      : "Open Graph URL fields are either absent or resolve to valid HTTP(S) URLs.",
    ogUrl ?? ogImage ?? undefined,
  );

  const twitterKeys = ["twitter:card", "twitter:title", "twitter:description", "twitter:image"] as const;
  const twitter: Record<string, string | null> = {};
  const missingTwitter: string[] = [];
  for (const key of twitterKeys) {
    const nodes = [
      ...exactMeta(headIndex.all, "name", key),
      ...exactMeta(headIndex.all, "property", key),
    ];
    const values = metaContent(nodes);
    twitter[key] = values[0] ?? null;
    if (!values[0]) missingTwitter.push(key);
  }
  add(
    "twitter-card",
    "Social sharing",
    "X/Twitter card metadata",
    missingTwitter.length ? "warning" : "pass",
    missingTwitter.length
      ? `Missing explicit card fields: ${missingTwitter.join(", ")}. Some platforms may fall back to Open Graph, but verify the intended preview.`
      : "Card type, title, description and image fields are present.",
  );

  const summary = checks.reduce(
    (counts, check) => {
      if (check.status === "issue") counts.issues += 1;
      if (check.status === "warning") counts.warnings += 1;
      if (check.status === "pass") counts.passed += 1;
      return counts;
    },
    { issues: 0, warnings: 0, passed: 0 },
  );

  const result: SeoAuditResult = {
    schemaVersion: 1,
    reviewedAgainst: "2026-08-19",
    finalUrl: base.href,
    fetched: {
      status: input.status,
      contentType: cleanText(input.contentType, 120),
      responseBytes: input.responseBytes,
      redirects: input.redirects,
    },
    summary,
    page: {
      title,
      titleCharacters: title?.length ?? 0,
      description,
      descriptionCharacters: description?.length ?? 0,
      canonical,
      robots,
      language,
      firstHeading,
      headings: headings.length,
      images: images.length,
      imagesMissingAlt: missingAlt,
      internalLinks,
      externalLinks,
      structuredDataBlocks: jsonLdNodes.length,
    },
    social: { openGraph, twitter },
    checks,
  };
  guard.check(true);
  return result;
}
