import { DEFAULT_DELAYS, MockLlmClient } from './mock-llm.client.js';

const instant = new MockLlmClient({ complete: () => 0, embed: 0 });

describe('MockLlmClient', () => {
  it('returns three bullet lines for a summary prompt', async () => {
    const out = await instant.complete(
      'Summarize this meeting in 3 bullet points.',
    );
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
  });

  it('returns a JSON array of action items when the prompt asks for JSON', async () => {
    const out = await instant.complete('Reply with ONLY a JSON array.');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({
      task: expect.any(String),
      assignee: expect.any(String),
    });
  });

  it('embeds to 768 deterministic floats', async () => {
    const a = await instant.embed('same text');
    const b = await instant.embed('same text');
    expect(a).toHaveLength(768);
    expect(a).toEqual(b);
    expect(a.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(
      true,
    );
  });

  it('waits the configured delay', async () => {
    const slow = new MockLlmClient({ complete: () => 30, embed: 0 });
    const t0 = Date.now();
    await slow.complete('x');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });

  it('ignores the word JSON inside the transcript when choosing the reply', async () => {
    const out = await instant.complete(
      'Summarize this meeting in 3 bullet points.\n\nPriya: the extractor must return strict JSON.',
    );
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
  });

  it('ignores the word JSON inside the transcript when choosing the delay', () => {
    expect(
      DEFAULT_DELAYS.complete(
        'Summarize this meeting in 3 bullet points.\n\nwe need strict JSON',
      ),
    ).toBe(1500);
    expect(
      DEFAULT_DELAYS.complete('Reply with ONLY a JSON array.\n\nhello'),
    ).toBe(3000);
  });
});
