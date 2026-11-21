import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AudioProcessor } from './audio.js';
import type { Config } from './config.js';
import { checkAborted, toVoiceError, VoiceError } from './errors.js';
import { SherpasCases } from './mcp.js';
import type { Fetch } from './net.js';
import { SherpasProxy } from './proxy.js';
import { VoiceService } from './service.js';
import { readUpload } from './upload.js';

interface Dependencies {
  fetch?: Fetch;
  log?: (event: object) => void;
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function respond(res: ServerResponse, status: number, data: object): void {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(json);
}

export function createVoiceServer(config: Config, dependencies: Dependencies = {}) {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const log = dependencies.log ?? ((event) => console.log(JSON.stringify(event)));
  const secretDigest = digest(config.secret);
  const service = new VoiceService(
    new AudioProcessor(config),
    new SherpasCases(config, fetcher),
    new SherpasProxy(config, fetcher),
  );
  let active = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url?.split('?', 1)[0];
    if (req.method === 'GET' && path === '/healthz') {
      respond(res, 200, { ok: true });
      return;
    }
    if (req.method !== 'POST' || path !== '/api/voice') {
      const error = new VoiceError('NOT_FOUND');
      if (!req.complete) res.setHeader('connection', 'close');
      respond(res, error.status, { error: error.code, message: error.message });
      return;
    }

    const requestId = randomUUID();
    const started = performance.now();
    const disconnected = new AbortController();
    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(config.requestTimeoutMs)]);
    let admitted = false;

    // Keep the connection and every upstream operation tied to the caller's lifetime.
    const onDisconnect = () => disconnected.abort(new VoiceError('CLIENT_DISCONNECTED'));
    req.on('error', onDisconnect);
    res.on('error', onDisconnect);
    res.once('close', () => {
      if (!res.writableEnded) onDisconnect();
    });
    res.setHeader('x-request-id', requestId);

    try {
      const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1];
      if (!token || !timingSafeEqual(secretDigest, digest(token))) {
        throw new VoiceError('INVALID_AUTH');
      }
      if (active >= config.maxConcurrent) {
        throw new VoiceError('CAPACITY_EXCEEDED', undefined, 1);
      }
      active++;
      admitted = true;

      const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(config.uploadTimeoutMs)]);
      const upload = await readUpload(req, config.maxAudioBytes, uploadSignal);
      const result = await service.process(upload.caseId, upload.audio, signal);
      checkAborted(signal);
      respond(res, 200, result);
      log({
        requestId, status: 200, outcome: result.success ? 'answered' : 'deferred',
        durationMs: Math.round(performance.now() - started),
      });
    } catch (caught) {
      const error = toVoiceError(caught);
      if (!res.destroyed && !res.writableEnded && !res.headersSent && error.status !== 499) {
        if (!req.complete) res.setHeader('connection', 'close');
        if (error.code === 'INVALID_AUTH') res.setHeader('www-authenticate', 'Bearer realm="voice-api"');
        if (error.retryAfterSeconds) res.setHeader('retry-after', error.retryAfterSeconds);
        respond(res, error.status, { error: error.code, message: error.message });
      }
      log({
        requestId, status: error.status, error: error.code, upstreamStatus: error.upstreamStatus,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      if (admitted) active--;
    }
  }

  return createServer({
    headersTimeout: 10_000,
    requestTimeout: Math.max(config.uploadTimeoutMs, 10_000),
    keepAliveTimeout: 3_000,
    maxHeaderSize: 16 * 1024,
  }, (req, res) => {
    void handle(req, res).catch(() => {
      res.destroy();
    });
  });
}
