import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMeetingStatus } from '@/lib/api';
import type { MeetingStatus, MeetingStatusDto } from '@/lib/types';
import { useMeetingStatus } from './useMeetingStatus';

vi.mock('@/lib/api', () => ({ getMeetingStatus: vi.fn() }));

const dto = (status: MeetingStatus): MeetingStatusDto => ({
  id: 'm1',
  status,
  summary: null,
  actions: null,
  vector: null,
  errors: {},
  createdAt: '2026-08-30T00:00:00.000Z',
});

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useMeetingStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.mocked(getMeetingStatus).mockReset(); });

  it('does not fetch when id is null', async () => {
    renderHook(() => useMeetingStatus(null));
    await tick(5000);
    expect(getMeetingStatus).not.toHaveBeenCalled();
  });

  it('fetches immediately, then every 1500 ms, and stops on done', async () => {
    vi.mocked(getMeetingStatus)
      .mockResolvedValueOnce(dto('processing'))
      .mockResolvedValueOnce(dto('processing'))
      .mockResolvedValueOnce(dto('done'));

    const { result } = renderHook(() => useMeetingStatus('m1'));
    await tick(0);
    expect(getMeetingStatus).toHaveBeenCalledTimes(1);
    expect(result.current?.status).toBe('processing');

    await tick(1500);
    expect(getMeetingStatus).toHaveBeenCalledTimes(2);

    await tick(1500);
    expect(getMeetingStatus).toHaveBeenCalledTimes(3);
    expect(result.current?.status).toBe('done');

    await tick(10_000);
    expect(getMeetingStatus).toHaveBeenCalledTimes(3);
  });

  it('stops on failed', async () => {
    vi.mocked(getMeetingStatus).mockResolvedValue(dto('failed'));
    renderHook(() => useMeetingStatus('m1'));
    await tick(0);
    await tick(10_000);
    expect(getMeetingStatus).toHaveBeenCalledTimes(1);
  });

  it('resets to null and stops polling when id changes to null', async () => {
    vi.mocked(getMeetingStatus).mockResolvedValue(dto('processing'));
    const { result, rerender } = renderHook(({ id }) => useMeetingStatus(id), { initialProps: { id: 'm1' as string | null } });
    await tick(0);
    expect(result.current).not.toBeNull();
    rerender({ id: null });
    await tick(0);
    expect(result.current).toBeNull();
    const calls = vi.mocked(getMeetingStatus).mock.calls.length;
    await tick(5000);
    expect(getMeetingStatus).toHaveBeenCalledTimes(calls);
  });
});
