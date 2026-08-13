export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <div className="footer-brand">WebTaskKit</div>
          <p>Everyday web tasks, handled.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="/#tools">All tools</a>
          <a href="/privacy">Privacy</a>
          <a href="/about">About</a>
        </nav>
        <p className="site-footer__note">Built for the browser. Designed for the task.</p>
      </div>
    </footer>
  );
}
