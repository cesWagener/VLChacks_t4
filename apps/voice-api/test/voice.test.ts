import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test, type TestContext } from 'node:test';
import { assertOggOpus, verifyFfmpeg } from '../src/audio.js';
import { readConfig, type Config } from '../src/config.js';
import type { Fetch } from '../src/net.js';
import { createVoiceServer } from '../src/server.js';

const secret = 'test-only-voice-secret-for-mocked-requests';
const env = {
  TEAM_KEY: 'test-team-key',
  MCP_TOKEN: 'test-mcp-token',
  VOICE_API_SECRET: secret,
  TTS_VOICE: 'test-voice',
  FFMPEG_PATH: process.env.FFMPEG_PATH,
};
const defaultConfig = readConfig(env);
const firstCase = 'samantha-lewis';
const secondCase = 'michael-carter';

let inputOgg: Buffer;
let fakeSpeech: Buffer;

function tone(frequency: number, format: 'ogg' | 'mp3', duration = 0.25): Buffer {
  const result = spawnSync(defaultConfig.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=' + frequency + ':duration=' + duration,
    ...(format === 'ogg' ? ['-c:a', 'libopus'] : []),
    '-f', format, 'pipe:1',
  ]);
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

before(() => {
  verifyFfmpeg(defaultConfig.ffmpegPath);
  inputOgg = tone(480, 'ogg');
  fakeSpeech = tone(780, 'mp3');
});

interface MockOptions {
  transcript?: string;
  route?: unknown;
  grounded?: unknown;
  unavailableSection?: boolean;
  mismatchedCase?: boolean;
  failMcp?: boolean;
  failStage?: string;
  timeoutStage?: string;
  retryOnce?: string;
  blockStage?: { path: string; entered: () => void; release: Promise<void> };
}

const stt = '/v1/audio/transcriptions';
const chat = '/v1/chat/completions';
const tts = '/v1/audio/speech';

interface ToolCall {
  name: string;
  args: Record<string, string>;
}

interface ChatInput {
  transcript: string;
  evidence?: Array<{ source: string; data: unknown }>;
}

function mockUpstreams(options: MockOptions) {
  const calls = {
    proxy: [] as string[],
    mcp: [] as ToolCall[],
    chats: [] as ChatInput[],
    spoken: [] as string[],
  };
  const fetcher: Fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(init?.redirect, 'error');
    if (url.origin === defaultConfig.mcpUrl.origin) {
      assert.equal(request.headers.get('authorization'), 'Bearer ' + env.MCP_TOKEN);
      assert.equal(url.pathname, '/mcp');
      if (options.failMcp) throw new TypeError('Mock network failure');
      if (request.method === 'GET') return new Response(null, { status: 405 });

      const rpc = await request.json() as {
        method: string;
        id?: number;
        params?: { name: string; arguments: Record<string, string> };
      };
      const envelope = (result: object) => ({ jsonrpc: '2.0', id: rpc.id, result });
      const reply = (result: object) => Response.json(envelope(result));
      if (rpc.method === 'initialize') {
        return reply({
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-sherpas-mcp', version: '1.0.0' },
        });
      }
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
      assert.equal(rpc.method, 'tools/call');
      assert.ok(rpc.params);
      const { name, arguments: args } = rpc.params;
      calls.mcp.push({ name, args });

      const textBlock = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];
      if (name === 'list_cases') {
        return reply({ content: textBlock({ cases: [{ caseId: firstCase }, { slug: secondCase }] }) });
      }
      assert.equal(name, 'get_case');
      const cid = args.caseId;
      assert.ok(cid === firstCase || cid === secondCase);
      if (options.unavailableSection) return reply({ content: textBlock({ ...args, value: null }) });

      let value: unknown;
      switch (args.part + '.' + args.section) {
        case 'financial-health.profile':
          value = {
            liabilities: [{ name: 'Sample Credit Card', type: 'Credit card', balance: 2_300, interest_rate: 0.21 }],
            incomes: [{ name: 'Test salary', yearly: 123_456 }],
          };
          break;
        case 'investment-analysis.positions':
          value = [{
            account: 'Sample brokerage', ticker: cid === firstCase ? 'VTI' : 'MSFT',
            name: 'Sample holding', type: cid === firstCase ? 'ETF' : 'Stock',
            category: 'Equity', value: 3_750, weight_in_account: 0.4, expense_ratio: 0.0003,
          }];
          break;
        case 'investment-analysis.key_metrics':
          value = { performanceAnalysis: { household: { volatility3y: 0.15 } } };
          break;
        case 'persona.undefined':
          return reply({ content: [{ type: 'text', text: '# Sample persona\nModerate risk tolerance.' }] });
        case 'financial-health.goals':
          value = { goalsSummary: [{ goalType: 'Retirement', value: 'Retire at 62' }], chartGoals: [] };
          break;
        case 'financial-health.narrative':
          value = { retirement_short_observations: 'Test retirement observations.' };
          break;
        case 'financial-health.projections':
          value = { yearly: [{ year: 2044, net_worth: 410_000 }] };
          break;
        default:
          assert.fail('Unexpected MCP section ' + JSON.stringify(args));
      }

      const sectionResult = { ...args, caseId: options.mismatchedCase ? 'another-case' : cid, value };
      // Exercise both JSON in a text block and JSON-RPC over an SSE response.
      const payload = envelope({ content: textBlock(sectionResult) });
      return new Response('data: ' + JSON.stringify(payload) + '\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    }

    assert.equal(url.origin, new URL(defaultConfig.proxyUrl).origin);
    assert.equal(request.headers.get('authorization'), 'Bearer ' + env.TEAM_KEY);
    assert.equal(request.method, 'POST');
    const path = url.pathname;
    calls.proxy.push(path);

    if (options.blockStage?.path === path) {
      options.blockStage.entered();
      await options.blockStage.release;
    }
    if (options.timeoutStage === path) {
      await new Promise<void>((_resolve, reject) => {
        if (request.signal.aborted) reject(request.signal.reason);
        else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    }
    if (options.failStage === path) {
      return Response.json({ error: 'sensitive upstream diagnostic' }, {
        status: 503, headers: { 'retry-after': '60' },
      });
    }
    if (options.retryOnce === path && calls.proxy.filter((item) => item === path).length === 1) {
      return new Response(null, { status: 503 });
    }

    if (path === stt) {
      const form = await request.formData();
      assert.equal(form.get('model'), 'scribe-v2');
      const file = form.get('file');
      assert.ok(file instanceof File);
      assert.equal(file.name, 'message.wav');
      assert.equal(file.type, 'audio/wav');
      const wav = Buffer.from(await file.arrayBuffer());
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      assert.equal(wav.readUInt32LE(24), 16_000);
      assert.equal(wav.readUInt32LE(40), wav.length - 44);
      return Response.json({ text: options.transcript ?? 'How much credit card debt do I have?' });
    }

    const json = await request.json() as Record<string, unknown>;
    if (path === chat) {
      assert.equal(json.model, 'gpt-5-mini');
      assert.equal(json.max_completion_tokens, 2_200);
      const messages = json.messages as Array<{ role: string; content: string }>;
      assert.equal(messages[0]?.role, 'system');
      const received = JSON.parse(messages[1]!.content) as ChatInput;
      calls.chats.push(received);
      const format = json.response_format as { type: string; json_schema: { name: string; strict: boolean } };
      assert.equal(format.type, 'json_schema');
      assert.equal(format.json_schema.strict, true);
      let data: unknown;
      if (format.json_schema.name === 'voice_question_route') {
        data = options.route ?? { route: 'case', topics: ['liabilities'], answer: '' };
      } else {
        assert.equal(format.json_schema.name, 'voice_case_answer');
        data = options.grounded ?? {
          decision: 'answer', answer: 'Your plan records two thousand three hundred dollars on your credit card.',
        };
      }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] });
    }

    assert.equal(path, tts);
    assert.equal(json.model, 'eleven-flash-v2.5');
    assert.equal(json.voice, 'test-voice');
    assert.equal(json.response_format, 'mp3');
    assert.equal(typeof json.input, 'string');
    calls.spoken.push(json.input as string);
    return new Response(Uint8Array.from(fakeSpeech), { headers: { 'content-type': 'audio/mpeg' } });
  };
  return { fetcher, calls };
}

interface Input {
  caseId?: string | null;
  audio?: Buffer | null;
  filename?: string;
  bearer?: string | null;
}

async function setup(t: TestContext, options: MockOptions = {}, overrides: Partial<Config> = {}) {
  const { fetcher, calls } = mockUpstreams(options);
  const logs: object[] = [];
  const server = createVoiceServer({ ...defaultConfig, ...overrides }, { fetch: fetcher, log: (ev) => logs.push(ev) });
  const name = 'sherpas-' + randomUUID().slice(0, 18);
  const socketPath = process.platform === 'win32'
    ? '\\\\.\\pipe\\LOCAL\\' + name
    : join(tmpdir(), name + '.sock');
  server.listen(socketPath);
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function post(input: Input = {}) {
    const { caseId = firstCase, audio = inputOgg, filename = 'message.ogg', bearer = secret } = input;
    const form = new FormData();
    if (caseId !== null) form.set('caseId', caseId);
    if (audio !== null) form.set('audio', new Blob([Uint8Array.from(audio)], {
      type: 'audio/ogg; codecs=opus',
    }), filename);
    const payload = new Request('http://localhost/api/voice', { method: 'POST', body: form });
    const encoded = Buffer.from(await payload.arrayBuffer());
    const headers: Record<string, string> = {
      ...Object.fromEntries(payload.headers),
      'content-length': String(encoded.length),
    };
    if (bearer !== null) headers.authorization = 'Bearer ' + bearer;

    const response = await new Promise<Response>((resolve, reject) => {
      const outgoing = request({ socketPath, method: 'POST', path: '/api/voice', headers }, (incoming) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item));
          else if (value !== undefined) responseHeaders.set(key, value);
        }
        let body = '';
        incoming.setEncoding('utf8').on('data', (part: string) => { body += part; });
        incoming.on('error', reject);
        incoming.on('end', () => resolve(new Response(body, { status: incoming.statusCode, headers: responseHeaders })));
      });
      outgoing.on('error', reject);
      outgoing.setTimeout(12_000, () => outgoing.destroy(new Error('Local HTTP request timed out.')));
      outgoing.end(encoded);
    });
    const body = await response.json() as Record<string, unknown>;
    return { response, body };
  }
  return { post, calls, logs };
}

type Reply = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['post']>>;

function assertFailure(result: Reply, status: number, code: string): void {
  assert.equal(result.response.status, status);
  assert.deepEqual(Object.keys(result.body).sort(), ['error', 'message']);
  assert.equal(result.body.error, code);
  assert.equal(typeof result.body.message, 'string');
}

function assertAnswered(result: Reply): void {
  assert.equal(result.response.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), ['audioBase64', 'audioMimeType', 'success']);
  assert.equal(result.body.success, true);
  assert.equal(result.body.audioMimeType, 'audio/ogg');
  assert.equal(typeof result.body.audioBase64, 'string');
  const audio = Buffer.from(result.body.audioBase64 as string, 'base64');
  assertOggOpus(audio);
  assert.notDeepEqual(audio, inputOgg);
}

function retrieved(calls: ReturnType<typeof mockUpstreams>['calls']) {
  return calls.mcp.filter((entry) => entry.name === 'get_case').map((entry) => entry.args);
}

function caseRoute(...topics: string[]) {
  return { route: 'case', topics, answer: '' };
}
const deferRoute = { route: 'defer', topics: [], answer: '' };

test('answers a supported credit-card question with new OGG/Opus speech', async (t) => {
  const { post, calls, logs } = await setup(t);
  assertAnswered(await post());
  assert.deepEqual(calls.proxy, [stt, chat, chat, tts]);
  assert.deepEqual(retrieved(calls), [{ caseId: firstCase, part: 'financial-health', section: 'profile' }]);
  assert.match(JSON.stringify(calls.chats[1]?.evidence), /2300/);
  assert.doesNotMatch(JSON.stringify(calls.chats[1]?.evidence), /123456/);
  assert.match(calls.spoken[0] ?? '', /two thousand three hundred/);
  assert.doesNotMatch(JSON.stringify(logs), /credit card|2300|samantha|test-team|test-mcp|test-only/i);
});

test('holdings reads only investment-analysis.positions', async (t) => {
  const { post, calls } = await setup(t, {
    transcript: 'What stocks or ETFs do I own?',
    route: caseRoute('holdings'),
    grounded: { decision: 'answer', answer: 'Your plan records a holding in the VTI fund.' },
  });
  assertAnswered(await post());
  assert.deepEqual(retrieved(calls), [{ caseId: firstCase, part: 'investment-analysis', section: 'positions' }]);
  assert.match(JSON.stringify(calls.chats[1]?.evidence), /VTI/);
});

for (const [name, transcript] of [
  ['current market news', '  What happened to Nvidia stock today?\n'],
  ['recent SEC announcement', '¿Qué anunció la SEC esta mañana?'],
  ['mixed portfolio and external news', 'How would today’s Nvidia crash affect my investments?'],
] as const) {
  test('defers ' + name + ' with the unmodified transcript', async (t) => {
    const { post, calls } = await setup(t, { transcript, route: deferRoute });
    const { response, body } = await post();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: false, text: transcript });
    assert.deepEqual(calls.proxy, [stt, chat]);
    assert.equal(calls.chats[0]?.transcript, transcript);
    assert.deepEqual(retrieved(calls), []);
    assert.deepEqual(calls.spoken, []);
  });
}

test('case allowed by the caller scope but missing from the MCP inventory returns 404', async (t) => {
  const { post, calls } = await setup(t, {}, { allowedCases: new Set(['unknown-case']) });
  assertFailure(await post({ caseId: 'unknown-case' }), 404, 'CASE_NOT_FOUND');
  assert.deepEqual(calls.proxy, []);
  assert.deepEqual(calls.mcp.map((call) => call.name), ['list_cases']);
});

test('client outside the bearer scope returns 404 without upstream calls', async (t) => {
  const { post, calls } = await setup(t, {}, { allowedCases: new Set([secondCase]) });
  assertFailure(await post(), 404, 'CASE_NOT_FOUND');
  assert.deepEqual(calls.mcp, []);
  assert.deepEqual(calls.proxy, []);
});

test('rejects a malformed case ID and a missing case ID', async (t) => {
  const { post, calls } = await setup(t);
  assertFailure(await post({ caseId: '../another-case' }), 400, 'INVALID_CASE_ID');
  assertFailure(await post({ caseId: null }), 400, 'MISSING_CASE_ID');
  assert.deepEqual(calls.mcp, []);
});

test('rejects a missing audio file', async (t) => {
  const { post, calls } = await setup(t);
  assertFailure(await post({ audio: null }), 400, 'MISSING_AUDIO');
  assert.deepEqual(calls.proxy, []);
});

test('rejects an empty audio upload', async (t) => {
  const { post, calls } = await setup(t);
  assertFailure(await post({ audio: Buffer.alloc(0) }), 400, 'EMPTY_AUDIO');
  assert.deepEqual(calls.proxy, []);
});

test('rejects non-Opus content even with an OGG name and MIME type', async (t) => {
  const { post, calls } = await setup(t);
  assertFailure(await post({ audio: fakeSpeech }), 415, 'UNSUPPORTED_AUDIO');
  assert.deepEqual(calls.proxy, []);
});

test('rejects truncated OGG audio', async (t) => {
  const { post, calls } = await setup(t);
  assertFailure(await post({ audio: inputOgg.subarray(0, inputOgg.length - 1) }), 400, 'INVALID_AUDIO');
  assert.deepEqual(calls.proxy, []);
});

test('transcription failure is an HTTP error with scrubbed upstream diagnostics', async (t) => {
  const { post, calls } = await setup(t, { failStage: stt });
  const result = await post();
  assertFailure(result, 502, 'TRANSCRIPTION_FAILED');
  assert.doesNotMatch(JSON.stringify(result.body), /sensitive upstream/);
  assert.deepEqual(calls.proxy, [stt]);
});

test('an empty or unintelligible transcription returns an HTTP error', async (t) => {
  const { post, calls } = await setup(t, { transcript: ' (background noise) [inaudible] ' });
  assertFailure(await post(), 422, 'NO_SPEECH');
  assert.deepEqual(calls.proxy, [stt]);
});

test('MCP connection failure is an HTTP error', async (t) => {
  const { post, calls } = await setup(t, { failMcp: true });
  assertFailure(await post(), 502, 'MCP_FAILED');
  assert.deepEqual(calls.proxy, []);
});

test('a response whose case identity differs from the requested case is rejected', async (t) => {
  const { post, calls } = await setup(t, { mismatchedCase: true });
  assertFailure(await post(), 502, 'MCP_FAILED');
  assert.deepEqual(calls.proxy, [stt, chat]);
});

test('GPT processing failure is an HTTP error', async (t) => {
  const { post, calls } = await setup(t, { failStage: chat });
  assertFailure(await post(), 502, 'GPT_FAILED');
  assert.deepEqual(calls.proxy, [stt, chat]);
});

test('invalid model output cannot select an arbitrary MCP tool or section', async (t) => {
  const { post, calls } = await setup(t, { route: caseRoute('read_another_case') });
  assertFailure(await post(), 502, 'GPT_FAILED');
  assert.deepEqual(retrieved(calls), []);
});

test('text-to-speech failure is an HTTP error', async (t) => {
  const { post, calls } = await setup(t, { failStage: tts });
  assertFailure(await post(), 502, 'TTS_FAILED');
  assert.deepEqual(calls.proxy, [stt, chat, chat, tts]);
});

test('a timeless explanation is answered in the routing call', async (t) => {
  const { post, calls } = await setup(t, {
    transcript: '¿Qué es un ETF?',
    route: { route: 'general', topics: [], answer: 'Un ETF es un fondo que cotiza en bolsa.' },
  });
  assertAnswered(await post());
  assert.deepEqual(calls.proxy, [stt, chat, tts]);
  assert.deepEqual(calls.spoken, ['Un ETF es un fondo que cotiza en bolsa.']);
  assert.deepEqual(retrieved(calls), []);
});

test('explicitly missing case data defers without asking the model to fill the gap', async (t) => {
  const transcript = 'What do I owe?';
  const { post, calls } = await setup(t, { transcript, unavailableSection: true });
  const { response, body } = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: false, text: transcript });
  assert.deepEqual(calls.proxy, [stt, chat]);
});

test('the grounded model can defer after reading an insufficient case snapshot', async (t) => {
  const transcript = 'What was the interest rate on my car loan?';
  const { post, calls } = await setup(t, { transcript, grounded: { decision: 'defer', answer: '' } });
  const { response, body } = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: false, text: transcript });
  assert.deepEqual(calls.proxy, [stt, chat, chat]);
});

test('risk retrieves focused metrics and persona', async (t) => {
  const { post, calls } = await setup(t, {
    transcript: 'How risky is my portfolio?',
    route: caseRoute('portfolio_risk'),
  });
  assertAnswered(await post());
  assert.deepEqual(retrieved(calls), [
    { caseId: firstCase, part: 'investment-analysis', section: 'key_metrics' },
    { caseId: firstCase, part: 'persona' },
  ]);
  assert.match(JSON.stringify(calls.chats[1]?.evidence), /Moderate risk tolerance/);
});

test('retirement retrieves goals, the retirement narrative and projections', async (t) => {
  const { post, calls } = await setup(t, { route: caseRoute('retirement') });
  assertAnswered(await post());
  assert.deepEqual(retrieved(calls).map((args) => args.section), ['goals', 'narrative', 'projections']);
});

test('cache reuses one case’s own sections and keeps different cases isolated', async (t) => {
  const { post, calls } = await setup(t, { route: caseRoute('holdings') });
  assertAnswered(await post());
  assertAnswered(await post({ caseId: secondCase }));
  assertAnswered(await post());
  assert.deepEqual(retrieved(calls).map((args) => args.caseId), [firstCase, secondCase]);
  const evidence = calls.chats.flatMap((call) => call.evidence ? JSON.stringify(call.evidence) : []);
  assert.match(evidence[0]!, /VTI/);
  assert.match(evidence[1]!, /MSFT/);
  assert.doesNotMatch(evidence[1]!, /VTI/);
  assert.equal(evidence[0], evidence[2]);
});

test('authentication failures short-circuit the work', async (t) => {
  const { post, calls } = await setup(t);
  const result = await post({ bearer: null });
  assertFailure(result, 401, 'INVALID_AUTH');
  assert.match(result.response.headers.get('www-authenticate') ?? '', /^Bearer/);
  assertFailure(await post({ bearer: 'wrong' }), 401, 'INVALID_AUTH');
  assert.deepEqual(calls.proxy, []);
  assert.deepEqual(calls.mcp, []);
});

test('file size and decoded duration are independently bounded', async (t) => {
  const { post, calls } = await setup(t, {}, { maxAudioBytes: inputOgg.length, maxAudioSeconds: 1 });
  assertAnswered(await post());
  assertFailure(await post({ audio: Buffer.alloc(inputOgg.length + 1) }), 413, 'AUDIO_TOO_LARGE');
  assert.deepEqual(calls.proxy, [stt, chat, chat, tts]);
  const duration = await setup(t, {}, { maxAudioSeconds: 1 });
  assertFailure(await duration.post({ audio: tone(480, 'ogg', 1.5) }), 413, 'AUDIO_TOO_LONG');
  assert.deepEqual(duration.calls.proxy, []);
});

test('a transient upstream response has one bounded retry', async (t) => {
  const { post, calls } = await setup(t, { retryOnce: stt });
  assertAnswered(await post());
  assert.deepEqual(calls.proxy, [stt, stt, chat, chat, tts]);
});

test('model timeout returns 504 without replaying a chargeable request', async (t) => {
  const { post, calls } = await setup(t, { timeoutStage: stt }, { modelTimeoutMs: 150 });
  assertFailure(await post(), 504, 'PROCESSING_TIMEOUT');
  assert.deepEqual(calls.proxy, [stt]);
});

test('concurrency limit applies before accepting a second audio upload', async (t) => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const { post, calls } = await setup(t, {
    route: deferRoute,
    blockStage: { path: stt, entered: enter, release: released },
  }, { maxConcurrent: 1 });
  const first = post();
  await Promise.race([
    entered,
    first.then(() => { throw new Error('The first request finished before reaching transcription.'); }),
  ]);
  try {
    assertFailure(await post(), 503, 'CAPACITY_EXCEEDED');
  } finally {
    release();
  }
  assert.equal((await first).response.status, 200);
  assert.deepEqual(calls.proxy, [stt, chat]);
});

test('server configuration normalizes the README proxy URL and rejects foreign endpoints', () => {
  assert.equal(readConfig({ ...env, LLM_PROXY_URL: 'https://llm-hackathon.sherpaswealth.com' }).proxyUrl,
    'https://llm-hackathon.sherpaswealth.com/v1');
  assert.throws(() => readConfig({ ...env, LLM_PROXY_URL: 'https://api.openai.com/v1' }), /LLM_PROXY_URL/);
  assert.throws(() => readConfig({ ...env, VOICE_API_SECRET: 'too-short' }), /VOICE_API_SECRET/);
});
