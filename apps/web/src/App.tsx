import { createContext, useEffect } from "react";
import { CLIENTS_PATH, usePathname } from "./lib/router.ts";
import { useSession } from "./lib/session.ts";
import { ClientsPage } from "./pages/ClientsPage.tsx";
import { ClientPlanPage } from "./pages/ClientPlanPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";

/** Lets the header offer "Log out" only when the server requires a password. */
export const LogoutContext = createContext<(() => void) | null>(null);

export function App() {
  const path = usePathname();
  const { session, login, logout } = useSession();
  const detail = path.match(/^\/clients\/([^/]+)\/?$/);

  // Anything that is not a known route goes to the client menu.
  const known = path === CLIENTS_PATH || Boolean(detail);
  useEffect(() => {
    if (!known) window.history.replaceState(null, "", `${CLIENTS_PATH}${window.location.search}`);
  }, [known]);

  if (session.status === "loading") return null;
  if (session.required && !session.authenticated) return <LoginPage onLogin={login} />;

  return (
    <LogoutContext.Provider value={session.required ? () => void logout() : null}>
      {detail
        ? <ClientPlanPage id={decodeURIComponent(detail[1])} />
        // Keyed by path so returning from a client page re-reads the filters from the URL.
        : <ClientsPage key={CLIENTS_PATH} />}
    </LogoutContext.Provider>
  );
}
