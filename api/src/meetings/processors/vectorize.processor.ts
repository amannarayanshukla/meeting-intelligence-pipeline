import { Injectable } from '@nestjs/common';
import { LlmClient } from '../../llm/llm.client.js';
import { MeetingPatch } from '../meeting.entity.js';
import { TranscriptProcessor } from './transcript.processor.js';

@Injectable()
export class VectorizeProcessor implements TranscriptProcessor {
  readonly kind = 'vectorize' as const;

  constructor(private readonly llm: LlmClient) {}

  async process(transcript: string): Promise<MeetingPatch> {
    const vector = await this.llm.embed(transcript);
    if (vector.length === 0) throw new Error('Embedding returned empty vector');
    return { vector };
  }
}
