import { FakeLlmClient } from '../../testing/fake-llm.client.js';
import { ActionExtractorProcessor } from './action-extractor.processor.js';
import { SummarizeProcessor } from './summarize.processor.js';
import { VectorizeProcessor } from './vectorize.processor.js';

describe('SummarizeProcessor', () => {
  it('has kind summarize', () => {
    expect(new SummarizeProcessor(new FakeLlmClient('')).kind).toBe(
      'summarize',
    );
  });

  it('parses bullets, strips markers, keeps at most 3', async () => {
    const llm = new FakeLlmClient('- one\n\n• two\n3. three\n- four');
    await expect(new SummarizeProcessor(llm).process('t')).resolves.toEqual({
      summary: ['one', 'two', 'three'],
    });
  });

  it('throws when the reply has no bullets', async () => {
    await expect(
      new SummarizeProcessor(new FakeLlmClient('   \n ')).process('t'),
    ).rejects.toThrow('no bullets');
  });
});

describe('ActionExtractorProcessor', () => {
  it('has kind extract_actions', () => {
    expect(new ActionExtractorProcessor(new FakeLlmClient('[]')).kind).toBe(
      'extract_actions',
    );
  });

  it('parses a JSON array of action items', async () => {
    const llm = new FakeLlmClient('[{"task":"ship","assignee":"Aman"}]');
    await expect(
      new ActionExtractorProcessor(llm).process('t'),
    ).resolves.toEqual({
      actions: [{ task: 'ship', assignee: 'Aman' }],
    });
  });

  it('throws on invalid JSON', async () => {
    await expect(
      new ActionExtractorProcessor(new FakeLlmClient('not json')).process('t'),
    ).rejects.toThrow('invalid JSON');
  });

  it('throws on wrong shape', async () => {
    await expect(
      new ActionExtractorProcessor(new FakeLlmClient('[{"task":1}]')).process(
        't',
      ),
    ).rejects.toThrow('wrong shape');
  });
});

describe('VectorizeProcessor', () => {
  it('has kind vectorize', () => {
    expect(new VectorizeProcessor(new FakeLlmClient('')).kind).toBe(
      'vectorize',
    );
  });

  it('returns the embedding', async () => {
    const llm = new FakeLlmClient('', [0.1, 0.2]);
    await expect(new VectorizeProcessor(llm).process('t')).resolves.toEqual({
      vector: [0.1, 0.2],
    });
  });

  it('throws on an empty embedding', async () => {
    await expect(
      new VectorizeProcessor(new FakeLlmClient('', [])).process('t'),
    ).rejects.toThrow('empty');
  });
});
