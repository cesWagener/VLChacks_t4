import type { AudioProcessor } from './audio.js';
import type { SherpasCases } from './mcp.js';
import type { SherpasProxy } from './proxy.js';
import { answerFromCase, classifyQuestion } from './question.js';

export type VoiceResult =
  | { success: true; audioBase64: string; audioMimeType: 'audio/ogg' }
  | { success: false; text: string };

export class VoiceService {
  constructor(
    private readonly audio: AudioProcessor,
    private readonly cases: SherpasCases,
    private readonly proxy: SherpasProxy,
  ) {}

  async process(caseId: string, audio: Buffer, signal: AbortSignal): Promise<VoiceResult> {
    await this.cases.assertKnownCase(caseId, signal);
    const wav = await this.audio.toTranscriptionWav(audio, signal);
    const transcript = await this.proxy.transcribe(wav, signal);
    const route = await classifyQuestion(this.proxy, transcript, signal);

    if (route.route === 'defer') return { success: false, text: transcript };
    const answer = route.route === 'general'
      ? route.answer
      : await answerFromCase(this.proxy, transcript, await this.cases.context(caseId, route.topics, signal), signal);
    if (answer === undefined) return { success: false, text: transcript };

    const speech = await this.proxy.synthesize(answer, signal);
    const ogg = await this.audio.toVoiceOgg(speech, signal);
    return { success: true, audioBase64: ogg.toString('base64'), audioMimeType: 'audio/ogg' };
  }
}
