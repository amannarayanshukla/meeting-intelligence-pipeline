export interface AddCall {
  name: string;
  data: unknown;
  opts?: Record<string, unknown>;
}

/** Records Queue.add calls. Cast to `Queue` where a real one is expected. */
export class FakeQueue {
  readonly calls: AddCall[] = [];
  async add(name: string, data: unknown, opts?: Record<string, unknown>) {
    this.calls.push({ name, data, opts });
    return { id: opts?.jobId, name, data };
  }
}
