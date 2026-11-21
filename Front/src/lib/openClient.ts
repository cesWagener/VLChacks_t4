// openClient.ts — what happens when the advisor picks a client: their page in this app (/clients/:id),
// with the proposed message on top and the plan below. The original Sherpas shared plan stays one click away there.
import type { ClientSummary } from "./filters.ts";
import { CLIENTS_PATH, navigate } from "./router.ts";

const RECENT_KEY = "sherpas.clientMenu.recent.v1";
const RECENT_MAX = 5;

export const clientHref = (c: Pick<ClientSummary, "id">) => `${CLIENTS_PATH}/${encodeURIComponent(c.id)}`;

export function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberOpened(id: string) {
  try {
    const next = [id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage blocked: recents are a nice-to-have */ }
}

/** Opens a client from code (search panel, keyboard). Links in the table use clientHref directly. */
export function openClient(c: ClientSummary) {
  rememberOpened(c.id);
  navigate(clientHref(c));
}
