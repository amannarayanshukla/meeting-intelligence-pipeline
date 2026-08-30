'use client';
import { useEffect, useState } from 'react';
import { getMeetingStatus } from '@/lib/api';
import type { MeetingStatusDto } from '@/lib/types';

// ponytail: polling via a setTimeout chain (no overlapping requests). Swap for SSE when poll traffic matters.
export function useMeetingStatus(id: string | null, intervalMs = 1500): MeetingStatusDto | null {
  const [status, setStatus] = useState<MeetingStatusDto | null>(null);

  useEffect(() => {
    setStatus(null);
    if (!id) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await getMeetingStatus(id);
        if (cancelled) return;
        setStatus(next);
        if (next.status === 'processing') timer = setTimeout(tick, intervalMs);
      } catch {
        if (!cancelled) timer = setTimeout(tick, intervalMs); // transient error: keep polling
      }
    };
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, intervalMs]);

  return status;
}
