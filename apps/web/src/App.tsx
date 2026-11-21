import { useEffect } from "react";
import { CLIENTS_PATH, usePathname } from "./lib/router.ts";
import { ClientsPage } from "./pages/ClientsPage.tsx";
import { ClientPlanPage } from "./pages/ClientPlanPage.tsx";

export function App() {
  const path = usePathname();
  const detail = path.match(/^\/clients\/([^/]+)\/?$/);

  // Anything that is not a known route goes to the client menu.
  const known = path === CLIENTS_PATH || Boolean(detail);
  useEffect(() => {
    if (!known) window.history.replaceState(null, "", `${CLIENTS_PATH}${window.location.search}`);
  }, [known]);

  if (detail) return <ClientPlanPage id={decodeURIComponent(detail[1])} />;
  // Keyed by path so returning from a client page re-reads the filters from the URL.
  return <ClientsPage key={CLIENTS_PATH} />;
}
