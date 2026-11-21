# WhatsApp bot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys). It does three things:

- **Sends approved messages.** The web app's Send button reaches the bot's outbox (`outbox.js`, `127.0.0.1:8788`) through the server. The outbox sends only to `OUTBOX_ALLOWED`, or else to the `ALLOWED` list.
- **Answers replies with the AI.** `ai.js` uses `gpt-5-mini` through the hackathon proxy, with only the facts of that family's plan and the last message the advisor sent. `contexto.js` remembers which family each chat is about.
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
