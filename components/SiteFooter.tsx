import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <div className="footer-brand">WebTaskKit</div>
          <p>Everyday web tasks, handled.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/#tools">All tools</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/about">About</Link>
        </nav>
        <p className="site-footer__note">Built for the browser. Designed for the task.</p>
      </div>
    </footer>
  );
}
