// router.ts — minimal History API router. Two routes don't need a routing library:
//   /clients       the client menu
//   /clients/:id   placeholder for a client without a Sherpas plan (simulated families)
import { useEffect, useState } from "react";

export const CLIENTS_PATH = "/clients";
const NAV_EVENT = "app:navigate";

export function navigate(to: string) {
  window.history.pushState({ inApp: true }, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** True when the current entry was reached from inside the app, so Back stays in the app. */
export const cameFromApp = () => Boolean((window.history.state as { inApp?: boolean } | null)?.inApp);

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);
  return path;
}

/** Keeps `?data=real` when moving between pages. */
export function withDataParam(path: string) {
  const data = new URLSearchParams(window.location.search).get("data");
  return data ? `${path}?data=${encodeURIComponent(data)}` : path;
}
