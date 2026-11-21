const problems = {
  INVALID_AUTH: [401, 'A valid voice API bearer secret is required.'],
  NOT_FOUND: [404, 'Endpoint not found.'],
  UNSUPPORTED_REQUEST: [415, 'Use multipart/form-data with an audio file.'],
  INVALID_MULTIPART: [400, 'Send one caseId field and one audio file field.'],
  MISSING_CASE_ID: [400, 'caseId is required.'],
  INVALID_CASE_ID: [400, 'caseId must be a valid case slug.'],
  CASE_NOT_FOUND: [404, 'No accessible client case matches that caseId.'],
  MISSING_AUDIO: [400, 'The audio file is required.'],
  EMPTY_AUDIO: [400, 'The audio file is empty.'],
  UNSUPPORTED_AUDIO: [415, 'Supply an .ogg file containing Opus audio.'],
  INVALID_AUDIO: [400, 'The OGG/Opus file is corrupt or incomplete.'],
  AUDIO_TOO_LARGE: [413, 'The audio file or multipart upload exceeds the size limit.'],
  AUDIO_TOO_LONG: [413, 'The audio file exceeds the duration limit.'],
  NO_SPEECH: [422, 'No intelligible speech was detected.'],
  TRANSCRIPTION_FAILED: [502, 'Unable to transcribe the supplied audio.'],
  MCP_FAILED: [502, 'Unable to read the Sherpas case data.'],
  GPT_FAILED: [502, 'Unable to process the question with the Sherpas AI proxy.'],
  TTS_FAILED: [502, 'Unable to synthesize a playable audio reply.'],
  AUDIO_PROCESSOR_UNAVAILABLE: [503, 'The audio processor is unavailable.'],
  CAPACITY_EXCEEDED: [503, 'The voice service is temporarily at capacity.'],
  UPSTREAM_RATE_LIMITED: [503, 'A Sherpas upstream service is temporarily rate limited.'],
  PROCESSING_TIMEOUT: [504, 'Voice processing exceeded its time limit.'],
  CLIENT_DISCONNECTED: [499, 'The caller disconnected.'],
  INTERNAL_ERROR: [500, 'Voice processing could not be completed.'],
} as const;

export type ErrorCode = keyof typeof problems;

export class VoiceError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly upstreamStatus?: number,
    readonly retryAfterSeconds?: number,
  ) {
    const [status, message] = problems[code];
    super(message);
    this.name = 'VoiceError';
    this.status = status;
  }
}

export function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    if (signal.reason instanceof VoiceError) throw signal.reason;
    throw new VoiceError('PROCESSING_TIMEOUT');
  }
}

export function toVoiceError(error: unknown): VoiceError {
  return error instanceof VoiceError ? error : new VoiceError('INTERNAL_ERROR');
}
