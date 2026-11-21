// planSource.ts — loads one family's plan page data (public/plans/<id>.json, built by scripts/build-plans.ts).
// Like clientsSource.ts, this is the single place to swap for another source later.
import type { PlanData } from "./plan.ts";

const cache = new Map<string, Promise<PlanData | null>>();

export function loadPlan(id: string, { fresh = false } = {}): Promise<PlanData | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return Promise.resolve(null);
  if (!fresh && cache.has(id)) return cache.get(id)!;
  const promise = fetch(`${import.meta.env.BASE_URL}plans/${id}.json`).then(res => {
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load the plan (HTTP ${res.status})`);
    // Vite's dev server answers unknown paths with index.html; treat that as "not found".
    if (!(res.headers.get("content-type") ?? "").includes("json")) return null;
    return res.json() as Promise<PlanData>;
  });
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  return promise;
}
