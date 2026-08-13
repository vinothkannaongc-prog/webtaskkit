export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="wordmark" href="/" aria-label="WebTaskKit home">
          <span className="wordmark__mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="wordmark__name"><span>WebTask</span><b>Kit</b></span>
        </a>
        <nav className="main-nav" aria-label="Primary navigation">
          <a href="/generators">Generators</a>
          <a href="/converters">Converters</a>
          <a href="/editors">Editors</a>
          <a className="nav-all" href="/#tools">All tools</a>
        </nav>
      </div>
    </header>
  );
}
