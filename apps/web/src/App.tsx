import { useEffect, useState } from "react";
import { CertificatePage } from "./pages/Certificate";
import { Home } from "./pages/Home";
import { Terminal } from "./pages/Terminal";
import { VerdictPage } from "./pages/Verdict";
import { routeHref, useRoute, type Route } from "./routes";

// The kit's header (docs/design/frontend.md; packages/design/vendor/system.css, "navigation"; the kit's own
// assets/layout/hero-collage.html): <header class="nav"><div class="wrap nav__bar"> holding .nav__logo,
// .nav__links (.nav__item > .nav__link), .nav__actions (the one filled button) and .nav__toggle, which opens the
// phone sheet below 1024px. React state stands in for the kit's system.js: a toggle click, Escape, a link tap and a
// resize to desktop width open or close the sheet, and body.nav-locked keeps the page from scrolling under it.
const BARS = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M2 5h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const CROSS = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export function Header(props: { current?: Route["name"] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.classList.toggle("nav-locked", open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const wide = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)") : null;
    const onWide = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    wide?.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide?.removeEventListener("change", onWide);
      document.body.classList.remove("nav-locked");
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <header className={open ? "nav is-open" : "nav"}>
      <div className="wrap nav__bar">
        <a className="nav__logo" href={routeHref({ name: "home" })} aria-label="Basanos home" onClick={close}>
          <span className="mark" data-mark="ring" aria-hidden="true" />
          Basanos
        </a>
        <nav className="nav__links" aria-label="Main">
          <div className="nav__item">
            <a className="nav__link" href={routeHref({ name: "home" })} aria-current={props.current === "home" ? "page" : undefined} onClick={close}>
              Verdicts
            </a>
          </div>
        </nav>
        <div className="nav__actions">
          <a className="btn btn--primary" href={routeHref({ name: "challenge" })} onClick={close}>
            Take a challenge
          </a>
        </div>
        <button type="button" className="nav__toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? CROSS : BARS}
        </button>
      </div>
    </header>
  );
}

export function App() {
  const route = useRoute();
  return (
    <>
      <Header current={route.name} />
      <main className="app-main">
        {route.name === "challenge" ? (
          <Terminal />
        ) : route.name === "run" ? (
          <VerdictPage runId={route.runId} />
        ) : route.name === "cert" ? (
          <CertificatePage runId={route.runId} />
        ) : (
          <Home />
        )}
      </main>
    </>
  );
}
