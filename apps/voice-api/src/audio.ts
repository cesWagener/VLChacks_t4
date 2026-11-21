import { spawn, spawnSync } from 'node:child_process';
import type { Config } from './config.js';
import { checkAborted, VoiceError } from './errors.js';

const OGG = 'OggS';
const PCM_RATE = 16_000;
const BYTES_PER_SECOND = PCM_RATE * 2;
export const MAX_REPLY_BYTES = 4 * 1024 * 1024;

function oggAt(data: Buffer, offset: number): boolean {
  return data.toString('ascii', offset, offset + 4) === OGG;
}

/** Verify container boundaries before decoding. FFmpeg checks the Opus payload. */
export function assertOggOpus(data: Buffer): void {
  if (!oggAt(data, 0)) throw new VoiceError('UNSUPPORTED_AUDIO');

  let offset = 0;
  let serial = 0;
  let sequence = 0;
  let ended = false;
  while (offset < data.length) {
    if (ended || offset + 27 > data.length || !oggAt(data, offset) || data[offset + 4] !== 0) {
      throw new VoiceError('INVALID_AUDIO');
    }
    const flags = data[offset + 5]!;
    const segmentCount = data[offset + 26]!;
    const body = offset + 27 + segmentCount;
    if (body > data.length) throw new VoiceError('INVALID_AUDIO');
    let end = body;
    for (let index = offset + 27; index < body; index++) end += data[index]!;
    if (end > data.length) throw new VoiceError('INVALID_AUDIO');

    const pageSerial = data.readUInt32LE(offset + 14);
    const pageSequence = data.readUInt32LE(offset + 18);
    if (offset === 0) {
      if ((flags & 3) !== 2) throw new VoiceError('INVALID_AUDIO');
      if (end - body < 19 || data.toString('ascii', body, body + 8) !== 'OpusHead') {
        throw new VoiceError('UNSUPPORTED_AUDIO');
      }
      serial = pageSerial;
      sequence = pageSequence;
    } else if (pageSerial !== serial || pageSequence !== ((sequence + 1) >>> 0) || (flags & 2) !== 0) {
      throw new VoiceError('INVALID_AUDIO');
    } else {
      sequence = pageSequence;
    }
    ended = (flags & 4) !== 0;
    offset = end;
  }
  if (!ended) throw new VoiceError('INVALID_AUDIO');
}

export function verifyFfmpeg(path: string): void {
  const result = spawnSync(path, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.status !== 0 || !/\blibopus\b/.test(result.stdout ?? '')) {
    throw new Error('FFmpeg with libopus is required. Install it or set FFMPEG_PATH.');
  }
}

export class AudioProcessor {
  constructor(private readonly config: Config) {}

  async toTranscriptionWav(ogg: Buffer, signal: AbortSignal): Promise<Buffer> {
    assertOggOpus(ogg);
    const pcm = await this.convert(
      ogg,
      ['-f', 'ogg', '-i', 'pipe:0', '-map', '0:a:0',
        '-t', String(this.config.maxAudioSeconds + 0.1), '-ar', String(PCM_RATE),
        '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'],
      (this.config.maxAudioSeconds + 1) * BYTES_PER_SECOND,
      'INVALID_AUDIO',
      signal,
    );
    if (pcm.length > this.config.maxAudioSeconds * BYTES_PER_SECOND) {
      throw new VoiceError('AUDIO_TOO_LONG');
    }
    if (!hasSignal(pcm)) throw new VoiceError('NO_SPEECH');

    // A WAV muxer writing to a pipe cannot set the RIFF and data lengths.
    // Put a complete header on the bounded PCM before sending it to the proxy.
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(PCM_RATE, 24);
    header.writeUInt32LE(BYTES_PER_SECOND, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
  }

  async toVoiceOgg(speech: Buffer, signal: AbortSignal): Promise<Buffer> {
    const ogg = await this.convert(
      speech,
      ['-f', speechFormat(speech), '-i', 'pipe:0', '-map', '0:a:0',
        '-ar', '48000', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k',
        '-application', 'voip', '-f', 'ogg', 'pipe:1'],
      MAX_REPLY_BYTES,
      'TTS_FAILED',
      signal,
    );
    try {
      assertOggOpus(ogg);
    } catch {
      throw new VoiceError('TTS_FAILED');
    }
    return ogg;
  }

  private async convert(
    input: Buffer,
    args: string[],
    maxBytes: number,
    invalidCode: 'INVALID_AUDIO' | 'TTS_FAILED',
    requestSignal: AbortSignal,
  ): Promise<Buffer> {
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(this.config.ffmpegTimeoutMs)]);
    checkAborted(signal);

    return new Promise((resolve, reject) => {
      const child = spawn(this.config.ffmpegPath, [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-xerror',
        '-protocol_whitelist', 'pipe', '-threads', '1', ...args,
      ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, signal });

      let length = 0;
      let exceeded = false;
      let failedToSpawn = false;
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => {
        if (exceeded) return;
        length += chunk.length;
        if (length > maxBytes) {
          exceeded = true;
          child.kill('SIGKILL');
          return;
        }
        chunks.push(chunk);
      });
      child.once('error', () => { failedToSpawn = true; });
      child.stdin.on('error', () => {
        // FFmpeg can close its input early for invalid files or after reaching the duration cap.
      });
      child.once('close', (code) => {
        if (signal.aborted) {
          try { checkAborted(signal); } catch (error) { reject(error); }
        } else if (failedToSpawn) {
          reject(new VoiceError('AUDIO_PROCESSOR_UNAVAILABLE'));
        } else if (exceeded || code !== 0 || !length) {
          reject(new VoiceError(invalidCode));
        } else {
          resolve(Buffer.concat(chunks, length));
        }
      });
      child.stdin.end(input);
    });
  }
}

function speechFormat(bytes: Buffer): string {
  if (oggAt(bytes, 0)) return 'ogg';
  const kind = bytes.toString('ascii', 0, 4);
  if (kind === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (kind === 'fLaC') return 'flac';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0) return 'aac';
  return 'mp3';
}

function hasSignal(pcm: Buffer): boolean {
  for (let index = 0; index + 1 < pcm.length; index += 2) {
    if (Math.abs(pcm.readInt16LE(index)) > 64) return true;
  }
  return false;
}
