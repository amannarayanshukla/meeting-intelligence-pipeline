import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobKind, MEETINGS_QUEUE, MeetingJobData } from '../meeting.entity.js';
import {
  PROCESSORS,
  TranscriptProcessor,
} from '../processors/transcript.processor.js';
import { MeetingRepository } from '../repository/meeting.repository.js';

// ponytail: one queue, one worker, concurrency 3. Split into per-kind queues when one kind needs its own retry/concurrency policy.
// WORKER_CONCURRENCY is the throughput knob: jobs processed at once by this process (see README "What breaks first").
@Processor(MEETINGS_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3) })
export class MeetingWorker extends WorkerHost {
  private readonly logger = new Logger(MeetingWorker.name);
  private readonly byKind: Map<JobKind, TranscriptProcessor>;

  constructor(
    @Inject(PROCESSORS) processors: TranscriptProcessor[],
    private readonly repo: MeetingRepository,
  ) {
    super();
    this.byKind = new Map(processors.map((p) => [p.kind, p]));
  }

  async process(job: Job<MeetingJobData, void, string>): Promise<void> {
    const processor = this.byKind.get(job.name as JobKind);
    if (!processor) throw new Error(`Unknown job kind: ${job.name}`);

    const meeting = await this.repo.findById(job.data.meetingId);
    if (!meeting) throw new Error(`Meeting ${job.data.meetingId} not found`);

    this.logger.log(`▶ ${job.name.padEnd(15)} start  meeting=${meeting.id}`);
    const patch = await processor.process(meeting.transcript);
    await this.repo.patch(meeting.id, patch);
    this.logger.log(`✔ ${job.name.padEnd(15)} done   meeting=${meeting.id}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<MeetingJobData, void, string>,
    err: Error,
  ): Promise<void> {
    // The producer (MeetingsService.submit) sets attempts: 3; the ?? 1 fallback treats an unconfigured job as single-attempt.
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return; // BullMQ will retry; not final yet
    this.logger.error(
      `✖ ${job.name.padEnd(15)} failed meeting=${job.data.meetingId}: ${err.message}`,
    );
    try {
      await this.repo.patch(job.data.meetingId, {
        errors: { [job.name as JobKind]: err.message },
      });
    } catch (e) {
      this.logger.error(
        `✖ could not record failure for meeting=${job.data.meetingId}: ${(e as Error).message}`,
      );
    }
  }
}
