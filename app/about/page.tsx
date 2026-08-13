import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About", description: "QuietTools builds fast, focused browser utilities with private local processing and no signup." };
export default function AboutPage() {
  return <main className="legal-page section-wrap"><div className="breadcrumbs"><Link href="/">Home</Link><span>/</span><span>About</span></div><p className="eyebrow">Why QuietTools exists</p><h1>Useful tools should feel quiet.</h1><p className="page-lead">QuietTools is a small collection of focused browser utilities: quick to open, clear to use and respectful of your content.</p><div className="prose"><h2>Our product promise</h2><p>No mandatory account, no artificial waiting screen and no tool input sent to a server when modern browsers can do the job locally.</p><h2>Built for useful outcomes</h2><p>Every tool begins with a real working area, then explains the format, limitations and next step. Clean downloads matter more than a large directory count.</p><h2>What comes next</h2><p>We will improve these six tools based on completion, reliability and genuine user needs before adding more. Browse the <Link href="/#tools">current tools</Link> and choose the one that gets your task done.</p></div></main>;
}
