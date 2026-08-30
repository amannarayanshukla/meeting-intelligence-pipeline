'use client';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MeetingCard } from '@/components/MeetingCard';
import { useMeetingStatus } from '@/hooks/useMeetingStatus';
import { submitMeeting } from '@/lib/api';
import { SAMPLE_TRANSCRIPT } from '@/lib/sample-transcript';

const badgeVariant = { processing: 'secondary', done: 'default', failed: 'destructive' } as const;

export default function Home() {
  const [transcript, setTranscript] = useState('');
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const status = useMeetingStatus(meetingId);

  async function onProcess() {
    setSubmitting(true);
    setSubmitError(null);
    setMeetingId(null);
    try {
      const { id } = await submitMeeting(transcript);
      setMeetingId(id);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meeting Intelligence Pipeline</h1>
          <p className="text-sm text-muted-foreground">Transcript → BullMQ → 3 parallel workers → live reveal</p>
        </div>
        {status && <Badge variant={badgeVariant[status.status]}>{status.status}</Badge>}
      </header>

      <Textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={10}
        placeholder="Paste a meeting transcript…"
        className="font-mono text-xs"
      />

      <div className="flex items-center gap-2">
        <Button onClick={onProcess} disabled={submitting || !transcript.trim()}>
          {submitting ? 'Submitting…' : 'Process Pipeline'}
        </Button>
        <Button variant="outline" onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}>
          Load sample
        </Button>
        {meetingId && <span className="ml-auto font-mono text-xs text-muted-foreground">{meetingId}</span>}
        {submitError && <span role="alert" className="text-sm text-destructive">{submitError}</span>}
      </div>

      {meetingId && (
        <div className="grid gap-4 md:grid-cols-3">
          <MeetingCard title="Summary" data={status?.summary ?? null} error={status?.errors.summarize}>
            {(bullets) => (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
          </MeetingCard>

          <MeetingCard title="Action Items" data={status?.actions ?? null} error={status?.errors.extract_actions}>
            {(items) => (
              <table className="w-full text-sm">
                <tbody>
                  {items.map((a, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-1 pr-2">{a.task}</td>
                      <td className="py-1 text-right text-muted-foreground">{a.assignee}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </MeetingCard>

          <MeetingCard title="Vector Embedding" data={status?.vector ?? null} error={status?.errors.vectorize}>
            {(v) => (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">{v.dims} dimensions</p>
                <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                  [{v.preview.map((n) => n.toFixed(4)).join(', ')}, …]
                </pre>
              </div>
            )}
          </MeetingCard>
        </div>
      )}
    </main>
  );
}
