import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MeetingStatusDto, toStatusDto } from './dto/meeting-status.dto.js';
import {
  JOB_KINDS,
  JobKind,
  MEETINGS_QUEUE,
  MeetingJobData,
} from './meeting.entity.js';
import { MeetingRepository } from './repository/meeting.repository.js';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly repo: MeetingRepository,
    @InjectQueue(MEETINGS_QUEUE)
    private readonly queue: Queue<MeetingJobData, void, JobKind>,
  ) {}

  async submit(transcript: string): Promise<{ id: string }> {
    const { id } = await this.repo.create({ transcript });
    // ponytail: create-then-enqueue is not atomic — a Redis blip mid-enqueue leaves an orphan record in
    // `processing` (client got a 500 and never sees the id; jobIds dedupe a retry). Outbox/enqueue-first when it matters.
    // Payload is just the id: the worker reloads the transcript, so a 60-minute transcript never sits in Redis ×3.
    await Promise.all(
      JOB_KINDS.map((kind) =>
        this.queue.add(
          kind,
          { meetingId: id },
          {
            jobId: `${id}-${kind}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 500 },
          },
        ),
      ),
    );
    return { id };
  }

  async status(id: string): Promise<MeetingStatusDto | null> {
    const m = await this.repo.findById(id);
    return m && toStatusDto(m);
  }
}
