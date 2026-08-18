export type ToolCategory = "Generators" | "Converters" | "Editors";

export type ToolDefinition = {
  slug: string;
  name: string;
  shortName: string;
  category: ToolCategory;
  description: string;
  href: string;
  symbol: string;
  accent: "teal" | "blue" | "violet" | "amber";
};

export const tools: ToolDefinition[] = [
  {
    slug: "qr-code",
    name: "QR Code Generator",
    shortName: "QR code",
    category: "Generators",
    description: "Create a custom QR code for a link or text, then download a crisp PNG.",
    href: "/generators/qr-code",
    symbol: "QR",
    accent: "teal",
  },
  {
    slug: "barcode",
    name: "Barcode Generator",
    shortName: "Barcode",
    category: "Generators",
    description: "Generate Code 128, EAN, UPC and ITF barcodes with print-ready controls.",
    href: "/generators/barcode",
    symbol: "|||",
    accent: "teal",
  },
  {
    slug: "txt-to-pdf",
    name: "TXT to PDF Converter",
    shortName: "TXT to PDF",
    category: "Converters",
    description: "Turn pasted text or a TXT file into a clean, formatted PDF privately.",
    href: "/converters/txt-to-pdf",
    symbol: "PDF",
    accent: "blue",
  },
  {
    slug: "image-to-pdf",
    name: "Image to PDF Converter",
    shortName: "Image to PDF",
    category: "Converters",
    description: "Combine JPG and PNG images into one ordered PDF privately in your browser.",
    href: "/converters/image-to-pdf",
    symbol: "IMG",
    accent: "blue",
  },
  {
    slug: "pdf-to-jpg",
    name: "PDF to JPG Converter",
    shortName: "PDF to JPG",
    category: "Converters",
    description: "Export selected PDF pages as JPG or PNG images locally, with one tidy download.",
    href: "/converters/pdf-to-jpg",
    symbol: "JPG",
    accent: "blue",
  },
  {
    slug: "svg",
    name: "SVG Editor",
    shortName: "SVG editor",
    category: "Editors",
    description: "Edit SVG source with a live, sandboxed preview and safe export.",
    href: "/editors/svg",
    symbol: "</>",
    accent: "violet",
  },
  {
    slug: "text",
    name: "Text Editor",
    shortName: "Text editor",
    category: "Editors",
    description: "Write, clean and transform plain text with useful live counters.",
    href: "/editors/text",
    symbol: "Aa",
    accent: "violet",
  },
  {
    slug: "tone",
    name: "Tone Generator",
    shortName: "Tone generator",
    category: "Generators",
    description: "Play precise frequencies and waveforms using your browser audio engine.",
    href: "/generators/tone",
    symbol: "Hz",
    accent: "amber",
  },
];

export const categoryLinks = [
  { name: "Generators", href: "/generators", description: "Create codes, labels and sound." },
  { name: "Converters", href: "/converters", description: "Turn one useful format into another." },
  { name: "Editors", href: "/editors", description: "Make clean changes directly in your browser." },
];

export function toolsForCategory(category: ToolCategory) {
  return tools.filter((tool) => tool.category === category);
}

export function getTool(slug: string) {
  const tool = tools.find((item) => item.slug === slug);
  if (!tool) throw new Error(`Unknown tool: ${slug}`);
  return tool;
}
