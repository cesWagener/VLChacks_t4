import { setTimeout as sleep } from 'node:timers/promises';
import { checkAborted, VoiceError } from './errors.js';

export type Fetch = typeof globalThis.fetch;

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export class RollingLimit {
  private readonly startedAt: number[] = [];

  constructor(private readonly limit: number) {}

  take(): void {
    const now = performance.now();
    while (this.startedAt.length && now - this.startedAt[0]! >= 60_000) this.startedAt.shift();
    if (this.startedAt.length >= this.limit) {
      const remaining = Math.max(1, Math.ceil((60_000 - now + this.startedAt[0]!) / 1_000));
      throw new VoiceError('CAPACITY_EXCEEDED', undefined, remaining);
    }
    this.startedAt.push(now);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw) * 1_000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export async function fetchWithRetry(
  makeRequest: () => Promise<Response>,
  signal: AbortSignal,
  canRetry = true,
): Promise<Response> {
  checkAborted(signal);
  const response = await makeRequest();
  if (!canRetry || !RETRYABLE.has(response.status)) return response;

  const delayMs = Math.max(250, retryAfterMs(response) ?? 0);
  // A longer wait belongs to the caller, and a timeout can leave a billed request in progress.
  if (delayMs > 1_500) return response;

  await response.body?.cancel();
  try {
    await sleep(delayMs, undefined, { signal });
  } catch (error) {
    checkAborted(signal);
    throw error;
  }
  return makeRequest();
}

export function rateLimited(response: Response): VoiceError {
  const delayMs = retryAfterMs(response);
  return new VoiceError(
    'UPSTREAM_RATE_LIMITED',
    429,
    delayMs !== undefined ? Math.max(1, Math.min(3_600, Math.ceil(delayMs / 1_000))) : 5,
  );
}

export function limitBody(response: Response, bytes: number): Response {
  if (!response.body) return response;
  let seen = 0;
  const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > bytes) throw new Error('Upstream response exceeded its size limit.');
      controller.enqueue(chunk);
    },
  }));
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
