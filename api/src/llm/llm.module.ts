import { Module } from '@nestjs/common';
import { LlmClient } from './llm.client.js';
import { MockLlmClient } from './mock-llm.client.js';

@Module({
  providers: [{ provide: LlmClient, useFactory: () => new MockLlmClient() }],
  exports: [LlmClient],
})
export class LlmModule {}
