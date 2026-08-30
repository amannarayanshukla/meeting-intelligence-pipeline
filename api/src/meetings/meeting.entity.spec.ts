import { deriveStatus, Meeting } from './meeting.entity';

const base: Meeting = {
  id: 'm1',
  transcript: 'hello',
  summary: null,
  actions: null,
  vector: null,
  errors: {},
  createdAt: new Date('2026-08-30T00:00:00Z'),
};

describe('deriveStatus', () => {
  it.each<[string, Partial<Meeting>, string]>([
    ['nothing done', {}, 'processing'],
    ['two of three', { summary: ['a'], actions: [] }, 'processing'],
    ['all three', { summary: ['a'], actions: [], vector: [0.1] }, 'done'],
    ['error wins', { summary: ['a'], actions: [], vector: [0.1], errors: { vectorize: 'boom' } }, 'failed'],
  ])('%s → %s', (_, patch, expected) => {
    expect(deriveStatus({ ...base, ...patch })).toBe(expected);
  });
});
