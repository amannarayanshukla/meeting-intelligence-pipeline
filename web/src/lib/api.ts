import type { MeetingStatusDto } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function submitMeeting(transcript: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
  return res.json();
}

export async function getMeetingStatus(id: string): Promise<MeetingStatusDto> {
  const res = await fetch(`${BASE}/api/meetings/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Status failed: ${res.status}`);
  return res.json();
}
