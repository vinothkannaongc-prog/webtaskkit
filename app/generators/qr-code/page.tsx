import type { Metadata } from "next";
import { QRCodeTool } from "@/components/tools/QRCodeTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = { title: "Free QR Code Generator - PNG & SVG", description: "Create a custom QR code for a link or text and download PNG or SVG. Free, private and no signup." };
const tool = getTool("qr-code");
export default function QRCodePage() {
  return <ToolShell tool={tool} intro="Turn links, text and contact details into a scannable QR code. Customize the colors and size, then download a crisp PNG or SVG." steps={["Enter the link or text you want the code to contain.", "Choose its size, colors and error-correction level.", "Scan the preview, then download PNG or SVG."]} features={[{ title: "Static and dependable", text: "The destination is encoded directly in the image, so the QR code does not expire." }, { title: "Print-friendly output", text: "Export a high-resolution PNG or infinitely scalable SVG." }, { title: "Private generation", text: "Your content is encoded on this device and never sent to our servers." }]} faqs={[{ question: "Do generated QR codes expire?", answer: "No. These are static QR codes, so they continue to work as long as the encoded content remains useful." }, { question: "Is the information inside my QR code stored?", answer: "No. Generation happens locally in your browser and QuietTools does not receive the content." }, { question: "Which colors scan best?", answer: "Use a dark foreground on a light background and keep the quiet margin around the code." }, { question: "Is SVG or PNG better for printing?", answer: "SVG scales cleanly for professional print. PNG is convenient for documents, email and web pages." }]}><QRCodeTool /></ToolShell>;
}
