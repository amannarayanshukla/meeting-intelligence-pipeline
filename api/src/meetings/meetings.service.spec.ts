import { Queue } from 'bullmq';
import { FakeQueue } from '../testing/fake-queue.js';
import { MeetingsService } from './meetings.service.js';
import { InMemoryMeetingRepository } from './repository/in-memory-meeting.repository.js';
import { JobKind, MeetingJobData } from './meeting.entity.js';

describe('MeetingsService', () => {
  let repo: InMemoryMeetingRepository;
  let queue: FakeQueue;
  let service: MeetingsService;

  beforeEach(() => {
    repo = new InMemoryMeetingRepository();
    queue = new FakeQueue();
    service = new MeetingsService(
      repo,
      queue as unknown as Queue<MeetingJobData, void, JobKind>,
    );
  });

  it('submit creates the record and enqueues three jobs with dedupe ids', async () => {
    const { id } = await service.submit('hello world');
    expect(await repo.findById(id)).toMatchObject({
      transcript: 'hello world',
    });
    expect(queue.calls.map((c) => c.name)).toEqual([
      'summarize',
      'extract_actions',
      'vectorize',
    ]);
    for (const call of queue.calls) {
      expect(call.data).toEqual({ meetingId: id });
      expect(call.opts).toEqual({
        jobId: `${id}-${call.name}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
      });
    }
  });

  it('status returns null for unknown id', async () => {
    expect(await service.status('nope')).toBeNull();
  });

  it('status maps fields, derives status, and previews the vector', async () => {
    const { id } = await service.submit('t');
    expect((await service.status(id))?.status).toBe('processing');

    await repo.patch(id, {
      summary: ['a'],
      actions: [{ task: 'x', assignee: 'y' }],
      vector: Array.from({ length: 768 }, (_, i) => i),
    });
    const dto = await service.status(id);
    expect(dto).toMatchObject({
      id,
      status: 'done',
      summary: ['a'],
      actions: [{ task: 'x', assignee: 'y' }],
      vector: { dims: 768, preview: [0, 1, 2, 3, 4, 5, 6, 7] },
      errors: {},
    });
    expect(typeof dto?.createdAt).toBe('string');
  });
});
