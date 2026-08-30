import { InMemoryMeetingRepository } from './in-memory-meeting.repository.js';

describe('InMemoryMeetingRepository', () => {
  let repo: InMemoryMeetingRepository;
  beforeEach(() => {
    repo = new InMemoryMeetingRepository();
  });

  it('create returns a record with id, transcript and null fields', async () => {
    const m = await repo.create({ transcript: 'hi' });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m).toMatchObject({
      transcript: 'hi',
      summary: null,
      actions: null,
      vector: null,
      errors: {},
    });
    expect(m.createdAt).toBeInstanceOf(Date);
  });

  it('findById returns null for unknown id', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('patch merges fields and errors independently', async () => {
    const { id } = await repo.create({ transcript: 'hi' });
    await repo.patch(id, { summary: ['a'] });
    await repo.patch(id, { errors: { vectorize: 'boom' } });
    await repo.patch(id, { errors: { summarize: 'bad' } });
    const m = await repo.findById(id);
    expect(m?.summary).toEqual(['a']);
    expect(m?.actions).toBeNull();
    expect(m?.errors).toEqual({ vectorize: 'boom', summarize: 'bad' });
  });

  it('patch on unknown id throws', async () => {
    await expect(repo.patch('nope', { summary: [] })).rejects.toThrow(
      'not found',
    );
  });

  it('returned objects are copies, not live references', async () => {
    const m = await repo.create({ transcript: 'hi' });
    m.summary = ['mutated'];
    expect((await repo.findById(m.id))?.summary).toBeNull();
  });
});
