// phones.ts — which WhatsApp number plays each family in the demo (one test phone per family).
// Set from the family's page in the web app; shared by every device that uses the server.
// Stored in apps/api/data/phones.json (git-ignored), or PHONES_FILE.
// Messages for a family go to its phone; that phone's replies are answered as that family.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmError as ApiError } from "./llm.ts";

const FILE = process.env.PHONES_FILE || fileURLToPath(new URL("../data/phones.json", import.meta.url));

type Phones = Record<string, string>; // clientId -> phone ("34611222333") or a WhatsApp JID ("…@lid")

function load(): Phones {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}

function save(p: Phones) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(p, null, 2));
}

/** "+34 611 22 23 33" -> "34611222333"; a full JID is kept as is. Throws on anything else. */
export function normalizePhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^[0-9]{6,20}@(lid|s\.whatsapp\.net)$/.test(s)) return s;
  const digits = s.replace(/[\s().+-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) throw new ApiError("Enter the number with its country code, digits only (e.g. +34 611 222 333).", 400);
  return digits;
}

export const allPhones = (): Phones => load();
export const phoneFor = (clientId: string): string => load()[clientId] ?? "";

/** Sets (or clears, with "") the family's phone. One phone cannot play two families: replies would mix. */
export function setPhone(clientId: string, raw: unknown, familyName: (id: string) => string) {
  const phone = normalizePhone(raw);
  const phones = load();
  if (phone) {
    const other = Object.entries(phones).find(([id, p]) => id !== clientId && p === phone);
    if (other) throw new ApiError(`This number already plays ${familyName(other[0])}. Use a different phone per family, or clear it there first.`, 409);
    phones[clientId] = phone;
  } else {
    delete phones[clientId];
  }
  save(phones);
  return phone;
}
