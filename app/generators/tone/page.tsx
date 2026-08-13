import type { Metadata } from "next";
import { ToneGeneratorTool } from "@/components/tools/ToneGeneratorTool";
import { ToolShell } from "@/components/ToolShell";
import { getTool } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Online Tone Generator - Frequency & Waveform",
  description: "Generate sine, square, triangle or sawtooth tones by frequency safely in your browser.",
  alternates: { canonical: "/generators/tone" },
};

const tool = getTool("tone");

export default function TonePage() {
  return (
    <ToolShell
      tool={tool}
      intro="Enter a frequency, choose a waveform and play a precise audio tone directly in your browser for speaker checks, pitch comparison and sound experiments."
      steps={[
        "Lower both the tool and device volume before starting, especially if headphones are connected.",
        "Set a frequency from 20 Hz to 20 kHz and choose the waveform you need.",
        "Play the tone briefly, make one controlled change at a time, and stop immediately if it feels uncomfortable.",
      ]}
      features={[
        { title: "Precise controls", text: "Enter a frequency from 20 Hz to 20 kHz or jump to a useful preset." },
        { title: "Four waveforms", text: "Compare sine, square, triangle and sawtooth waves through the browser audio engine." },
        { title: "Click-free playback", text: "Gentle gain ramps reduce abrupt clicks when starting and stopping." },
      ]}
      practicalExamples={[
        { title: "Compare a musical pitch", text: "Start with the 440 Hz A preset and a low-volume sine wave, then compare it with an instrument or another reference source." },
        { title: "Trace a playback problem", text: "Try a few separated frequencies at the same low level to check whether a buzz or dropout appears in a particular region." },
        { title: "Learn how waveforms differ", text: "Hold frequency and volume constant while switching between sine, triangle, square and sawtooth to hear the effect of added harmonics." },
      ]}
      decisionGuide={[
        { title: "Use sine for a clean reference", text: "A sine wave contains one fundamental frequency and is the clearest starting point for pitch comparisons and informal response checks." },
        { title: "Use complex waves for timbre experiments", text: "Triangle, square and sawtooth waves add harmonics, so they sound brighter and may expose different resonances." },
        { title: "Use measurement gear for calibration", text: "The browser is suitable for quick comparisons. Calibrating levels, hearing thresholds or laboratory equipment requires a known signal chain and proper instruments." },
      ]}
      limitations={[
        "Keep playback brief and quiet. Loud tones can damage hearing or equipment, and very high frequencies may be inaudible while still stressing some speakers.",
        "Your browser, operating system, sound card, amplifier and speakers can all alter the level and frequency response.",
        "The tool generates a signal but does not measure acoustic output, distortion, latency or hearing ability.",
        "No audio is recorded or uploaded; the waveform is produced by the browser on this device.",
      ]}
      workflowLinks={[
        { href: "/editors/text", label: "Record test observations", text: "Keep a plain-text log of the device, frequency, waveform, level and result for repeatable comparisons." },
        { href: "/converters/txt-to-pdf", label: "Make a test checklist", text: "Turn a finalized speaker-check procedure or observation log into a shareable PDF." },
        { href: "/generators/qr-code", label: "Share the test page", text: "Create a QR code for this tool when a technician needs to open it on another device." },
      ]}
      faqs={[
        { question: "What do Hz and kHz measure?", answer: "Hertz measures cycles per second. One kilohertz equals 1,000 hertz." },
        { question: "Why can I not hear some frequencies?", answer: "Hearing range varies by person, while speakers, headphones and the rest of the playback chain also have reproduction limits." },
        { question: "Can this calibrate equipment?", answer: "It is useful for informal checks, but browser and hardware output are not a substitute for calibrated signal sources and measurement equipment." },
        { question: "How can I use tones safely?", answer: "Start at a very low volume, listen briefly, avoid headphones when possible, keep children and pets away from the test, and stop immediately if you feel discomfort." },
      ]}
    >
      <ToneGeneratorTool />
    </ToolShell>
  );
}
