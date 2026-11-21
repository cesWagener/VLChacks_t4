import { useContext, type MouseEvent } from "react";
import { LogoutContext } from "../App.tsx";
import { CLIENTS_PATH, navigate, withDataParam } from "../lib/router.ts";

// The existing Sherpas nav from the video, plus the new "Clients" item. Only Clients is part of this build.
const NAV = ["Opportunities", "Clients", "Contacts", "Portfolios", "Data Extraction"];

export function AppHeader({ current = "Clients" }: { current?: string }) {
  const logout = useContext(LogoutContext);
  const goClients = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(withDataParam(CLIENTS_PATH));
  };
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a className="brand" href={CLIENTS_PATH} onClick={goClients} aria-label="Sherpas, go to Clients">sherpas</a>
        <nav className="app-nav" aria-label="Main">
          {NAV.map(item =>
            item === "Clients" ? (
              <a
                key={item}
                className="app-nav__link"
                href={CLIENTS_PATH}
                aria-current={current === item ? "page" : undefined}
                onClick={goClients}
              >
                {item}
              </a>
            ) : (
              <span key={item} className="app-nav__link" aria-disabled="true" title="Not part of this demo">
                {item}
              </span>
            ),
          )}
        </nav>
        {logout && <button type="button" className="link-button app-header__logout" onClick={logout}>Log out</button>}
        <span className="avatar" aria-label="Signed in as David">DV</span>
      </div>
    </header>
  );
}
