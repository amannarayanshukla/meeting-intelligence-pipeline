export const JOB_KINDS = ['summarize', 'extract_actions', 'vectorize'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const MEETINGS_QUEUE = 'meetings';
export interface MeetingJobData {
  meetingId: string;
}

export interface ActionItem {
  task: string;
  assignee: string;
}

export interface Meeting {
  id: string;
  transcript: string;
  summary: string[] | null;
  actions: ActionItem[] | null;
  vector: number[] | null;
  errors: Partial<Record<JobKind, string>>;
  createdAt: Date;
}

/** What a processor produces. */
export type MeetingPatch = Partial<Pick<Meeting, 'summary' | 'actions' | 'vector'>>;
/** What the repository accepts (processor output or a failure note). */
export type MeetingUpdate = MeetingPatch & { errors?: Partial<Record<JobKind, string>> };

export type MeetingStatus = 'processing' | 'done' | 'failed';

// ponytail: status derived at read time — no counter to keep in sync, no "all done" race.
export function deriveStatus(m: Meeting): MeetingStatus {
  if (Object.keys(m.errors).length > 0) return 'failed';
  if (m.summary && m.actions && m.vector) return 'done';
  return 'processing';
}
