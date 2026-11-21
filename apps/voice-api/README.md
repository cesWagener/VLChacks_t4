# Sherpas Voice API

This standalone Node.js service turns a client’s recorded question into either a spoken answer or the original transcript. It uses the Sherpas case inventory and plan data, plus speech and GPT models through the Sherpas hackathon proxy. Audio replies are drafts for the trusted caller’s advisor-approval flow.

## Start the service

Use Node.js 22 or later and FFmpeg with the `libopus` encoder. Check your installation with `node --version` and `ffmpeg -encoders`. If FFmpeg is outside your `PATH`, set `FFMPEG_PATH` to the executable’s full path.

From the root where you extracted the ZIP:

~~~sh
cd apps/voice-api
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
~~~

On Windows PowerShell, the copy command is `Copy-Item .env.example .env`. Put the generated secret and the two Sherpas credentials into this module’s `.env`, or set the variables in the environment where it runs. The Sherpas credentials are available on [the hackathon access page](https://mcp-hackathon.sherpaswealth.com/personal-token).

~~~sh
npm run build
npm start
~~~

A successful startup logs a `listening` event. `GET http://127.0.0.1:8790/healthz` returns `{"ok":true}` when the process is listening. This liveness check uses zero Sherpas requests.

## Configuration

| Variable | Default or purpose |
| --- | --- |
| `TEAM_KEY` | Required. Team AI key for the Sherpas proxy. |
| `MCP_TOKEN` | Required. Personal Sherpas MCP bearer token. It expires after 72 hours and is replaced on a fresh login. |
| `LLM_PROXY_URL` | `https://llm-hackathon.sherpaswealth.com/v1`. The same origin without `/v1` is also accepted. |
| `MCP_URL` | `https://mcp-hackathon.sherpaswealth.com/mcp`. |
| `VOICE_API_SECRET` | Required. Independent random bearer secret with at least 32 characters. |
| `API_HOST`, `API_PORT` | `127.0.0.1` and `8790`. Serve remotely through a trusted HTTPS reverse proxy or private network. |
| `VOICE_API_ALLOWED_CASE_IDS` | Optional comma-separated case allowlist for the bearer secret. Defaults to the four published synthetic households. |
| `STT_MODEL` | `scribe-v2`. |
| `LLM_MODEL` | `gpt-5-mini`. |
| `TTS_MODEL`, `TTS_VOICE` | `eleven-flash-v2.5` and `alloy`. The proxy accepts a compatible voice name or an ElevenLabs voice ID. |
| `FFMPEG_PATH` | `ffmpeg`. |
| `MAX_AUDIO_BYTES`, `MAX_AUDIO_SECONDS` | 8 MiB uploaded audio and 60 seconds of decoded audio. |
| `MAX_CONCURRENT_REQUESTS`, `MODEL_REQUESTS_PER_MINUTE` | 2 concurrent requests and 30 proxy attempts per rolling minute per process. The maximum configured values are 4 and 60. |
| `VOICE_UPLOAD_TIMEOUT_MS`, `VOICE_REQUEST_TIMEOUT_MS` | 15,000 ms for the upload and 75,000 ms for the entire request. |
| `MODEL_TIMEOUT_MS`, `MCP_TIMEOUT_MS`, `FFMPEG_TIMEOUT_MS` | 18,000 ms per proxy operation, 10,000 ms per MCP session, and 8,000 ms per FFmpeg conversion. |
| `MCP_CACHE_TTL_MS` | 300,000 ms. Set to `0` to disable the in-memory inventory and section caches. |

The standalone process loads `.env` from its working directory. Values already set by the deployment environment take precedence. Configure the caller to hold only `VOICE_API_SECRET`. The secret identifies one trusted backend, which must authorize the actual client and map that identity to the right `caseId` before calling. Use the case allowlist to narrow the secret’s scope. The service also checks the ID against the MCP inventory.

## POST /api/voice

Send `multipart/form-data` with a single `caseId` text field and a single `audio` file field. Upload an `.ogg` voice note containing Opus audio. The service checks the actual format and converts it internally.

~~~sh
curl --fail-with-body http://127.0.0.1:8790/api/voice \
  -H "Authorization: Bearer YOUR_VOICE_API_SECRET" \
  -F "caseId=samantha-lewis" \
  -F "audio=@message.ogg;type=audio/ogg" \
  -o response.json
~~~

The same request from PowerShell:

~~~powershell
curl.exe --fail-with-body http://127.0.0.1:8790/api/voice -H "Authorization: Bearer YOUR_VOICE_API_SECRET" -F "caseId=samantha-lewis" -F "audio=@message.ogg;type=audio/ogg" -o response.json
~~~

When the full question is supported, the spoken answer is returned as Base64 OGG/Opus, with HTTP 200.

~~~json
{
  "success": true,
  "audioBase64": "<base64-encoded-audio>",
  "audioMimeType": "audio/ogg"
}
~~~

When any part of the question depends on outside information, unavailable case facts, or an advisor decision, the original transcript is returned as received from the proxy, with HTTP 200.

~~~json
{
  "success": false,
  "text": "What happened to the stock market today?"
}
~~~

Decode a successful answer to `reply.ogg` with Node.js:

~~~sh
node -e "const fs=require('node:fs');const r=JSON.parse(fs.readFileSync('response.json','utf8'));if(r.success!==true||r.audioMimeType!=='audio/ogg')throw new Error('Expected an OGG audio reply');fs.writeFileSync('reply.ogg',Buffer.from(r.audioBase64,'base64'))"
~~~

Play `reply.ogg` in an OGG/Opus-capable player. An external application can handle a transcript response separately.

## How processing works

1. The HTTP layer authenticates the bearer, limits uploads and concurrency, and checks the case ID against the case allowlist and Sherpas inventory.
2. FFmpeg verifies and decodes the OGG/Opus file. The service constructs bounded mono PCM WAV in memory and sends it to `POST /v1/audio/transcriptions`.
3. GPT routes the transcript through `POST /v1/chat/completions`. A timeless educational question can use the same call for its short spoken answer. A question about market news, recent SEC events, prices, or another external fact returns the transcript immediately. The same rule applies to a question that mixes such facts with known holdings.
4. For a case question, the official Streamable HTTP MCP SDK calls `get_case` for the needed parts and top-level sections. A second GPT call receives the relevant fields from that household’s records and decides whether the data supports a complete answer.
5. The service sends a supported answer to `POST /v1/audio/speech`, then converts the speech to mono OGG/Opus and returns it. Audio stays in bounded memory and FFmpeg communicates through pipes.

| Question | MCP context selected |
| --- | --- |
| What investments do I own? | `investment-analysis.positions`, including ticker, name, type, account and recorded value. |
| How much credit card debt do I have? | `financial-health.profile`, projected to `liabilities`. |
| What are my retirement goals? | `financial-health.goals`, retirement fields from `narrative`, and `projections`. |
| How risky is my portfolio? | Relevant `investment-analysis.key_metrics` entries and `persona`. |
| How would today’s Nvidia crash affect my investments? | Case inventory validation only. The whole question depends on an external event. |

Inventory and document caches have bounded lifetimes. Document cache keys include the exact household ID, part and section. The API reads cases through the MCP. It returns a service error when the MCP is unreachable. See the [challenge README](https://github.com/cesWagener/VLChacks_t4#connect-to-the-cases) and [case data](https://github.com/cesWagener/VLChacks_t4/tree/main/cases).

## Limits and troubleshooting

The hackathon README lists a team allowance of **$50**, with **$1.40** shared between ElevenLabs speech and transcription. Published rates include $0.22 per hour for `scribe-v2`, $0.04 per 1,000 characters for `eleven-flash-v2.5`, and $0.25/$2.00 per million input/output tokens for `gpt-5-mini`. The proxy has a shared team limit of 60 requests per minute and four concurrent requests or sessions. The MCP has a 120-request-per-minute limit per network. Keep other callers using the same key in mind. The service retries eligible transient HTTP responses once within its time budget and honors a longer `Retry-After` by returning control to the caller. Its logs contain error codes, timings and request IDs for correlation. Check remaining credits with the authenticated `/key/info` endpoint from the backend environment. [Sherpas limits and prices](https://github.com/cesWagener/VLChacks_t4#models-and-usage-prices)

| HTTP | Common cause or next check |
| --- | --- |
| `400` | Check both form fields, the case slug and whether the OGG file was fully recorded. |
| `401` | Check the voice API bearer secret. |
| `404` | Check that the client is in both the local allowlist and the MCP inventory. |
| `413` | Record a shorter note or check the configured byte and duration limits. |
| `415` | Check the form content type, file extension and OGG/Opus codec. |
| `422` | Record speech again with less background noise. |
| `502` | Check the stage in `error` and the upstream status in the service log. For MCP, get a fresh personal token if it has expired. For proxy failures, check the team key, remaining ElevenLabs allowance and model or voice name. |
| `503` | Check `Retry-After` for concurrency or rate limits. Check `FFMPEG_PATH` if the code is `AUDIO_PROCESSOR_UNAVAILABLE`. |
| `504` | A request or an upstream step reached its deadline. Check network latency and audio length. |

Operational errors use an error code and message with the applicable HTTP status.

~~~json
{
  "error": "TRANSCRIPTION_FAILED",
  "message": "Unable to transcribe the supplied audio."
}
~~~

## Tests and live smoke test

Run `npm test` inside `apps/voice-api`. The suite exercises the real HTTP service over a local socket, generates test tones with FFmpeg, and mocks the Sherpas endpoints. It verifies the official MCP SDK’s requests and the two HTTP 200 contracts, along with invalid uploads, authorization, missing data, and upstream failures. It consumes zero Sherpas credits.

To smoke-test with your own Sherpas credentials, start the service and call the endpoint twice using short, real voice notes and one case in your allowlist.

1. Record “What stocks or ETFs are in my plan?” Send it with `caseId=samantha-lewis`. Verify `success:true`, decode `reply.ogg`, and compare what it says with the recorded positions in the Samantha case.
2. Record “What did the SEC announce this morning?” Verify `success:false` and that `text` contains the transcription of the message. The result contains exactly `success` and `text`.
3. If the response is an HTTP error, use the `x-request-id` response header to find the stage in the service log.

The automated suite checks the protocol and media handling against mocks. Run the above steps to verify your live proxy key, MCP access and the generated voice.

## Add it to the existing repository

Extract `Sherpas-Voice-API.zip` into the repository root. The archive creates `apps/voice-api/` with its own package, lockfile, code, tests and example environment configuration. Run the install and start commands from that directory. The module is a standalone HTTP service and the ZIP contains only its files.
