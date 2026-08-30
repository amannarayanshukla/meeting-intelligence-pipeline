import { JobKind, MeetingPatch } from '../meeting.entity.js';

/** Strategy: one implementation per JobKind. The worker picks by job.name. */
export interface TranscriptProcessor {
  readonly kind: JobKind;
  process(transcript: string): Promise<MeetingPatch>;
}

/** Multi-provider DI token: the array of all processors. */
export const PROCESSORS = Symbol('PROCESSORS');
