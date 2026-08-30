import { LlmClient } from '../llm/llm.client.js';

export class FakeLlmClient extends LlmClient {
  constructor(
    private readonly reply: string,
    private readonly vec: number[] = [],
  ) {
    super();
  }
  async complete(): Promise<string> {
    return this.reply;
  }
  async embed(): Promise<number[]> {
    return this.vec;
  }
}
