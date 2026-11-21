const PROXY_ORIGIN = 'https://llm-hackathon.sherpaswealth.com';
const MCP_ORIGIN = 'https://mcp-hackathon.sherpaswealth.com';
const DEMO_CASES = [
  'timothy-melanie-weah',
  'michael-carter',
  'daniel-emily-johnson',
  'samantha-lewis',
];

export interface Config {
  host: string;
  port: number;
  secret: string;
  allowedCases: ReadonlySet<string>;
  teamKey: string;
  mcpToken: string;
  proxyUrl: string;
  mcpUrl: URL;
  sttModel: string;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
  ffmpegPath: string;
  maxAudioBytes: number;
  maxAudioSeconds: number;
  maxConcurrent: number;
  modelRequestsPerMinute: number;
  uploadTimeoutMs: number;
  requestTimeoutMs: number;
  modelTimeoutMs: number;
  mcpTimeoutMs: number;
  ffmpegTimeoutMs: number;
  cacheTtlMs: number;
}

export function validCaseId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  function number(name: string, fallback: number, min: number, max: number): number {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(name + ' must be an integer from ' + min + ' through ' + max + '.');
    }
    return value;
  }

  function token(name: string, placeholder: string, minimum = 1): string {
    const value = env[name]?.trim();
    if (!value || value === placeholder || value.length < minimum || !/^[\x21-\x7E]+$/.test(value)) {
      throw new Error(name + ' must be set to a valid server credential.');
    }
    return value;
  }

  function endpoint(name: string, origin: string, path: string, acceptOrigin = false): URL {
    const raw = env[name] ?? origin + path;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(name + ' must be a Sherpas hackathon URL.');
    }
    const pathname = url.pathname.replace(/\/+$/, '');
    if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
        (pathname !== path && !(acceptOrigin && pathname === ''))) {
      throw new Error(name + ' must point to ' + origin + path + '.');
    }
    return new URL(origin + path);
  }

  const allowedCases = env.VOICE_API_ALLOWED_CASE_IDS === undefined
    ? DEMO_CASES
    : env.VOICE_API_ALLOWED_CASE_IDS.split(',').map((id) => id.trim());
  if (!allowedCases.every(validCaseId)) {
    throw new Error('VOICE_API_ALLOWED_CASE_IDS must be a comma-separated list of case IDs.');
  }

  return {
    host: env.API_HOST?.trim() || '127.0.0.1',
    port: number('API_PORT', 8790, 1, 65_535),
    secret: token('VOICE_API_SECRET', 'your-long-random-secret', 32),
    allowedCases: new Set(allowedCases),
    teamKey: token('TEAM_KEY', 'your-sherpas-team-ai-key'),
    mcpToken: token('MCP_TOKEN', 'your-personal-sherpas-mcp-token'),
    proxyUrl: endpoint('LLM_PROXY_URL', PROXY_ORIGIN, '/v1', true).href,
    mcpUrl: endpoint('MCP_URL', MCP_ORIGIN, '/mcp'),
    sttModel: env.STT_MODEL?.trim() || 'scribe-v2',
    llmModel: env.LLM_MODEL?.trim() || 'gpt-5-mini',
    ttsModel: env.TTS_MODEL?.trim() || 'eleven-flash-v2.5',
    ttsVoice: env.TTS_VOICE?.trim() || 'alloy',
    ffmpegPath: env.FFMPEG_PATH?.trim() || 'ffmpeg',
    maxAudioBytes: number('MAX_AUDIO_BYTES', 8_388_608, 1_024, 16_777_216),
    maxAudioSeconds: number('MAX_AUDIO_SECONDS', 60, 1, 120),
    maxConcurrent: number('MAX_CONCURRENT_REQUESTS', 2, 1, 4),
    modelRequestsPerMinute: number('MODEL_REQUESTS_PER_MINUTE', 30, 4, 60),
    uploadTimeoutMs: number('VOICE_UPLOAD_TIMEOUT_MS', 15_000, 100, 120_000),
    requestTimeoutMs: number('VOICE_REQUEST_TIMEOUT_MS', 75_000, 100, 180_000),
    modelTimeoutMs: number('MODEL_TIMEOUT_MS', 18_000, 100, 120_000),
    mcpTimeoutMs: number('MCP_TIMEOUT_MS', 10_000, 100, 60_000),
    ffmpegTimeoutMs: number('FFMPEG_TIMEOUT_MS', 8_000, 100, 60_000),
    cacheTtlMs: number('MCP_CACHE_TTL_MS', 300_000, 0, 3_600_000),
  };
}
