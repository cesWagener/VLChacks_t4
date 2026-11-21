import type { Config } from './config.js';
import { checkAborted, VoiceError } from './errors.js';
import { MAX_REPLY_BYTES } from './audio.js';
import { fetchWithRetry, limitBody, rateLimited, record, RollingLimit, type Fetch } from './net.js';

type ProxyError = 'TRANSCRIPTION_FAILED' | 'GPT_FAILED' | 'TTS_FAILED';

interface ChatSchema {
  name: string;
  schema: Record<string, unknown>;
}

const JSON_LIMIT = 256 * 1024;

export class SherpasProxy {
  private readonly limit: RollingLimit;

  constructor(private readonly config: Config, private readonly fetch: Fetch) {
    this.limit = new RollingLimit(config.modelRequestsPerMinute);
  }

  async transcribe(wav: Buffer, signal: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set('model', this.config.sttModel);
    form.set('file', new Blob([Uint8Array.from(wav)], { type: 'audio/wav' }), 'message.wav');

    const result = await this.post('audio/transcriptions', form, 'TRANSCRIPTION_FAILED', signal,
      async (response) => await limitBody(response, JSON_LIMIT).json());
    const text = record(result)?.text;
    if (typeof text !== 'string' || text.length > 12_000) {
      throw new VoiceError('TRANSCRIPTION_FAILED');
    }
    const spokenText = text.replace(/\[[^\]\r\n]{1,80}\]|\([^)\r\n]{1,80}\)|<[^>\r\n]{1,80}>/gu, '');
    if (!/[\p{L}\p{N}]/u.test(spokenText)) throw new VoiceError('NO_SPEECH');
    return text;
  }

  async chat(
    instructions: string,
    input: object,
    format: ChatSchema,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
      model: this.config.llmModel,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: JSON.stringify(input) },
      ],
      max_completion_tokens: 2_200,
      response_format: { type: 'json_schema', json_schema: { ...format, strict: true } },
    });
    const result = await this.post('chat/completions', body, 'GPT_FAILED', signal,
      async (response) => await limitBody(response, JSON_LIMIT).json());

    const choices = record(result)?.choices;
    const choice = Array.isArray(choices) ? record(choices[0]) : undefined;
    const message = record(choice?.message);
    if (choice?.finish_reason !== 'stop' || typeof message?.content !== 'string' || message.refusal) {
      throw new VoiceError('GPT_FAILED');
    }
    try {
      const parsed = record(JSON.parse(message.content));
      if (parsed) return parsed;
    } catch {
      // An invalid structured reply is an upstream failure.
    }
    throw new VoiceError('GPT_FAILED');
  }

  async synthesize(answer: string, signal: AbortSignal): Promise<Buffer> {
    const body = JSON.stringify({
      model: this.config.ttsModel,
      voice: this.config.ttsVoice,
      input: answer,
      response_format: 'mp3',
    });
    return this.post('audio/speech', body, 'TTS_FAILED', signal, async (response) => {
      const mime = response.headers.get('content-type')?.toLowerCase();
      if (mime && !mime.startsWith('audio/') && !mime.startsWith('application/octet-stream') &&
          !mime.startsWith('application/ogg')) {
        await response.body?.cancel();
        throw new VoiceError('TTS_FAILED');
      }
      const bytes = Buffer.from(await limitBody(response, MAX_REPLY_BYTES).arrayBuffer());
      if (!bytes.length) throw new VoiceError('TTS_FAILED');
      return bytes;
    });
  }

  private async post<T>(
    path: string,
    body: FormData | string,
    errorCode: ProxyError,
    requestSignal: AbortSignal,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(this.config.modelTimeoutMs)]);
    const headers = new Headers({ authorization: 'Bearer ' + this.config.teamKey });
    if (typeof body === 'string') headers.set('content-type', 'application/json');
    try {
      const response = await fetchWithRetry(() => {
        this.limit.take();
        return this.fetch(this.config.proxyUrl + '/' + path, {
          method: 'POST', headers, body, signal, redirect: 'error',
        });
      }, signal);
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw rateLimited(response);
        throw new VoiceError(errorCode, response.status);
      }
      const result = await consume(response);
      checkAborted(signal);
      return result;
    } catch (error) {
      checkAborted(signal);
      if (error instanceof VoiceError) throw error;
      throw new VoiceError(errorCode);
    }
  }
}
