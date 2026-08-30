import { Injectable } from '@nestjs/common';
import { LlmClient } from '../../llm/llm.client.js';
import { MeetingPatch } from '../meeting.entity.js';
import { TranscriptProcessor } from './transcript.processor.js';

@Injectable()
export class SummarizeProcessor implements TranscriptProcessor {
  readonly kind = 'summarize' as const;

  constructor(private readonly llm: LlmClient) {}

  async process(transcript: string): Promise<MeetingPatch> {
    const raw = await this.llm.complete(
      `Summarize this meeting transcript in exactly 3 bullet points.\n\n${transcript}`,
    );
    const summary = raw
      .split('\n')
      .map((line) => line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
    if (summary.length === 0) throw new Error('Summarizer returned no bullets');
    return { summary };
  }
}
