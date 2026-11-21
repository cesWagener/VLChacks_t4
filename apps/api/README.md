# API (backend)

The web app's backend. It keeps the keys and talks to the hackathon AI proxy (`https://llm-hackathon.sherpaswealth.com`, OpenAI-compatible). The browser never sees a key: the web app calls `/api/...`, and Vite forwards those calls here.

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

## Limits

The server allows at most 3 AI calls at once and 20 a minute, below the team limits (4 and 60), because teammates share the key. One rewrite costs about 1,700 tokens with `gpt-5-mini`, well under a cent. To check what the team has spent, see the challenge README ("Check your AI credits").
