# WhatsApp bot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys). It does three things:

- **Sends approved messages.** The web app's Send button reaches the bot's outbox (`outbox.js`, `127.0.0.1:8788`) through the server. The outbox sends only to `OUTBOX_ALLOWED`, or else to the `ALLOWED` list.
- **Answers replies as the family's advisor.** `ai.js` uses `gpt-5-mini` through the hackathon proxy. `contexto.js` remembers which family each chat is about.
  - **The master prompt** is in [`prompts/advisor-system.md`](prompts/advisor-system.md). It sets the identity and the protocols: purchase traffic light, market drops, tax changes, proactive check-ins, numerical precision and WhatsApp format. Edit it there. It is re-read on every reply, so no restart is needed.
  - **Filling the prompt:** `prompt.js` fills its placeholders with that family's case files from `cases/<id>/`: `persona.md`, the financial-health and investment-analysis fields the prompt refers to, `legal-values.json` and `signals.json`. It also adds today's date, the reply language and the last message the advisor sent.
  - **Size, speed and cost:** about 75–90k characters of context per reply. Replies take 15–20 s and cost under one cent each.
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
