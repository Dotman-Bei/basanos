import { CertificatePage } from "./pages/Certificate";
import { Home } from "./pages/Home";
import { Terminal } from "./pages/Terminal";
import { VerdictPage } from "./pages/Verdict";
import { routeHref, useRoute } from "./routes";

export function Header() {
  return (
    <header className="nav">
      <div className="wrap">
        <a className="link" href={routeHref({ name: "home" })} aria-label="Basanos home">
          <span className="mark" data-mark="ring" aria-hidden="true" /> Basanos
        </a>
        <nav aria-label="Main">
          <a className="link" href={routeHref({ name: "home" })}>
            Verdicts
          </a>
        </nav>
        <a className="btn btn--secondary" href={routeHref({ name: "challenge" })}>
          Take a challenge
        </a>
      </div>
    </header>
  );
}

export function App() {
  const route = useRoute();
  return (
    <>
      <Header />
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
