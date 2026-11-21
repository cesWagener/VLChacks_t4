# Server (API + web app)

The web app's server. It keeps the keys, talks to the hackathon AI proxy (`https://llm-hackathon.sherpaswealth.com`, OpenAI-compatible), hands approved messages to the WhatsApp bot, and, when `apps/web/dist` exists (`npm run web:build`), serves the web app too, with `index.html` for app routes. The browser never sees a key.

**Password:** when `APP_PASSWORD` is set, the app shows a login page. `/api/messages/*` and `/api/whatsapp/*` answer 401 without a session. The session is an HttpOnly cookie that lasts 12 hours, and logins are limited to 10 attempts per 5 minutes per IP. `npm run serve` refuses to start without a password.

**Address:** `HOST` and `PORT`, by default `127.0.0.1:8787`. A tunnel or hosting platform forwards to it.

## Run it

Needs Node 22.6 or later. No dependencies to install.

```bash
# 1. once: create the .env at the repo root (see .env.example)
# 2. start the API, then the web app, in two terminals:
npm run api        # http://127.0.0.1:8787
npm run web        # http://localhost:5173/clients
```

## Check the connections

```bash
npm run api:check   # from the repo root (or: npm run check, from apps/api)
```

It checks the `.env` values, the AI proxy (the key, the budget left, and one tiny model call costing a fraction of a cent), the MCP case server (`list_cases`), and whether this API is running. It never prints key values. Exit code 1 means a check failed.

## Environment

Read from the repo-root `.env` (git-ignored). `.env.example` lists the variables:

| Variable | Used for |
|---|---|
| `TEAM_KEY` | AI proxy, team key ($50 shared budget) |
| `LLM_PROXY_URL` | AI proxy address |
| `MCP_URL`, `MCP_TOKEN` | Case data through the MCP (not used yet; the app reads `cases/`) |
| `LLM_MODEL` | Optional. Defaults to `gpt-5-mini` |
| `API_PORT` | Optional. Defaults to `8787` |

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ ok, ai, model }` |
| POST | `/api/messages/rewrite` | `{ clientId, tone?, issueKeys? }` | `{ subject, body, tone, model }` |

`/api/messages/rewrite` builds the rule-based draft on the server, from the family's plan (`apps/web/public/plans/<id>.json`), using the same code as the web app (`apps/web/src/lib/message.ts`). It then asks the model to make it sound personal. The model gets only facts from the plan, plus rules: use no other numbers, make no guarantees, recommend no products. The browser can only choose the family, the tone and the topics. It cannot send facts or instructions.

| GET | `/api/whatsapp/status` | | `{ configured, reachable, connected, recipient }` |
| POST | `/api/messages/send` | `{ clientId, subject, body }` | `{ sent, to, family, at }` |

## Sending on WhatsApp

On a family's page, once the advisor approves the message, **Send via WhatsApp** appears. The message travels web app, then this API (`POST /api/messages/send`), then the team's bot (`wabot/outbox.js`, `POST /send`), which sends it through the bot's own WhatsApp session.

- **Recipient:** always `WHATSAPP_DEMO_TO` from `.env`. The four families are fictional, so messages go to the team's demo phone, never to a real client. The bot double-checks this: it only sends to numbers in `OUTBOX_ALLOWED`, or else in its `ALLOWED` list.
- **Shared secret:** the API and the bot must have the same `OUTBOX_SECRET` in their `.env`. Without it, the outbox stays off.
- **Bot on another laptop:** the bot listens on port 8788 of its own laptop. Guest and event Wi-Fi usually block laptops from reaching each other, so the bot's laptop opens a free tunnel, with no account needed:
  ```bash
  winget install --id Cloudflare.cloudflared      # once (macOS: brew install cloudflared)
  cloudflared tunnel --url http://localhost:8788  # prints https://<random>.trycloudflare.com
  ```
  Put that address in `OUTBOX_URL` in the `.env` of the laptop running the API. The API re-reads it on every send, so no restart is needed. The address changes each time the tunnel restarts. On a network where laptops can reach each other, `OUTBOX_URL=http://<bot-laptop-ip>:8788` also works; the bot prints that line when it starts.
- **Replies:** when the client answers on WhatsApp, the bot replies with the AI (`wabot/ai.js`, `gpt-5-mini` through the proxy). It uses only that family's plan (`apps/web/public/plans/<id>.json`) and the last message the advisor sent. Each send records which family a chat is about (`wabot/contexto.json`, git-ignored). The bot's laptop needs `TEAM_KEY` and `LLM_PROXY_URL` in its `.env`, from the "For your backend" block on the access page.
- **Check it:** run `npm run api:check`. Check 5 reports whether the bot is reachable and logged in to WhatsApp.

## Limits

The server allows at most 3 AI calls at once and 20 a minute, below the team limits (4 and 60), because teammates share the key. One rewrite costs about 1,700 tokens with `gpt-5-mini`, well under a cent. To check what the team has spent, see the challenge README ("Check your AI credits").
