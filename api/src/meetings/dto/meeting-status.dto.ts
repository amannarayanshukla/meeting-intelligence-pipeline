import {
  ActionItem,
  deriveStatus,
  JobKind,
  Meeting,
  MeetingStatus,
} from '../meeting.entity.js';

export interface MeetingStatusDto {
  id: string;
  status: MeetingStatus;
  summary: string[] | null;
  actions: ActionItem[] | null;
  vector: { dims: number; preview: number[] } | null;
  errors: Partial<Record<JobKind, string>>;
  createdAt: string;
}

export function toStatusDto(m: Meeting): MeetingStatusDto {
  return {
    id: m.id,
    status: deriveStatus(m),
    summary: m.summary,
    actions: m.actions,
    vector: m.vector && {
      dims: m.vector.length,
      preview: m.vector.slice(0, 8),
    },
    errors: m.errors,
    createdAt: m.createdAt.toISOString(),
  };
}
