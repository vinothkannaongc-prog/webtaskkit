import type { Metadata } from "next";
import { ToneGeneratorTool } from "@/components/tools/ToneGeneratorTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = { title: "Online Tone Generator - Frequency & Waveform", description: "Generate sine, square, triangle or sawtooth tones by frequency safely in your browser." };
const tool = getTool("tone");
export default function TonePage() {
  return <ToolShell tool={tool} intro="Enter a frequency, choose a waveform and play a precise audio tone directly in your browser for speaker checks, pitch comparison and sound experiments." steps={["Lower your device volume before starting.", "Set a frequency and choose the waveform and output level.", "Press Play, listen briefly, and press Stop when finished."]} features={[{ title: "Precise controls", text: "Set any frequency from 20 Hz to 20 kHz or jump to a useful preset." }, { title: "Four waveforms", text: "Compare sine, square, triangle and sawtooth waves." }, { title: "Click-free playback", text: "Gentle gain ramps reduce abrupt clicks when starting and stopping." }]} faqs={[{ question: "What do Hz and kHz measure?", answer: "Hertz measures cycles per second. One kilohertz equals 1,000 hertz." }, { question: "Why can I not hear some frequencies?", answer: "Hearing range varies by person, while speakers and headphones also have reproduction limits." }, { question: "Can this calibrate equipment?", answer: "It is useful for informal checks, but browser and hardware output are not a substitute for calibrated laboratory equipment." }, { question: "How can I use tones safely?", answer: "Start at a very low volume, listen briefly, avoid headphones when possible, and stop immediately if you feel discomfort." }]}><ToneGeneratorTool /></ToolShell>;
}
