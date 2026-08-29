# Parallelized Meeting Intelligence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `POST` drops a transcript into a BullMQ queue; three parallel workers write summary / action items / vector into a meeting record; a Next.js UI polls and reveals each result as it lands.

**Architecture:** NestJS API + BullMQ worker in one process. Strategy pattern for the three processors, Repository pattern for storage (InMemory for tests, Mongo for deploy), Adapter pattern for the LLM (Mock only). Status is derived at read time from which fields are filled.

**Tech Stack:** NestJS 11, `@nestjs/bullmq` + `bullmq` + `ioredis`, `@nestjs/mongoose` + `mongoose`, `class-validator`, Jest + supertest (api). Next.js 15 (App Router) + Tailwind + shadcn/ui, Vitest + React Testing Library (web).

**Spec:** `docs/superpowers/specs/2026-08-30-meeting-pipeline-design.md`

## Global Constraints

- Two plain folders `api/` and `web/`, each with its own `package.json`. No workspace tooling.
- Queue name is `meetings`; job names are exactly `summarize`, `extract_actions`, `vectorize`.
- Job data is `{ meetingId }` only — the worker reloads the transcript from the repository.
- `jobId` is `${meetingId}-${kind}`; `attempts: 3`, `backoff: { type: 'exponential', delay: 500 }`.
- `status` is derived: `failed` if any `errors[kind]`, else `done` if `summary`, `actions`, `vector` all non-null, else `processing`.
- API prefix `/api`; `POST /api/meetings` returns **202**; transcript validated `IsString`, `Length(1, 200_000)`.
- Mock vector has **768** floats; the GET DTO returns `{ dims, preview: first 8 }`.
- Mock delays: `summarize` 1500 ms, `extract_actions` 3000 ms, `embed` 4500 ms (tests pass 0).
- Frontend polls every **1500 ms** and stops on `done` or `failed`.
- Every deliberate simplification gets a `// ponytail:` comment naming the ceiling.
- Commit after every task with the trailer:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Ncdj1XQFx8woK76ZtQQC2Q
  ```

## File Map

| File | Responsibility |
|---|---|
| `api/src/meetings/meeting.entity.ts` | `Meeting`, `MeetingPatch`, `MeetingUpdate`, `JobKind`, `JOB_KINDS`, `MEETINGS_QUEUE`, `MeetingJobData`, `deriveStatus()` |
| `api/src/meetings/repository/meeting.repository.ts` | abstract `MeetingRepository` (DI token) |
| `api/src/meetings/repository/in-memory-meeting.repository.ts` | Map-backed impl (tests/local) |
| `api/src/meetings/repository/mongo-meeting.repository.ts` | Mongoose schema + impl (deploy) |
| `api/src/llm/llm.client.ts` | abstract `LlmClient` (DI token) |
| `api/src/llm/mock-llm.client.ts` | canned replies + staggered delays |
| `api/src/llm/llm.module.ts` | provides `LlmClient → MockLlmClient` |
| `api/src/meetings/processors/transcript.processor.ts` | `TranscriptProcessor` interface + `PROCESSORS` token |
| `api/src/meetings/processors/{summarize,action-extractor,vectorize}.processor.ts` | the three Strategies |
| `api/src/meetings/dto/create-meeting.dto.ts` | request validation |
| `api/src/meetings/dto/meeting-status.dto.ts` | `MeetingStatusDto` + `toStatusDto()` |
| `api/src/meetings/meetings.service.ts` | Facade: `submit()`, `status()` |
| `api/src/meetings/meetings.controller.ts` | two HTTP handlers |
| `api/src/meetings/queue/meeting.worker.ts` | BullMQ worker, dispatch by `job.name`, failure → `errors` |
| `api/src/meetings/meetings.module.ts` | wiring |
| `api/src/app.module.ts`, `api/src/main.ts` | root wiring, pipes, CORS |
| `api/src/testing/fake-llm.client.ts`, `fake-queue.ts` | test doubles (excluded from build) |
| `api/test/meetings.e2e-spec.ts` | HTTP surface |
| `web/src/lib/types.ts` | `MeetingStatusDto` copy |
| `web/src/lib/api.ts` | `submitMeeting()`, `getMeetingStatus()` |
| `web/src/hooks/useMeetingStatus.ts` | polling hook |
| `web/src/components/MeetingCard.tsx` | skeleton / error / content card |
| `web/src/app/page.tsx` | the dashboard |
| `web/src/lib/sample-transcript.ts` | demo input |
| `docker-compose.yml`, `README.md` | local infra, run instructions |

---

### Task 1: Scaffold `api` and the domain entity

**Files:**
- Create: `api/` (Nest CLI), `api/src/meetings/meeting.entity.ts`
- Delete: `api/src/app.controller.ts`, `api/src/app.service.ts`, `api/src/app.controller.spec.ts`, `api/test/app.e2e-spec.ts`
- Test: `api/src/meetings/meeting.entity.spec.ts`

**Interfaces:**
- Produces: `JOB_KINDS`, `JobKind`, `MEETINGS_QUEUE = 'meetings'`, `MeetingJobData`, `ActionItem`, `Meeting`, `MeetingPatch`, `MeetingUpdate`, `MeetingStatus`, `deriveStatus(m: Meeting): MeetingStatus`

- [ ] **Step 1: Scaffold with Nest CLI and install deps**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
npx @nestjs/cli@latest new api --package-manager npm --skip-git --strict
cd api
npm i @nestjs/bullmq bullmq ioredis @nestjs/mongoose mongoose @nestjs/config class-validator class-transformer
rm src/app.controller.ts src/app.service.ts src/app.controller.spec.ts test/app.e2e-spec.ts
```

Edit `api/src/app.module.ts` to an empty module for now:

```ts
import { Module } from '@nestjs/common';

@Module({ imports: [] })
export class AppModule {}
```

Edit `api/tsconfig.build.json` so test doubles are not compiled:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "src/testing"]
}
```

- [ ] **Step 2: Write the failing test**

`api/src/meetings/meeting.entity.spec.ts`:

```ts
import { deriveStatus, Meeting } from './meeting.entity';

const base: Meeting = {
  id: 'm1',
  transcript: 'hello',
  summary: null,
  actions: null,
  vector: null,
  errors: {},
  createdAt: new Date('2026-08-30T00:00:00Z'),
};

describe('deriveStatus', () => {
  it.each<[string, Partial<Meeting>, string]>([
    ['nothing done', {}, 'processing'],
    ['two of three', { summary: ['a'], actions: [] }, 'processing'],
    ['all three', { summary: ['a'], actions: [], vector: [0.1] }, 'done'],
    ['error wins', { summary: ['a'], actions: [], vector: [0.1], errors: { vectorize: 'boom' } }, 'failed'],
  ])('%s → %s', (_, patch, expected) => {
    expect(deriveStatus({ ...base, ...patch })).toBe(expected);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx jest src/meetings/meeting.entity.spec.ts`
Expected: FAIL — `Cannot find module './meeting.entity'`

- [ ] **Step 4: Write the entity**

`api/src/meetings/meeting.entity.ts`:

```ts
export const JOB_KINDS = ['summarize', 'extract_actions', 'vectorize'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const MEETINGS_QUEUE = 'meetings';
export interface MeetingJobData {
  meetingId: string;
}

export interface ActionItem {
  task: string;
  assignee: string;
}

export interface Meeting {
  id: string;
  transcript: string;
  summary: string[] | null;
  actions: ActionItem[] | null;
  vector: number[] | null;
  errors: Partial<Record<JobKind, string>>;
  createdAt: Date;
}

/** What a processor produces. */
export type MeetingPatch = Partial<Pick<Meeting, 'summary' | 'actions' | 'vector'>>;
/** What the repository accepts (processor output or a failure note). */
export type MeetingUpdate = MeetingPatch & { errors?: Partial<Record<JobKind, string>> };

export type MeetingStatus = 'processing' | 'done' | 'failed';

// ponytail: status derived at read time — no counter to keep in sync, no "all done" race.
export function deriveStatus(m: Meeting): MeetingStatus {
  if (Object.keys(m.errors).length > 0) return 'failed';
  if (m.summary && m.actions && m.vector) return 'done';
  return 'processing';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx jest src/meetings/meeting.entity.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
git add api docs
git commit -m "feat(api): scaffold NestJS app and meeting entity with derived status"
```

---

### Task 2: Repository abstraction + in-memory implementation

**Files:**
- Create: `api/src/meetings/repository/meeting.repository.ts`, `api/src/meetings/repository/in-memory-meeting.repository.ts`
- Test: `api/src/meetings/repository/in-memory-meeting.repository.spec.ts`

**Interfaces:**
- Consumes: `Meeting`, `MeetingUpdate` from Task 1
- Produces: `abstract class MeetingRepository { create(input: { transcript: string }): Promise<Meeting>; findById(id: string): Promise<Meeting | null>; patch(id: string, update: MeetingUpdate): Promise<void> }`, `class InMemoryMeetingRepository extends MeetingRepository`

- [ ] **Step 1: Write the failing test**

`api/src/meetings/repository/in-memory-meeting.repository.spec.ts`:

```ts
import { InMemoryMeetingRepository } from './in-memory-meeting.repository';

describe('InMemoryMeetingRepository', () => {
  let repo: InMemoryMeetingRepository;
  beforeEach(() => {
    repo = new InMemoryMeetingRepository();
  });

  it('create returns a record with id, transcript and null fields', async () => {
    const m = await repo.create({ transcript: 'hi' });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m).toMatchObject({ transcript: 'hi', summary: null, actions: null, vector: null, errors: {} });
    expect(m.createdAt).toBeInstanceOf(Date);
  });

  it('findById returns null for unknown id', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('patch merges fields and errors independently', async () => {
    const { id } = await repo.create({ transcript: 'hi' });
    await repo.patch(id, { summary: ['a'] });
    await repo.patch(id, { errors: { vectorize: 'boom' } });
    await repo.patch(id, { errors: { summarize: 'bad' } });
    const m = await repo.findById(id);
    expect(m?.summary).toEqual(['a']);
    expect(m?.actions).toBeNull();
    expect(m?.errors).toEqual({ vectorize: 'boom', summarize: 'bad' });
  });

  it('patch on unknown id throws', async () => {
    await expect(repo.patch('nope', { summary: [] })).rejects.toThrow('not found');
  });

  it('returned objects are copies, not live references', async () => {
    const m = await repo.create({ transcript: 'hi' });
    m.summary = ['mutated'];
    expect((await repo.findById(m.id))?.summary).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/meetings/repository`
Expected: FAIL — `Cannot find module './in-memory-meeting.repository'`

- [ ] **Step 3: Write the abstract class and in-memory implementation**

`api/src/meetings/repository/meeting.repository.ts`:

```ts
import { Meeting, MeetingUpdate } from '../meeting.entity';

/** Abstract class (not interface) so it doubles as the Nest DI token. */
export abstract class MeetingRepository {
  abstract create(input: { transcript: string }): Promise<Meeting>;
  abstract findById(id: string): Promise<Meeting | null>;
  abstract patch(id: string, update: MeetingUpdate): Promise<void>;
}
```

`api/src/meetings/repository/in-memory-meeting.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Meeting, MeetingUpdate } from '../meeting.entity';
import { MeetingRepository } from './meeting.repository';

@Injectable()
export class InMemoryMeetingRepository extends MeetingRepository {
  private readonly store = new Map<string, Meeting>();

  async create({ transcript }: { transcript: string }): Promise<Meeting> {
    const m: Meeting = {
      id: randomUUID(),
      transcript,
      summary: null,
      actions: null,
      vector: null,
      errors: {},
      createdAt: new Date(),
    };
    this.store.set(m.id, m);
    return structuredClone(m);
  }

  async findById(id: string): Promise<Meeting | null> {
    const m = this.store.get(id);
    return m ? structuredClone(m) : null;
  }

  async patch(id: string, { errors, ...fields }: MeetingUpdate): Promise<void> {
    const m = this.store.get(id);
    if (!m) throw new Error(`Meeting ${id} not found`);
    Object.assign(m, fields);
    if (errors) Object.assign(m.errors, errors);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/meetings/repository`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/meetings/repository
git commit -m "feat(api): MeetingRepository abstraction with in-memory implementation"
```

---

### Task 3: LLM adapter + mock client

**Files:**
- Create: `api/src/llm/llm.client.ts`, `api/src/llm/mock-llm.client.ts`, `api/src/llm/llm.module.ts`
- Test: `api/src/llm/mock-llm.client.spec.ts`

**Interfaces:**
- Produces: `abstract class LlmClient { complete(prompt: string): Promise<string>; embed(text: string): Promise<number[]> }`, `class MockLlmClient extends LlmClient` with constructor `(delays?: MockDelays)`, `interface MockDelays { complete: (prompt: string) => number; embed: number }`, `LlmModule` exporting `LlmClient`

- [ ] **Step 1: Write the failing test**

`api/src/llm/mock-llm.client.spec.ts`:

```ts
import { MockLlmClient } from './mock-llm.client';

const instant = new MockLlmClient({ complete: () => 0, embed: 0 });

describe('MockLlmClient', () => {
  it('returns three bullet lines for a summary prompt', async () => {
    const out = await instant.complete('Summarize this meeting in 3 bullet points.');
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
  });

  it('returns a JSON array of action items when the prompt asks for JSON', async () => {
    const out = await instant.complete('Reply with ONLY a JSON array.');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({ task: expect.any(String), assignee: expect.any(String) });
  });

  it('embeds to 768 deterministic floats', async () => {
    const a = await instant.embed('same text');
    const b = await instant.embed('same text');
    expect(a).toHaveLength(768);
    expect(a).toEqual(b);
    expect(a.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
  });

  it('waits the configured delay', async () => {
    const slow = new MockLlmClient({ complete: () => 30, embed: 0 });
    const t0 = Date.now();
    await slow.complete('x');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/llm`
Expected: FAIL — `Cannot find module './mock-llm.client'`

- [ ] **Step 3: Write the adapter, mock, and module**

`api/src/llm/llm.client.ts`:

```ts
/** Adapter boundary. Swap the provider by adding a class and changing one provider line in LlmModule. */
export abstract class LlmClient {
  abstract complete(prompt: string): Promise<string>;
  abstract embed(text: string): Promise<number[]>;
}
```

`api/src/llm/mock-llm.client.ts`:

```ts
import { setTimeout as sleep } from 'node:timers/promises';
import { LlmClient } from './llm.client';

export interface MockDelays {
  complete: (prompt: string) => number;
  embed: number;
}

// Staggered on purpose: the demo's "cards land one after another" comes from here.
export const DEFAULT_DELAYS: MockDelays = {
  complete: (prompt) => (prompt.includes('JSON') ? 3000 : 1500),
  embed: 4500,
};

const SUMMARY = [
  '- The team agreed to ship the parallel pipeline prototype by Friday.',
  '- Redis-backed BullMQ workers will process summaries, actions, and embeddings independently.',
  '- The frontend will poll every 1.5 seconds and reveal each result as it lands.',
].join('\n');

const ACTIONS = JSON.stringify([
  { task: 'Provision Upstash Redis and wire REDIS_URL', assignee: 'Aman' },
  { task: 'Record the 90-second Loom demo', assignee: 'Aman' },
  { task: 'Review worker retry and backoff settings', assignee: 'Priya' },
]);

// ponytail: mock provider. Add GeminiLlmClient implementing LlmClient when a key exists.
export class MockLlmClient extends LlmClient {
  constructor(private readonly delays: MockDelays = DEFAULT_DELAYS) {
    super();
  }

  async complete(prompt: string): Promise<string> {
    await sleep(this.delays.complete(prompt));
    return prompt.includes('JSON') ? ACTIONS : SUMMARY;
  }

  async embed(text: string): Promise<number[]> {
    await sleep(this.delays.embed);
    const seed = text.length;
    return Array.from({ length: 768 }, (_, i) => Number(Math.sin(i * 0.1 + seed).toFixed(6)));
  }
}
```

`api/src/llm/llm.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LlmClient } from './llm.client';
import { MockLlmClient } from './mock-llm.client';

@Module({
  providers: [{ provide: LlmClient, useFactory: () => new MockLlmClient() }],
  exports: [LlmClient],
})
export class LlmModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/llm`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/llm
git commit -m "feat(api): LlmClient adapter with staggered MockLlmClient"
```

---

### Task 4: The three processors (Strategy)

**Files:**
- Create: `api/src/meetings/processors/transcript.processor.ts`, `summarize.processor.ts`, `action-extractor.processor.ts`, `vectorize.processor.ts`, `api/src/testing/fake-llm.client.ts`
- Test: `api/src/meetings/processors/processors.spec.ts`

**Interfaces:**
- Consumes: `LlmClient` (Task 3), `JobKind`, `MeetingPatch`, `ActionItem` (Task 1)
- Produces: `PROCESSORS` symbol, `interface TranscriptProcessor { readonly kind: JobKind; process(transcript: string): Promise<MeetingPatch> }`, classes `SummarizeProcessor`, `ActionExtractorProcessor`, `VectorizeProcessor` (each `constructor(llm: LlmClient)`), test double `FakeLlmClient(reply: string, vec?: number[])`

- [ ] **Step 1: Write the test double**

`api/src/testing/fake-llm.client.ts`:

```ts
import { LlmClient } from '../llm/llm.client';

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
```

- [ ] **Step 2: Write the failing tests**

`api/src/meetings/processors/processors.spec.ts`:

```ts
import { FakeLlmClient } from '../../testing/fake-llm.client';
import { ActionExtractorProcessor } from './action-extractor.processor';
import { SummarizeProcessor } from './summarize.processor';
import { VectorizeProcessor } from './vectorize.processor';

describe('SummarizeProcessor', () => {
  it('has kind summarize', () => {
    expect(new SummarizeProcessor(new FakeLlmClient('')).kind).toBe('summarize');
  });

  it('parses bullets, strips markers, keeps at most 3', async () => {
    const llm = new FakeLlmClient('- one\n\n• two\n3. three\n- four');
    await expect(new SummarizeProcessor(llm).process('t')).resolves.toEqual({
      summary: ['one', 'two', 'three'],
    });
  });

  it('throws when the reply has no bullets', async () => {
    await expect(new SummarizeProcessor(new FakeLlmClient('   \n ')).process('t')).rejects.toThrow('no bullets');
  });
});

describe('ActionExtractorProcessor', () => {
  it('has kind extract_actions', () => {
    expect(new ActionExtractorProcessor(new FakeLlmClient('[]')).kind).toBe('extract_actions');
  });

  it('parses a JSON array of action items', async () => {
    const llm = new FakeLlmClient('[{"task":"ship","assignee":"Aman"}]');
    await expect(new ActionExtractorProcessor(llm).process('t')).resolves.toEqual({
      actions: [{ task: 'ship', assignee: 'Aman' }],
    });
  });

  it('throws on invalid JSON', async () => {
    await expect(new ActionExtractorProcessor(new FakeLlmClient('not json')).process('t')).rejects.toThrow('invalid JSON');
  });

  it('throws on wrong shape', async () => {
    await expect(new ActionExtractorProcessor(new FakeLlmClient('[{"task":1}]')).process('t')).rejects.toThrow('wrong shape');
  });
});

describe('VectorizeProcessor', () => {
  it('has kind vectorize', () => {
    expect(new VectorizeProcessor(new FakeLlmClient('')).kind).toBe('vectorize');
  });

  it('returns the embedding', async () => {
    const llm = new FakeLlmClient('', [0.1, 0.2]);
    await expect(new VectorizeProcessor(llm).process('t')).resolves.toEqual({ vector: [0.1, 0.2] });
  });

  it('throws on an empty embedding', async () => {
    await expect(new VectorizeProcessor(new FakeLlmClient('', [])).process('t')).rejects.toThrow('empty');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd api && npx jest src/meetings/processors`
Expected: FAIL — `Cannot find module './summarize.processor'`

- [ ] **Step 4: Write the interface and three processors**

`api/src/meetings/processors/transcript.processor.ts`:

```ts
import { JobKind, MeetingPatch } from '../meeting.entity';

/** Strategy: one implementation per JobKind. The worker picks by job.name. */
export interface TranscriptProcessor {
  readonly kind: JobKind;
  process(transcript: string): Promise<MeetingPatch>;
}

/** Multi-provider DI token: the array of all processors. */
export const PROCESSORS = Symbol('PROCESSORS');
```

`api/src/meetings/processors/summarize.processor.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { LlmClient } from '../../llm/llm.client';
import { MeetingPatch } from '../meeting.entity';
import { TranscriptProcessor } from './transcript.processor';

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
```

`api/src/meetings/processors/action-extractor.processor.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { LlmClient } from '../../llm/llm.client';
import { ActionItem, MeetingPatch } from '../meeting.entity';
import { TranscriptProcessor } from './transcript.processor';

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
```

`api/src/meetings/processors/vectorize.processor.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { LlmClient } from '../../llm/llm.client';
import { MeetingPatch } from '../meeting.entity';
import { TranscriptProcessor } from './transcript.processor';

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && npx jest src/meetings/processors`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add api/src/meetings/processors api/src/testing
git commit -m "feat(api): Summarize, ActionExtractor, Vectorize processors (Strategy)"
```

---

### Task 5: MeetingsService (Facade) + status DTO

**Files:**
- Create: `api/src/meetings/dto/meeting-status.dto.ts`, `api/src/meetings/meetings.service.ts`, `api/src/testing/fake-queue.ts`
- Test: `api/src/meetings/meetings.service.spec.ts`

**Interfaces:**
- Consumes: `MeetingRepository`, `InMemoryMeetingRepository` (Task 2); `JOB_KINDS`, `MEETINGS_QUEUE`, `MeetingJobData`, `JobKind`, `Meeting`, `deriveStatus` (Task 1)
- Produces: `interface MeetingStatusDto`, `toStatusDto(m: Meeting): MeetingStatusDto`, `class MeetingsService { submit(transcript: string): Promise<{ id: string }>; status(id: string): Promise<MeetingStatusDto | null> }`, test double `FakeQueue` with `.calls`

- [ ] **Step 1: Write the test double**

`api/src/testing/fake-queue.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

`api/src/meetings/meetings.service.spec.ts`:

```ts
import { Queue } from 'bullmq';
import { FakeQueue } from '../testing/fake-queue';
import { MeetingsService } from './meetings.service';
import { InMemoryMeetingRepository } from './repository/in-memory-meeting.repository';

describe('MeetingsService', () => {
  let repo: InMemoryMeetingRepository;
  let queue: FakeQueue;
  let service: MeetingsService;

  beforeEach(() => {
    repo = new InMemoryMeetingRepository();
    queue = new FakeQueue();
    service = new MeetingsService(repo, queue as unknown as Queue);
  });

  it('submit creates the record and enqueues three jobs with dedupe ids', async () => {
    const { id } = await service.submit('hello world');
    expect(await repo.findById(id)).toMatchObject({ transcript: 'hello world' });
    expect(queue.calls.map((c) => c.name)).toEqual(['summarize', 'extract_actions', 'vectorize']);
    for (const call of queue.calls) {
      expect(call.data).toEqual({ meetingId: id });
      expect(call.opts).toEqual({
        jobId: `${id}-${call.name}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
      });
    }
  });

  it('status returns null for unknown id', async () => {
    expect(await service.status('nope')).toBeNull();
  });

  it('status maps fields, derives status, and previews the vector', async () => {
    const { id } = await service.submit('t');
    expect((await service.status(id))?.status).toBe('processing');

    await repo.patch(id, {
      summary: ['a'],
      actions: [{ task: 'x', assignee: 'y' }],
      vector: Array.from({ length: 768 }, (_, i) => i),
    });
    const dto = await service.status(id);
    expect(dto).toMatchObject({
      id,
      status: 'done',
      summary: ['a'],
      actions: [{ task: 'x', assignee: 'y' }],
      vector: { dims: 768, preview: [0, 1, 2, 3, 4, 5, 6, 7] },
      errors: {},
    });
    expect(typeof dto?.createdAt).toBe('string');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx jest src/meetings/meetings.service.spec.ts`
Expected: FAIL — `Cannot find module './meetings.service'`

- [ ] **Step 4: Write the DTO mapper and service**

`api/src/meetings/dto/meeting-status.dto.ts`:

```ts
import { ActionItem, deriveStatus, JobKind, Meeting, MeetingStatus } from '../meeting.entity';

export interface MeetingStatusDto {
  id: string;
  status: MeetingStatus;
  summary: string[] | null;
  actions: ActionItem[] | null;
  vector: { dims: number; preview: number[] } | null;
  errors: Partial<Record<JobKind, string>>;
  createdAt: string;
}

export function toStatusDto(m: Meeting): MeetingStatusDto {
  return {
    id: m.id,
    status: deriveStatus(m),
    summary: m.summary,
    actions: m.actions,
    vector: m.vector && { dims: m.vector.length, preview: m.vector.slice(0, 8) },
    errors: m.errors,
    createdAt: m.createdAt.toISOString(),
  };
}
```

`api/src/meetings/meetings.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MeetingStatusDto, toStatusDto } from './dto/meeting-status.dto';
import { JOB_KINDS, JobKind, MEETINGS_QUEUE, MeetingJobData } from './meeting.entity';
import { MeetingRepository } from './repository/meeting.repository';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly repo: MeetingRepository,
    @InjectQueue(MEETINGS_QUEUE) private readonly queue: Queue<MeetingJobData, void, JobKind>,
  ) {}

  async submit(transcript: string): Promise<{ id: string }> {
    const { id } = await this.repo.create({ transcript });
    // Payload is just the id: the worker reloads the transcript, so a 60-minute transcript never sits in Redis ×3.
    await Promise.all(
      JOB_KINDS.map((kind) =>
        this.queue.add(
          kind,
          { meetingId: id },
          { jobId: `${id}-${kind}`, attempts: 3, backoff: { type: 'exponential', delay: 500 } },
        ),
      ),
    );
    return { id };
  }

  async status(id: string): Promise<MeetingStatusDto | null> {
    const m = await this.repo.findById(id);
    return m && toStatusDto(m);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx jest src/meetings/meetings.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add api/src/meetings/dto/meeting-status.dto.ts api/src/meetings/meetings.service.ts api/src/meetings/meetings.service.spec.ts api/src/testing/fake-queue.ts
git commit -m "feat(api): MeetingsService facade enqueues three jobs; status DTO"
```

---

### Task 6: MeetingWorker (BullMQ dispatch + failure recording)

**Files:**
- Create: `api/src/meetings/queue/meeting.worker.ts`
- Test: `api/src/meetings/queue/meeting.worker.spec.ts`

**Interfaces:**
- Consumes: `PROCESSORS`, `TranscriptProcessor` (Task 4); `MeetingRepository`, `InMemoryMeetingRepository` (Task 2); `MEETINGS_QUEUE`, `MeetingJobData`, `JobKind` (Task 1)
- Produces: `class MeetingWorker extends WorkerHost` with `constructor(processors: TranscriptProcessor[], repo: MeetingRepository)`, `process(job: Job<MeetingJobData, void, string>): Promise<void>`, `onFailed(job, err): Promise<void>`

- [ ] **Step 1: Write the failing test**

`api/src/meetings/queue/meeting.worker.spec.ts`:

```ts
import { Job } from 'bullmq';
import { MeetingJobData } from '../meeting.entity';
import { TranscriptProcessor } from '../processors/transcript.processor';
import { InMemoryMeetingRepository } from '../repository/in-memory-meeting.repository';
import { MeetingWorker } from './meeting.worker';

const summarize: TranscriptProcessor = {
  kind: 'summarize',
  process: jest.fn(async (t: string) => ({ summary: [`sum of ${t}`] })),
};

function job(name: string, meetingId: string, extra: Partial<Job> = {}): Job<MeetingJobData, void, string> {
  return { name, data: { meetingId }, attemptsMade: 0, opts: { attempts: 3 }, ...extra } as unknown as Job<
    MeetingJobData,
    void,
    string
  >;
}

describe('MeetingWorker', () => {
  let repo: InMemoryMeetingRepository;
  let worker: MeetingWorker;

  beforeEach(() => {
    repo = new InMemoryMeetingRepository();
    worker = new MeetingWorker([summarize], repo);
  });

  it('dispatches by job.name, passes the stored transcript, and patches the record', async () => {
    const { id } = await repo.create({ transcript: 'hello' });
    await worker.process(job('summarize', id));
    expect(summarize.process).toHaveBeenCalledWith('hello');
    expect((await repo.findById(id))?.summary).toEqual(['sum of hello']);
  });

  it('throws on an unknown job name', async () => {
    const { id } = await repo.create({ transcript: 'hello' });
    await expect(worker.process(job('translate', id))).rejects.toThrow('Unknown job kind: translate');
  });

  it('throws when the meeting is missing', async () => {
    await expect(worker.process(job('summarize', 'ghost'))).rejects.toThrow('not found');
  });

  it('onFailed records the error only after the final attempt', async () => {
    const { id } = await repo.create({ transcript: 'hello' });
    await worker.onFailed(job('summarize', id, { attemptsMade: 1 }), new Error('flaky'));
    expect((await repo.findById(id))?.errors).toEqual({});

    await worker.onFailed(job('summarize', id, { attemptsMade: 3 }), new Error('dead'));
    expect((await repo.findById(id))?.errors).toEqual({ summarize: 'dead' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest src/meetings/queue`
Expected: FAIL — `Cannot find module './meeting.worker'`

- [ ] **Step 3: Write the worker**

`api/src/meetings/queue/meeting.worker.ts`:

```ts
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobKind, MEETINGS_QUEUE, MeetingJobData } from '../meeting.entity';
import { PROCESSORS, TranscriptProcessor } from '../processors/transcript.processor';
import { MeetingRepository } from '../repository/meeting.repository';

// ponytail: one queue, one worker, concurrency 3. Split into per-kind queues when one kind needs its own retry/concurrency policy.
@Processor(MEETINGS_QUEUE, { concurrency: 3 })
export class MeetingWorker extends WorkerHost {
  private readonly logger = new Logger(MeetingWorker.name);
  private readonly byKind: Map<JobKind, TranscriptProcessor>;

  constructor(
    @Inject(PROCESSORS) processors: TranscriptProcessor[],
    private readonly repo: MeetingRepository,
  ) {
    super();
    this.byKind = new Map(processors.map((p) => [p.kind, p]));
  }

  async process(job: Job<MeetingJobData, void, string>): Promise<void> {
    const processor = this.byKind.get(job.name as JobKind);
    if (!processor) throw new Error(`Unknown job kind: ${job.name}`);

    const meeting = await this.repo.findById(job.data.meetingId);
    if (!meeting) throw new Error(`Meeting ${job.data.meetingId} not found`);

    this.logger.log(`▶ ${job.name.padEnd(15)} start  meeting=${meeting.id}`);
    const patch = await processor.process(meeting.transcript);
    await this.repo.patch(meeting.id, patch);
    this.logger.log(`✔ ${job.name.padEnd(15)} done   meeting=${meeting.id}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MeetingJobData, void, string>, err: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return; // BullMQ will retry; not final yet
    this.logger.error(`✖ ${job.name.padEnd(15)} failed meeting=${job.data.meetingId}: ${err.message}`);
    await this.repo.patch(job.data.meetingId, { errors: { [job.name as JobKind]: err.message } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest src/meetings/queue`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/meetings/queue
git commit -m "feat(api): MeetingWorker dispatches by job name and records final failures"
```

---

### Task 7: Controller + request DTO + HTTP e2e

**Files:**
- Create: `api/src/meetings/dto/create-meeting.dto.ts`, `api/src/meetings/meetings.controller.ts`
- Test: `api/test/meetings.e2e-spec.ts`

**Interfaces:**
- Consumes: `MeetingsService` (Task 5), `MeetingRepository`/`InMemoryMeetingRepository` (Task 2), `FakeQueue` (Task 5), `MEETINGS_QUEUE` (Task 1)
- Produces: `POST /api/meetings` → 202 `{ id }`; `GET /api/meetings/:id` → 200 `MeetingStatusDto` | 404

- [ ] **Step 1: Write the failing e2e test**

`api/test/meetings.e2e-spec.ts` (if `import request from 'supertest'` fails to compile, use `import * as request from 'supertest'`):

```ts
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MEETINGS_QUEUE } from '../src/meetings/meeting.entity';
import { MeetingsController } from '../src/meetings/meetings.controller';
import { MeetingsService } from '../src/meetings/meetings.service';
import { InMemoryMeetingRepository } from '../src/meetings/repository/in-memory-meeting.repository';
import { MeetingRepository } from '../src/meetings/repository/meeting.repository';
import { FakeQueue } from '../src/testing/fake-queue';

describe('Meetings API', () => {
  let app: INestApplication;
  let repo: InMemoryMeetingRepository;
  let queue: FakeQueue;

  beforeAll(async () => {
    repo = new InMemoryMeetingRepository();
    queue = new FakeQueue();
    const moduleRef = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        MeetingsService,
        { provide: MeetingRepository, useValue: repo },
        { provide: getQueueToken(MEETINGS_QUEUE), useValue: queue },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(() => app.close());

  it('POST /api/meetings → 202 { id } and enqueues three jobs', async () => {
    const res = await request(app.getHttpServer()).post('/api/meetings').send({ transcript: 'hello' }).expect(202);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(queue.calls.filter((c) => (c.data as { meetingId: string }).meetingId === res.body.id)).toHaveLength(3);
  });

  it('POST with empty transcript → 400', async () => {
    await request(app.getHttpServer()).post('/api/meetings').send({ transcript: '' }).expect(400);
  });

  it('POST with missing transcript → 400', async () => {
    await request(app.getHttpServer()).post('/api/meetings').send({}).expect(400);
  });

  it('GET unknown id → 404', async () => {
    await request(app.getHttpServer()).get('/api/meetings/ghost').expect(404);
  });

  it('GET reflects repository patches and derived status', async () => {
    const { body } = await request(app.getHttpServer()).post('/api/meetings').send({ transcript: 'hello' });
    const id: string = body.id;

    let res = await request(app.getHttpServer()).get(`/api/meetings/${id}`).expect(200);
    expect(res.body).toMatchObject({ id, status: 'processing', summary: null, actions: null, vector: null });

    await repo.patch(id, { summary: ['a'] });
    res = await request(app.getHttpServer()).get(`/api/meetings/${id}`).expect(200);
    expect(res.body).toMatchObject({ status: 'processing', summary: ['a'] });

    await repo.patch(id, { actions: [{ task: 't', assignee: 'a' }], vector: Array(768).fill(0.5) });
    res = await request(app.getHttpServer()).get(`/api/meetings/${id}`).expect(200);
    expect(res.body).toMatchObject({ status: 'done', vector: { dims: 768 } });
    expect(res.body.vector.preview).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npm run test:e2e`
Expected: FAIL — `Cannot find module '../src/meetings/meetings.controller'`

- [ ] **Step 3: Write the DTO and controller**

`api/src/meetings/dto/create-meeting.dto.ts`:

```ts
import { IsString, Length } from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @Length(1, 200_000)
  transcript!: string;
}
```

`api/src/meetings/meetings.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { MeetingStatusDto } from './dto/meeting-status.dto';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  @HttpCode(202)
  submit(@Body() dto: CreateMeetingDto): Promise<{ id: string }> {
    return this.meetings.submit(dto.transcript);
  }

  @Get(':id')
  async status(@Param('id') id: string): Promise<MeetingStatusDto> {
    const dto = await this.meetings.status(id);
    if (!dto) throw new NotFoundException(`Meeting ${id} not found`);
    return dto;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npm run test:e2e`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole api suite**

Run: `cd api && npm test`
Expected: PASS — 25 unit tests across 6 suites

- [ ] **Step 6: Commit**

```bash
git add api/src/meetings/dto/create-meeting.dto.ts api/src/meetings/meetings.controller.ts api/test/meetings.e2e-spec.ts
git commit -m "feat(api): meetings controller with validation and HTTP e2e tests"
```

---

### Task 8: Mongo repository, module wiring, bootstrap, local smoke test

**Files:**
- Create: `api/src/meetings/repository/mongo-meeting.repository.ts`, `api/src/meetings/meetings.module.ts`, `api/.env.example`, `docker-compose.yml` (repo root)
- Modify: `api/src/app.module.ts`, `api/src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7
- Produces: a running server on `PORT` (default 3001) with `/api/meetings` backed by Mongo + Redis. `MongoMeetingRepository extends MeetingRepository`.

- [ ] **Step 1: Write the Mongo repository**

`api/src/meetings/repository/mongo-meeting.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, SchemaTypes } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { ActionItem, JobKind, Meeting, MeetingUpdate } from '../meeting.entity';
import { MeetingRepository } from './meeting.repository';

@Schema({ collection: 'meetings', versionKey: false })
export class MeetingDoc {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true }) transcript!: string;
  @Prop({ type: SchemaTypes.Mixed, default: null }) summary!: string[] | null;
  @Prop({ type: SchemaTypes.Mixed, default: null }) actions!: ActionItem[] | null;
  @Prop({ type: SchemaTypes.Mixed, default: null }) vector!: number[] | null;
  @Prop({ type: SchemaTypes.Mixed, default: {} }) errors!: Partial<Record<JobKind, string>>;
  @Prop({ type: Date, required: true }) createdAt!: Date;
}
export const MeetingSchema = SchemaFactory.createForClass(MeetingDoc);

function toMeeting(d: MeetingDoc): Meeting {
  return {
    id: d._id,
    transcript: d.transcript,
    summary: d.summary ?? null,
    actions: d.actions ?? null,
    vector: d.vector ?? null,
    errors: d.errors ?? {},
    createdAt: d.createdAt,
  };
}

// ponytail: untested by CI (would need mongodb-memory-server); the InMemory impl pins the contract, this one is smoke-tested in Task 8 step 6.
@Injectable()
export class MongoMeetingRepository extends MeetingRepository {
  constructor(@InjectModel(MeetingDoc.name) private readonly model: Model<MeetingDoc>) {
    super();
  }

  async create({ transcript }: { transcript: string }): Promise<Meeting> {
    const doc = await this.model.create({
      _id: randomUUID(),
      transcript,
      summary: null,
      actions: null,
      vector: null,
      errors: {},
      createdAt: new Date(),
    });
    return toMeeting(doc.toObject());
  }

  async findById(id: string): Promise<Meeting | null> {
    const doc = await this.model.findById(id).lean<MeetingDoc>();
    return doc ? toMeeting(doc) : null;
  }

  async patch(id: string, { errors, ...fields }: MeetingUpdate): Promise<void> {
    const $set: Record<string, unknown> = { ...fields };
    for (const [kind, message] of Object.entries(errors ?? {})) $set[`errors.${kind}`] = message;
    const res = await this.model.updateOne({ _id: id }, { $set });
    if (res.matchedCount === 0) throw new Error(`Meeting ${id} not found`);
  }
}
```

- [ ] **Step 2: Write the meetings module**

`api/src/meetings/meetings.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LlmModule } from '../llm/llm.module';
import { MEETINGS_QUEUE } from './meeting.entity';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { ActionExtractorProcessor } from './processors/action-extractor.processor';
import { SummarizeProcessor } from './processors/summarize.processor';
import { PROCESSORS, TranscriptProcessor } from './processors/transcript.processor';
import { VectorizeProcessor } from './processors/vectorize.processor';
import { MeetingWorker } from './queue/meeting.worker';
import { MeetingRepository } from './repository/meeting.repository';
import { MeetingDoc, MeetingSchema, MongoMeetingRepository } from './repository/mongo-meeting.repository';

@Module({
  imports: [
    BullModule.registerQueue({ name: MEETINGS_QUEUE }),
    MongooseModule.forFeature([{ name: MeetingDoc.name, schema: MeetingSchema }]),
    LlmModule,
  ],
  controllers: [MeetingsController],
  providers: [
    MeetingsService,
    MeetingWorker, // ponytail: worker lives in the API process. Move to its own entrypoint to scale independently.
    SummarizeProcessor,
    ActionExtractorProcessor,
    VectorizeProcessor,
    {
      provide: PROCESSORS,
      useFactory: (...processors: TranscriptProcessor[]) => processors,
      inject: [SummarizeProcessor, ActionExtractorProcessor, VectorizeProcessor],
    },
    { provide: MeetingRepository, useClass: MongoMeetingRepository },
  ],
})
export class MeetingsModule {}
```

- [ ] **Step 3: Wire the root module and bootstrap**

`api/src/app.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import IORedis from 'ioredis';
import { MeetingsModule } from './meetings/meetings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // maxRetriesPerRequest: null is required by BullMQ for its blocking connection.
        connection: new IORedis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null }),
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ uri: config.getOrThrow<string>('MONGO_URL') }),
    }),
    MeetingsModule,
  ],
})
export class AppModule {}
```

`api/src/main.ts`:

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
```

`api/.env.example`:

```
PORT=3001
REDIS_URL=redis://localhost:6379
MONGO_URL=mongodb://localhost:27017/meetings
CORS_ORIGIN=http://localhost:3000
```

`docker-compose.yml` (repo root):

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  mongo:
    image: mongo:7
    ports: ["27017:27017"]
```

- [ ] **Step 4: Build and confirm unit tests still pass**

Run: `cd api && npm run build && npm test`
Expected: build succeeds with no TS errors; 25 tests PASS

- [ ] **Step 5: Start local infra and the server**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
docker compose up -d
cd api && cp .env.example .env && npm run start:dev
```

Expected: log lines `Nest application successfully started` and no Redis/Mongo connection errors.

- [ ] **Step 6: Smoke-test the pipeline end to end**

In a second terminal:

```bash
ID=$(curl -s -X POST localhost:3001/api/meetings -H 'Content-Type: application/json' \
  -d '{"transcript":"Aman: lets ship by Friday. Priya: I will review the retries."}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "$ID"
for i in 1 2 3 4 5 6; do sleep 1; curl -s localhost:3001/api/meetings/$ID | node -pe 'const d=JSON.parse(require("fs").readFileSync(0)); `${d.status} summary=${!!d.summary} actions=${!!d.actions} vector=${!!d.vector}`'; done
```

Expected: server terminal shows three `▶ … start` lines within the same second, then `✔ summarize` (~1.5 s), `✔ extract_actions` (~3 s), `✔ vectorize` (~4.5 s). The loop prints `processing summary=false…` → `summary=true` → `actions=true` → `done … vector=true`. Re-POST the same body: three new jobs (new meeting id, so new jobIds).

- [ ] **Step 7: Commit**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
git add api/src docker-compose.yml api/.env.example
git commit -m "feat(api): Mongo repository, module wiring, bootstrap, local compose"
```

---

### Task 9: Scaffold `web`, API client, types, MeetingCard

**Files:**
- Create: `web/` (create-next-app + shadcn), `web/vitest.config.mts`, `web/vitest.setup.ts`, `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/components/MeetingCard.tsx`, `web/.env.example`
- Modify: `web/src/app/layout.tsx` (dark class), `web/package.json` (test script), `web/tsconfig.json`
- Test: `web/src/components/MeetingCard.test.tsx`

**Interfaces:**
- Produces: `MeetingStatusDto`, `JobKind` (types), `submitMeeting(transcript): Promise<{ id: string }>`, `getMeetingStatus(id): Promise<MeetingStatusDto>`, `MeetingCard<T>({ title, data: T | null, error?: string, children: (data: T) => ReactNode })`

- [ ] **Step 1: Scaffold Next.js + shadcn + Vitest**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
npx create-next-app@latest web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
cd web
npx shadcn@latest init -d
npx shadcn@latest add button card skeleton textarea badge
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom
```

`web/vitest.config.mts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
```

`web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Add to `web/package.json` scripts: `"test": "vitest run"`.

Edit `web/src/app/layout.tsx`: change `<html lang="en">` to `<html lang="en" className="dark">`.

`web/.env.example`:

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

- [ ] **Step 2: Write types and API client (no test — thin fetch wrappers)**

`web/src/lib/types.ts`:

```ts
// Hand-copied from api/src/meetings/dto/meeting-status.dto.ts — keep in sync.
export type JobKind = 'summarize' | 'extract_actions' | 'vectorize';
export type MeetingStatus = 'processing' | 'done' | 'failed';

export interface ActionItem {
  task: string;
  assignee: string;
}

export interface MeetingStatusDto {
  id: string;
  status: MeetingStatus;
  summary: string[] | null;
  actions: ActionItem[] | null;
  vector: { dims: number; preview: number[] } | null;
  errors: Partial<Record<JobKind, string>>;
  createdAt: string;
}
```

`web/src/lib/api.ts`:

```ts
import type { MeetingStatusDto } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function submitMeeting(transcript: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
  return res.json();
}

export async function getMeetingStatus(id: string): Promise<MeetingStatusDto> {
  const res = await fetch(`${BASE}/api/meetings/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Status failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Write the failing MeetingCard test**

`web/src/components/MeetingCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeetingCard } from './MeetingCard';

describe('MeetingCard', () => {
  it('shows a skeleton while data is null', () => {
    render(<MeetingCard title="Summary" data={null}>{(d: string[]) => <p>{d.join()}</p>}</MeetingCard>);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('renders content once data arrives', () => {
    render(<MeetingCard title="Summary" data={['a', 'b']}>{(d) => <p>{d.join('+')}</p>}</MeetingCard>);
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('a+b')).toBeInTheDocument();
  });

  it('shows the error instead of skeleton or content', () => {
    render(<MeetingCard title="Summary" data={null} error="boom">{(d: string[]) => <p>{d.join()}</p>}</MeetingCard>);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — `Failed to resolve import "./MeetingCard"`

- [ ] **Step 5: Write MeetingCard**

`web/src/components/MeetingCard.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Props<T> {
  title: string;
  data: T | null;
  error?: string;
  children: (data: T) => ReactNode;
}

export function MeetingCard<T>({ title, data, error, children }: Props<T>) {
  return (
    <Card className="min-h-48">
      <CardHeader>
        <CardTitle className="text-sm font-medium tracking-wide uppercase text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <div data-testid="skeleton" className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          children(data)
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npm test`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
git add web
git commit -m "feat(web): scaffold Next.js with shadcn and Vitest; API client and MeetingCard"
```

---

### Task 10: `useMeetingStatus` polling hook

**Files:**
- Create: `web/src/hooks/useMeetingStatus.ts`
- Test: `web/src/hooks/useMeetingStatus.test.tsx`

**Interfaces:**
- Consumes: `getMeetingStatus` (Task 9), `MeetingStatusDto` (Task 9)
- Produces: `useMeetingStatus(id: string | null, intervalMs = 1500): MeetingStatusDto | null`

- [ ] **Step 1: Write the failing test**

`web/src/hooks/useMeetingStatus.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — `Failed to resolve import "./useMeetingStatus"`

- [ ] **Step 3: Write the hook**

`web/src/hooks/useMeetingStatus.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test`
Expected: PASS (7 tests across 2 files)

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks
git commit -m "feat(web): useMeetingStatus polling hook that stops on done/failed"
```

---

### Task 11: Dashboard page + sample transcript + browser smoke test

**Files:**
- Create: `web/src/lib/sample-transcript.ts`
- Modify: `web/src/app/page.tsx` (replace scaffold content entirely)

**Interfaces:**
- Consumes: `submitMeeting` (Task 9), `useMeetingStatus` (Task 10), `MeetingCard` (Task 9), shadcn `Button`, `Textarea`, `Badge`
- Produces: the demo UI at `http://localhost:3000`

- [ ] **Step 1: Write the sample transcript**

`web/src/lib/sample-transcript.ts`:

```ts
export const SAMPLE_TRANSCRIPT = `[00:00] Aman: Thanks everyone. Goal today is to lock the plan for the meeting-intelligence prototype.
[00:12] Priya: The blocker last week was the single LLM call timing out on 60-minute transcripts.
[00:25] Aman: Right. Proposal: drop the transcript into a BullMQ queue and fan out three workers — summary, action items, embedding — so nothing blocks the request.
[00:48] Dev: Do we need Mongo for a prototype? A Map would do.
[00:55] Aman: Mongo is their stack, and Render restarts free dynos. Repository pattern, in-memory for tests, Mongo for deploy.
[01:10] Priya: I can review the retry and backoff settings once the worker is up.
[01:18] Dev: I'll take the Next.js dashboard — three cards, skeletons that snap to content as each field lands.
[01:30] Aman: I'll provision Upstash Redis and wire REDIS_URL, then record the Loom on Friday.
[01:42] Priya: One more: the action extractor must return strict JSON or the retry should kick in.
[01:50] Aman: Agreed. Ship by Friday. Thanks all.`;
```

- [ ] **Step 2: Write the page**

`web/src/app/page.tsx`:

```tsx
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
    <main className="mx-auto max-w-6xl space-y-6 p-8">
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
```

- [ ] **Step 3: Lint, build (type-checks), and run tests**

Run: `cd web && npm run lint && npm run build && npm test`
Expected: no lint errors, build succeeds with no type errors, 7 tests PASS

- [ ] **Step 4: Browser smoke test against the local API**

With `docker compose up -d` and `cd api && npm run start:dev` already running (Task 8):

```bash
cd web && cp .env.example .env.local && npm run dev
```

Open `http://localhost:3000`. Click **Load sample** → **Process Pipeline**.
Expected: three skeleton cards appear at once; badge reads `processing`; Summary snaps in at ~1.5 s, Action Items at ~3 s, Vector at ~4.5 s; badge flips to `done`; polling stops (check the Network tab — no further `GET` requests). Click **Process Pipeline** again → cards reset to skeletons and the sequence repeats with a new id.

- [ ] **Step 5: Commit**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
git add web/src/app/page.tsx web/src/lib/sample-transcript.ts
git commit -m "feat(web): dashboard with staggered card reveal"
```

---

### Task 12: README, deployment, Loom checklist

**Files:**
- Create: `README.md` (repo root), `.gitignore` (repo root)

**Interfaces:**
- Consumes: the working `api/` and `web/` from Tasks 1–11
- Produces: public repo with live API on Render and live UI on Vercel; a 90-second Loom link

- [ ] **Step 1: Write the README and root .gitignore**

`README.md`:

```markdown
# Parallelized Meeting Intelligence Pipeline

Drop a meeting transcript into a BullMQ queue; three workers independently produce a summary, action items, and a vector embedding; the UI polls and reveals each result as it lands.

**Live:** <vercel-url> · **API:** <render-url>/api/meetings · **Demo:** <loom-url>

## Why this shape

- `POST /api/meetings` returns `202 { id }` in milliseconds — no LLM call on the request path.
- One BullMQ queue, one worker with `concurrency: 3`, three jobs per meeting (`summarize`, `extract_actions`, `vectorize`). Job payload is just `{ meetingId }`; the worker reloads the transcript so a 60-minute transcript never sits in Redis three times.
- `jobId = ${meetingId}-${kind}` → re-submits dedupe for free.
- `status` is derived at read time from which fields are filled — no counter, no "all done" race.
- Patterns: Strategy (processors), Repository (InMemory for tests / Mongo for deploy), Adapter (`LlmClient` → `MockLlmClient`; a Gemini client is one file away), Nest DI multi-provider (add a fourth processor with one class + one provider line).

## Run locally

    docker compose up -d                  # Redis + Mongo
    cd api && cp .env.example .env && npm i && npm run start:dev
    cd web && cp .env.example .env.local && npm i && npm run dev   # http://localhost:3000

## Tests

    cd api && npm test && npm run test:e2e
    cd web && npm test

## Deliberate simplifications (grep `ponytail:`)

API and worker share one process · single queue · polling not SSE · mock LLM with staggered delays.
```

`.gitignore` (repo root):

```
node_modules/
.env
.env.local
dist/
.next/
```

- [ ] **Step 2: Verify the whole thing from a clean clone**

```bash
cd /Users/amanshukla/Personal/interview-projects/Fireflies
git add README.md .gitignore && git commit -m "docs: README with architecture and run instructions"
git clone . /tmp/pipeline-clone && cd /tmp/pipeline-clone/api && npm ci && npm test && cd ../web && npm ci && npm test
```

Expected: both suites PASS from the clone. Remove `/tmp/pipeline-clone` afterwards.

- [ ] **Step 3: Push to GitHub**

```bash
gh repo create meeting-intelligence-pipeline --public --source=. --push
```

- [ ] **Step 4: Provision Redis and Mongo**

- Redis: Upstash → create database (region nearest Render's), copy the `rediss://…` URL. *(Alternative that avoids Upstash's per-command quota with BullMQ's polling: Render → New → Key Value, free tier, internal URL.)*
- Mongo: MongoDB Atlas → free M0 cluster → Database Access user → Network Access `0.0.0.0/0` → copy the `mongodb+srv://…/meetings` connection string.

- [ ] **Step 5: Deploy the API to Render**

Render → New → Web Service → connect the repo:
- Root Directory: `api`
- Build Command: `npm ci && npm run build`
- Start Command: `npm run start:prod`
- Environment: `REDIS_URL`, `MONGO_URL`, `CORS_ORIGIN=https://<your-vercel-domain>` (set after Step 6; `*` is fine until then)

Verify: `curl -s -X POST https://<render-url>/api/meetings -H 'Content-Type: application/json' -d '{"transcript":"hello"}'` → `{"id":"…"}`, and `GET /api/meetings/<id>` reaches `done` within ~5 s. Render logs show the three `▶ … start` lines together.

- [ ] **Step 6: Deploy the UI to Vercel**

Vercel → Add New Project → import repo:
- Root Directory: `web`
- Environment Variable: `NEXT_PUBLIC_API_URL=https://<render-url>`

Verify: open the Vercel URL, Load sample → Process Pipeline → staggered reveal works. Then set `CORS_ORIGIN` on Render to the Vercel domain and redeploy.

- [ ] **Step 7: Fill in the README links and commit**

Replace `<vercel-url>`, `<render-url>` in `README.md`; commit `docs: live links`; push.

- [ ] **Step 8: Record the 90-second Loom**

Split screen: left = Vercel UI, right = Render log stream (or local `npm run start:dev` terminal). Script:
1. (0–15 s) "Most AI prototypes block on one giant LLM call. This one returns 202 immediately and fans out to three BullMQ workers."
2. (15–45 s) Click Load sample → Process Pipeline. Point at the three `▶ start` log lines firing together, then the cards snapping in: summary, actions, vector.
3. (45–75 s) Show `meetings.module.ts` for ten seconds: Strategy processors, Repository swap, `LlmClient` adapter — "a Gemini client is one file."
4. (75–90 s) "Job payload is just an id, jobIds dedupe re-submits, status is derived so there's no race. Repo and README linked below."

Add the Loom URL to the README (`<loom-url>`), commit `docs: demo link`, push. Then send the application email from the brief with the repo + Loom links.
