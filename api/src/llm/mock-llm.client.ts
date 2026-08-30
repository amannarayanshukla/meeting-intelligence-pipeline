import { setTimeout as sleep } from 'node:timers/promises';
import { LlmClient } from './llm.client.js';

export interface MockDelays {
  complete: (prompt: string) => number;
  embed: number;
}

/** Only the instruction header (text before the first blank line) decides the reply — never the transcript. */
const wantsJson = (prompt: string): boolean =>
  prompt.split('\n\n')[0].includes('JSON');

// Staggered on purpose: the demo's "cards land one after another" comes from here.
export const DEFAULT_DELAYS: MockDelays = {
  complete: (prompt) => (wantsJson(prompt) ? 3000 : 1500),
  embed: 4500,
};

const SUMMARY = [
  '- The team agreed to ship the parallel pipeline prototype by Friday.',
  '- Redis-backed BullMQ workers will process summaries, actions, and embeddings independently.',
  '- The frontend will poll every 1.5 seconds and reveal each result as it lands.',
].join('\n');

const ACTIONS = JSON.stringify([
  { task: 'Provision Upstash Redis and wire REDIS_URL', assignee: 'Aman' },
  { task: 'Record the 90-second Loom demo', assignee: 'Aman' },
  { task: 'Review worker retry and backoff settings', assignee: 'Priya' },
]);

// ponytail: mock provider. Add GeminiLlmClient implementing LlmClient when a key exists.
export class MockLlmClient extends LlmClient {
  constructor(private readonly delays: MockDelays = DEFAULT_DELAYS) {
    super();
  }

  async complete(prompt: string): Promise<string> {
    await sleep(this.delays.complete(prompt));
    return wantsJson(prompt) ? ACTIONS : SUMMARY;
  }

  async embed(text: string): Promise<number[]> {
    await sleep(this.delays.embed);
    const seed = text.length;
    return Array.from({ length: 768 }, (_, i) =>
      Number(Math.sin(i * 0.1 + seed).toFixed(6)),
    );
  }
}
