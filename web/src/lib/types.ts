// Hand-copied from api/src/meetings/dto/meeting-status.dto.ts — keep in sync.
export type JobKind = 'summarize' | 'extract_actions' | 'vectorize';
export type MeetingStatus = 'processing' | 'done' | 'failed';

export interface ActionItem {
  task: string;
  assignee: string;
}

export interface MeetingStatusDto {
  id: string;
  status: MeetingStatus;
  summary: string[] | null;
  actions: ActionItem[] | null;
  vector: { dims: number; preview: number[] } | null;
  errors: Partial<Record<JobKind, string>>;
  createdAt: string;
}
