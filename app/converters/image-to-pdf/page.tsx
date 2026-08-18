import type { Metadata } from "next";
import { ImageToPdfTool } from "@/components/tools/ImageToPdfTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

const title = "Image to PDF Converter - Combine JPG & PNG Files";
const description = "Combine JPG and PNG images into one ordered PDF locally in your browser. Choose A4 or Letter pages, orientation and margins. No upload or signup.";
const canonical = "/converters/image-to-pdf";

export const metadata: Metadata = {
  title,
  description,
  keywords: ["image to PDF", "JPG to PDF", "PNG to PDF", "combine images into PDF"],
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

const tool = getTool("image-to-pdf");

export default function ImageToPdfPage() {
  return (
    <ToolShell
      tool={tool}
      intro="Arrange JPG and PNG images in the exact order you need, place each one on its own PDF page, and download the combined document without uploading the originals."
      privacyNote="Images are decoded and assembled into the PDF in this browser. WebTaskKit does not receive the files or their contents."
      steps={[
        "Choose one or more JPEG or PNG files. Review the decoded dimensions and remove anything you did not intend to include.",
        "Use the Move up and Move down controls to set the page order, then choose A4 or US Letter, orientation and margin.",
        "Create the PDF and open the download to check page order, image orientation, fine detail and margins before sharing or printing.",
      ]}
      features={[
        { title: "Files stay local", text: "Selection, validation, image decoding and PDF creation all happen on this device. The images are never uploaded to WebTaskKit." },
        { title: "Predictable page order", text: "Each accepted image becomes one page in the visible list order, with native buttons for precise keyboard and touch reordering." },
        { title: "No accidental cropping", text: "Every image is scaled proportionally to fit inside the chosen page and margin, with transparent PNG areas placed on white." },
      ]}
      practicalExamples={[
        { title: "Scan a signed packet", text: "Photograph each page, arrange the images from first to last, and combine them into one PDF for review." },
        { title: "Share product references", text: "Place screenshots or product photos on consistent pages so a recipient can browse or print one orderly document." },
        { title: "Archive receipts", text: "Combine a small batch of clear receipt images into a single dated PDF while keeping the source photos on your device." },
      ]}
      decisionGuide={[
        { title: "A4 or US Letter", text: "Choose the paper size expected by the recipient or printer. A4 is common internationally; Letter is common in the United States and Canada." },
        { title: "Automatic orientation", text: "Let each page follow its image: wide images use landscape pages and tall or square images use portrait pages. Lock one orientation when a uniform document matters more." },
        { title: "Margin and image detail", text: "A larger margin creates breathing room but reduces the image on the page. Use a smaller margin for screenshots and fine print, then inspect the PDF at full size." },
      ]}
      limitations={[
        "Only still JPEG and PNG files are accepted. HEIC, WebP, GIF, TIFF, SVG and animated images need conversion to a still JPG or PNG first.",
        "The PDF contains raster images, not selectable text. Use OCR software after export when searchable text or accessible reading order is required.",
        "Camera metadata, filenames, color profiles and other source metadata are not intentionally copied into the PDF; check color and rotation in the result.",
        "Browser memory is limited. File-count, byte-size, decoded-pixel and prepared-output safeguards reject unusually large batches, and large accepted images are resampled to at most 240 DPI at their final page size.",
        "One image becomes one page. This tool does not split a tall image, add captions, password-protect the PDF or make a print-certified archival file.",
      ]}
      workflowLinks={[
        { href: "/converters/txt-to-pdf", label: "TXT to PDF", text: "Turn plain text notes into a paginated PDF without uploading them." },
        { href: "/editors/text", label: "Text editor", text: "Clean up accompanying notes before adding them to a separate PDF." },
        { href: "/editors/svg", label: "SVG editor", text: "Inspect or adjust a vector source before exporting it to a supported raster image." },
      ]}
      faqs={[
        { question: "Are my images uploaded?", answer: "No. Supported images are validated, decoded and placed into the PDF locally in your browser. WebTaskKit does not receive the files or their contents." },
        { question: "Can I combine both JPG and PNG files?", answer: "Yes. A batch may contain JPEG and PNG files in any order. Each accepted image becomes one PDF page, and transparent PNG areas are placed on white." },
        { question: "How do I control the PDF page order?", answer: "The file list is the page order. Use each row's Move up and Move down buttons before creating the PDF; the first listed image becomes page one." },
        { question: "Will images be cropped or stretched?", answer: "No. Images are scaled proportionally to fit within the selected page and margin. Empty space may remain when the page and image have different proportions." },
        { question: "Why was a large image or batch rejected?", answer: "Large compressed files can expand to hundreds of megabytes when decoded. The converter limits file count, source bytes and decoded pixels to protect browser stability." },
        { question: "Does the PDF preserve photo metadata or animated frames?", answer: "No. Source metadata is not intentionally copied, and animated images are not supported. Export the intended still frame as a JPG or PNG first." },
      ]}
    >
      <ImageToPdfTool />
    </ToolShell>
  );
}
