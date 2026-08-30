import { Injectable } from '@nestjs/common';
import { LlmClient } from '../../llm/llm.client.js';
import { ActionItem, MeetingPatch } from '../meeting.entity.js';
import { TranscriptProcessor } from './transcript.processor.js';

function isActionItem(x: unknown): x is ActionItem {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as ActionItem).task === 'string' &&
    typeof (x as ActionItem).assignee === 'string'
  );
}

@Injectable()
export class ActionExtractorProcessor implements TranscriptProcessor {
  readonly kind = 'extract_actions' as const;

  constructor(private readonly llm: LlmClient) {}

  async process(transcript: string): Promise<MeetingPatch> {
    const raw = await this.llm.complete(
      `Extract action items from this transcript. Reply with ONLY a JSON array of {"task": string, "assignee": string}.\n\n${transcript}`,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Action extractor returned invalid JSON');
    }
    if (!Array.isArray(parsed) || !parsed.every(isActionItem)) {
      throw new Error('Action extractor returned wrong shape');
    }
    return { actions: parsed };
  }
}
