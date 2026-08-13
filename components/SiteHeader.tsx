import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="wordmark" href="/" aria-label="QuietTools home">
          <span className="wordmark__mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>QuietTools</span>
        </Link>
        <nav className="main-nav" aria-label="Primary navigation">
          <Link href="/generators/">Generators</Link>
          <Link href="/converters/">Converters</Link>
          <Link href="/editors/">Editors</Link>
          <Link className="nav-all" href="/#tools">All tools</Link>
        </nav>
      </div>
    </header>
  );
}
