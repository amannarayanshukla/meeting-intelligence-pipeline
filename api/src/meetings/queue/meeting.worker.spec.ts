import { Job } from 'bullmq';
import { MeetingJobData } from '../meeting.entity.js';
import { TranscriptProcessor } from '../processors/transcript.processor.js';
import { InMemoryMeetingRepository } from '../repository/in-memory-meeting.repository.js';
import { MeetingWorker } from './meeting.worker.js';

const summarize: TranscriptProcessor = {
  kind: 'summarize',
  process: vi.fn(async (t: string) => ({ summary: [`sum of ${t}`] })),
};

function job(
  name: string,
  meetingId: string,
  extra: Partial<Job> = {},
): Job<MeetingJobData, void, string> {
  return {
    name,
    data: { meetingId },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...extra,
  } as unknown as Job<MeetingJobData, void, string>;
}

describe('MeetingWorker', () => {
  let repo: InMemoryMeetingRepository;
  let worker: MeetingWorker;

  beforeEach(() => {
    repo = new InMemoryMeetingRepository();
    worker = new MeetingWorker([summarize], repo);
  });

  it('dispatches by job.name, passes the stored transcript, and patches the record', async () => {
    const { id } = await repo.create({ transcript: 'hello' });
    await worker.process(job('summarize', id));
    expect(summarize.process).toHaveBeenCalledWith('hello');
    expect((await repo.findById(id))?.summary).toEqual(['sum of hello']);
  });

  it('throws on an unknown job name', async () => {
    const { id } = await repo.create({ transcript: 'hello' });
    await expect(worker.process(job('translate', id))).rejects.toThrow(
      'Unknown job kind: translate',
    );
  });

  it('throws when the meeting is missing', async () => {
    await expect(worker.process(job('summarize', 'ghost'))).rejects.toThrow(
      'not found',
    );
  });

  it('onFailed records the error only after the final attempt', async () => {
    const { id } = await repo.create({ transcript: 'hello' });
    await worker.onFailed(
      job('summarize', id, { attemptsMade: 1 }),
      new Error('flaky'),
    );
    expect((await repo.findById(id))?.errors).toEqual({});

    await worker.onFailed(
      job('summarize', id, { attemptsMade: 3 }),
      new Error('dead'),
    );
    expect((await repo.findById(id))?.errors).toEqual({ summarize: 'dead' });
  });
});
