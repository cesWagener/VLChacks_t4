import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { validCaseId, type Config } from './config.js';
import { project, selectLocators, type Evidence, type Locator, type Topic } from './context.js';
import { checkAborted, VoiceError } from './errors.js';
import { fetchWithRetry, limitBody, rateLimited, record, RollingLimit, type Fetch } from './net.js';

const MCP_BODY_LIMIT = 256 * 1024;
const MAX_CONTEXT_CHARS = 55_000;

class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(private readonly ttlMs: number, private readonly maxEntries: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expires > performance.now()) return entry.value;
    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: T): void {
    if (!this.ttlMs) return;
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expires: performance.now() + this.ttlMs });
  }
}

function toolTexts(result: unknown): string[] {
  const blocks = record(result)?.content;
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block: unknown) => {
    const item = record(block);
    return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : [];
  });
}

function toolPayload(result: unknown, allowList = false): unknown {
  const structured = record(record(result)?.structuredContent);
  if (structured && Object.keys(structured).length) return structured;
  const blocks = toolTexts(result);
  const first = blocks[0];
  if (!first?.trim()) throw new VoiceError('MCP_FAILED');

  try {
    if (allowList && blocks.length > 1) return blocks.map((text) => JSON.parse(text) as unknown);
    return JSON.parse(first) as unknown;
  } catch {
    // Persona may be returned as a raw Markdown text block.
    if (!allowList && !/^\s*[\[{]/.test(first)) return first;
    throw new VoiceError('MCP_FAILED');
  }
}

function inventoryIds(result: unknown): ReadonlySet<string> {
  if (record(result)?.isError) throw new VoiceError('MCP_FAILED');
  const payload = toolPayload(result, true);
  const data = record(payload)?.result ?? payload;
  const root = record(data);
  const rows = root?.cases ?? record(root?.value)?.cases ?? root?.value ?? data;
  if (!Array.isArray(rows)) throw new VoiceError('MCP_FAILED');

  const ids = new Set<string>();
  for (const row of rows) {
    const entry = record(row);
    const id: unknown = entry?.caseId ?? entry?.id ?? entry?.slug ?? row;
    if (!validCaseId(id)) throw new VoiceError('MCP_FAILED');
    ids.add(id);
  }
  return ids;
}

function getValue(result: unknown, caseId: string, locator: Locator): unknown {
  if (record(result)?.isError) {
    // Explicit missing-part errors are data gaps. Other tool failures are operational.
    const error = toolTexts(result)[0] ?? '';
    if (/\b(?:unknown|missing|no such) (?:case )?(?:section|part)\b|\b(?:section|part)\b[^.\r\n]{0,80}\b(?:not found|does not exist|not available)\b/i.test(error)) {
      return null;
    }
    throw new VoiceError('MCP_FAILED');
  }
  const payload = toolPayload(result);
  const data = record(payload)?.result ?? payload;
  if (locator.part === 'persona' && typeof data === 'string') return data;
  const envelope = record(data);
  if (!envelope || !Object.hasOwn(envelope, 'value')) throw new VoiceError('MCP_FAILED');

  const value = envelope.value;
  const receivedId = envelope.caseId ?? record(envelope.case)?.slug ?? record(record(value)?.case)?.slug;
  if ((receivedId !== undefined && receivedId !== caseId) ||
      (envelope.part !== undefined && envelope.part !== locator.part) ||
      (envelope.section != null && envelope.section !== locator.section)) {
    throw new VoiceError('MCP_FAILED');
  }
  return value ?? null;
}

export class SherpasCases {
  private readonly inventory: TtlCache<ReadonlySet<string>>;
  private readonly sections: TtlCache<unknown>;
  private readonly requests = new RollingLimit(90);

  constructor(private readonly config: Config, private readonly fetch: Fetch) {
    this.inventory = new TtlCache(config.cacheTtlMs, 1);
    this.sections = new TtlCache(config.cacheTtlMs, 64);
  }

  async assertKnownCase(caseId: string, signal: AbortSignal): Promise<void> {
    if (!this.config.allowedCases.has(caseId)) throw new VoiceError('CASE_NOT_FOUND');

    let ids = this.inventory.get('list_cases');
    if (!ids) {
      ids = await this.withClient(signal, async (client, budget) => inventoryIds(
        await client.callTool({ name: 'list_cases', arguments: {} }, { signal: budget }),
      ));
      this.inventory.set('list_cases', ids);
    }
    if (!ids.has(caseId)) throw new VoiceError('CASE_NOT_FOUND');
  }

  async context(caseId: string, topics: readonly Topic[], signal: AbortSignal): Promise<Evidence[]> {
    const selections = selectLocators(topics);
    const values = new Map<string, unknown>();
    const missing: Array<{ source: string; locator: Locator; cacheKey: string }> = [];
    for (const [source, locator] of selections) {
      const cacheKey = caseId + ':' + source;
      const value = this.sections.get(cacheKey);
      if (value === undefined) missing.push({ source, locator, cacheKey });
      else values.set(source, value);
    }

    if (missing.length) {
      await this.withClient(signal, async (client, budget) => {
        for (const { source, locator, cacheKey } of missing) {
          const args = locator.section
            ? { caseId, part: locator.part, section: locator.section }
            : { caseId, part: locator.part };
          const result = await client.callTool({ name: 'get_case', arguments: args }, { signal: budget });
          const value = getValue(result, caseId, locator);
          values.set(source, value);
          this.sections.set(cacheKey, value);
        }
      });
    }

    const evidence = [...selections].map(([source, selection]) => ({
      source,
      data: project(values.get(source) ?? null, selection),
    }));
    // A bounded, complete JSON document is safer to interpret than clipped values.
    return JSON.stringify(evidence).length <= MAX_CONTEXT_CHARS ? evidence : [];
  }

  private async withClient<T>(
    requestSignal: AbortSignal,
    action: (client: Client, budget: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const budget = AbortSignal.any([requestSignal, AbortSignal.timeout(this.config.mcpTimeoutMs)]);
    checkAborted(budget);

    const transport = new StreamableHTTPClientTransport(this.config.mcpUrl, {
      requestInit: { headers: { Authorization: 'Bearer ' + this.config.mcpToken } },
      reconnectionOptions: {
        maxRetries: 0, initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 1_000, reconnectionDelayGrowFactor: 1,
      },
      fetch: async (url, init) => {
        const signals = [budget];
        if (init?.signal) signals.push(init.signal);
        if (init?.method === 'DELETE') signals.push(AbortSignal.timeout(750));
        const signal = AbortSignal.any(signals);
        const response = await fetchWithRetry(() => {
          this.requests.take();
          return this.fetch(url, { ...init, signal, redirect: 'error' });
        }, signal, init?.method === 'POST');

        if (response.status === 429) {
          await response.body?.cancel();
          throw rateLimited(response);
        }
        if (!response.ok && init?.method === 'POST') {
          await response.body?.cancel();
          throw new VoiceError('MCP_FAILED', response.status);
        }
        return limitBody(response, MCP_BODY_LIMIT);
      },
    });

    const client = new Client({ name: 'sherpas-voice-api', version: '1.0.0' });
    try {
      // The hackathon MCP documents the initialize handshake.
      await client.connect(transport, {
        signal: budget, timeout: this.config.mcpTimeoutMs, prior: { kind: 'legacy' },
      });
      const result = await action(client, budget);
      checkAborted(budget);
      return result;
    } catch (error) {
      checkAborted(budget);
      if (error instanceof VoiceError) throw error;
      throw new VoiceError('MCP_FAILED');
    } finally {
      if (transport.sessionId && !budget.aborted) {
        await transport.terminateSession().catch(() => {});
      }
      await client.close();
    }
  }
}
