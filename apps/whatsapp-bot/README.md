# WhatsApp bot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys). It does three things:

- **Sends approved messages.** The web app's Send button reaches the bot's outbox (`outbox.js`, `127.0.0.1:8788`) through the server. The outbox sends only to `OUTBOX_ALLOWED`, or else to the `ALLOWED` list.
- **Answers replies as the family's advisor.** `ai.js` uses `gpt-5-mini` through the hackathon proxy. `contexto.js` remembers which family each chat is about.
  - **The rules** are in [`prompts/advisor-system.md`](prompts/advisor-system.md), a compact version of the team's master prompt. The full original is [`docs/advisor-master-prompt.md`](../../docs/advisor-master-prompt.md). They cover identity, couple psychology, the purchase traffic light, market drops, tax changes, proactive check-ins, numerical precision and the WhatsApp format. Edit them there. They are re-read on every reply, so no restart is needed.
  - **The family facts:** `prompt.js` fills `{{FAMILY_FACTS}}` with a short fact sheet built from `cases/<id>/`. It holds only the values the rules use, already formatted: profile D0–D6, concerns and tensions, score, goals, income, debts, insurance, cash, college and retirement facts, portfolio and past shocks, sectors, the savings priority order, 2026–2027 tax values and signals. It also adds today's date and the last message the advisor sent.
  - **Size, speed and cost:** about 4,000–4,500 prompt tokens per reply, instead of ~20,000 for the raw files. With `reasoning_effort: low` (override with `LLM_REASONING_EFFORT`), replies take about 7–13 s and cost well under one cent.
- **Lets you send from the terminal.** Type `34600111222 message` and press Enter.

## Run it

Usually together with the server, from the repo root: `npm run serve`. See the root README. On its own:

```bash
npm install
npm start
```

Settings come from the repo-root `.env`, loaded by `env.js`: `TEAM_KEY`, `LLM_PROXY_URL`, `OUTBOX_SECRET`, `ALLOWED` and optionally `BOT_DATA_DIR`.

On the first run a QR code appears. Scan it from WhatsApp (Settings, Linked devices).

## Local state stays local

`auth/` (the WhatsApp login), `recibidos/` (received audio) and `contexto.json` are git-ignored. They live in `BOT_DATA_DIR`, which defaults to this folder. Anyone with `auth/` can act as the linked number, so never commit it. If the session ends ("Sesión cerrada"), delete `auth/` and scan again.
