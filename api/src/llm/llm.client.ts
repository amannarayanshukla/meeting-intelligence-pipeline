/** Adapter boundary. Swap the provider by adding a class and changing one provider line in LlmModule. */
export abstract class LlmClient {
  abstract complete(prompt: string): Promise<string>;
  abstract embed(text: string): Promise<number[]>;
}
