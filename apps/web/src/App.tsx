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
        <div className="wrap">
          <p className="label">Route: {route.name}</p>
        </div>
      </main>
    </>
  );
}
