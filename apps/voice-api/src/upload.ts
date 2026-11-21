import type { IncomingMessage } from 'node:http';
import { Busboy, type BusboyInstance } from '@fastify/busboy';
import { validCaseId } from './config.js';
import { checkAborted, VoiceError } from './errors.js';

interface Upload {
  caseId: string;
  audio: Buffer;
}

const MULTIPART_OVERHEAD = 32 * 1024;

export async function readUpload(
  req: IncomingMessage,
  maxAudioBytes: number,
  signal: AbortSignal,
): Promise<Upload> {
  const contentType = req.headers['content-type'];
  if (!contentType || !/^multipart\/form-data(?:\s*;|$)/i.test(contentType) ||
      (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
    throw new VoiceError('UNSUPPORTED_REQUEST');
  }

  let parser: BusboyInstance;
  try {
    parser = new Busboy({
      headers: { ...req.headers, 'content-type': contentType },
      limits: { fileSize: maxAudioBytes, fieldSize: 128, fields: 2, files: 2, parts: 3 },
    });
  } catch {
    throw new VoiceError('INVALID_MULTIPART');
  }

  const body = await readBoundedBody(req, maxAudioBytes + MULTIPART_OVERHEAD, signal);
  const upload = await parseBody(parser, body);
  checkAborted(signal);
  return upload;
}

function readBoundedBody(req: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  checkAborted(signal);
  if (Number(req.headers['content-length']) > maxBytes) {
    throw new VoiceError('AUDIO_TOO_LARGE');
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    function finish(error?: unknown): void {
      signal.removeEventListener('abort', onAbort);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      if (error) {
        req.pause();
        reject(error);
      } else {
        resolve(Buffer.concat(chunks, size));
      }
    }

    function onData(chunk: Buffer): void {
      size += chunk.length;
      if (size > maxBytes) finish(new VoiceError('AUDIO_TOO_LARGE'));
      else chunks.push(chunk);
    }

    function onEnd(): void { finish(); }
    function onError(): void { finish(new VoiceError('CLIENT_DISCONNECTED')); }
    function onAbort(): void {
      try { checkAborted(signal); } catch (error) { finish(error); }
    }

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function parseBody(parser: BusboyInstance, body: Buffer): Promise<Upload> {
  return new Promise((resolve, reject) => {
    let caseId: string | undefined;
    let filename: string | undefined;
    let bytes = 0;
    let failure: VoiceError | undefined;
    const audio: Buffer[] = [];

    function badPart(): void { failure ??= new VoiceError('INVALID_MULTIPART'); }
    parser.on('partsLimit', badPart);
    parser.on('filesLimit', badPart);
    parser.on('fieldsLimit', badPart);
    parser.on('error', () => reject(failure ?? new VoiceError('INVALID_MULTIPART')));

    parser.on('field', (name, value, nameTruncated, valueTruncated) => {
      if (name !== 'caseId' || caseId !== undefined || nameTruncated || valueTruncated) badPart();
      else caseId = value;
    });

    parser.on('file', (name, stream, fileName) => {
      stream.on('error', badPart);
      if (name !== 'audio' || filename !== undefined) {
        badPart();
        stream.resume();
        return;
      }
      filename = fileName ?? '';
      stream.on('limit', () => { failure = new VoiceError('AUDIO_TOO_LARGE'); });
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        audio.push(chunk);
      });
    });

    parser.once('finish', () => {
      if (failure) return reject(failure);
      if (!caseId) return reject(new VoiceError('MISSING_CASE_ID'));
      if (!validCaseId(caseId)) return reject(new VoiceError('INVALID_CASE_ID'));
      if (filename === undefined) return reject(new VoiceError('MISSING_AUDIO'));
      if (!/\.ogg$/i.test(filename)) return reject(new VoiceError('UNSUPPORTED_AUDIO'));
      if (!bytes) return reject(new VoiceError('EMPTY_AUDIO'));
      resolve({ caseId, audio: Buffer.concat(audio, bytes) });
    });

    parser.end(body);
  });
}
