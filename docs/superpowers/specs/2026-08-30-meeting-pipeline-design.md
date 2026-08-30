# Parallelized Meeting Intelligence Pipeline — Design

**Date:** 2026-08-30
**Status:** Approved (brainstorm)
**Goal:** Prove asynchronous, parallel AI processing of a meeting transcript: one POST drops a transcript into a BullMQ queue; three workers independently produce a summary, action items, and a vector embedding; a Next.js UI polls and reveals each result as it lands.

Non-goals: auth, users, billing, SSE/WebSockets, dead-letter queues, prompt quality.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Backend | NestJS 12 (ESM/nodenext) + `@nestjs/bullmq` | DI, modules, and a BullMQ wrapper out of the box |
| Queue | BullMQ on Redis, one queue `meetings` | Matches the brief; per-queue tuning not needed yet |
| Storage | `MeetingRepository` → InMemory (tests/local) + Mongo (deploy) | Two real implementations; Mongo is Fireflies' stack |
| LLM | `LlmClient` → `MockLlmClient` only | No API key. Mock has per-kind delays so cards land staggered |
| Frontend | Next.js (App Router) + Tailwind + shadcn/ui, dark mode | Brief |
| Transport | Polling `GET /api/meetings/:id` every 1.5 s | Brief; simplest |
| Layout | Two plain folders `api/`, `web/`; DTO type duplicated | No workspace tooling |
| Tests | Vitest in both `api/` (Nest 12 scaffolds it) and `web/` | Already-installed / lightest |
| Deploy | Render (api + worker, one process), Upstash Redis, Mongo Atlas, Vercel (web) | Workers cannot run on serverless |

## Architecture

```
 web (Next.js, Vercel)                       api (NestJS, Render — API + worker in ONE process)
 ┌─────────────────────┐   POST /api/meetings    ┌──────────────┐  create   ┌───────┐
 │ textarea + Process  │ ───────────────────────▶│ Controller   │──────────▶│ Mongo │
 │                     │ ◀── 202 { id } ─────────│  → Service   │──add×3──┐ └───────┘
 │ 3 cards (skeleton → │                         └──────────────┘         ▼      ▲
 │  content as each    │   GET /api/meetings/:id ┌──────────────┐    ┌─────────┐ │ patch(field)
 │  field arrives)     │ ◀─ poll 1.5s ──────────▶│ Controller   │    │  Redis  │ │
 └─────────────────────┘                         └──────────────┘    │ BullMQ  │ │
                                                                     │"meetings"│ │
                                            ┌────────────────────────┴─────────┴─┘
                                            ▼  MeetingWorker (concurrency 3)
                                   job.name ──▶ Strategy lookup ──▶ Processor.process(transcript)
                                                                          │
                                                                    LlmClient (Mock now, Gemini later)
```

### Data flow

1. `POST /api/meetings { transcript }` → validate → `repo.create({ transcript })` → `queue.add(kind, { meetingId }, { jobId: \`${id}-${kind}\`, attempts: 3, backoff: exponential 500ms })` for each of the three kinds → `202 { id }`.
2. `MeetingWorker` (BullMQ worker, `concurrency: 3`) receives a job, looks up the processor by `job.name`, loads the transcript from the repo, runs `processor.process(transcript)`, and `repo.patch(id, patch)`.
3. `GET /api/meetings/:id` → `repo.findById` → map to DTO with `status` derived from the fields.

### Tradeoffs baked in

- **Job payload is `{ meetingId }` only.** The worker reloads the transcript from the repo, keeping a 60-minute transcript out of Redis three times over.
- **`jobId = ${meetingId}-${kind}`** — BullMQ dedupes by jobId, so a re-submitted meeting cannot enqueue twice.
- **`status` is derived at read time** (`failed` if any `errors[kind]`, `done` if `summary`, `actions`, `vector` all non-null, else `processing`). No "all workers done?" race and no counter to keep in sync.
- **API and worker share one Nest process.** One Render service. `// ponytail: split into a worker entrypoint when API and worker need independent scaling`.

## Domain model

```ts
type JobKind = 'summarize' | 'extract_actions' | 'vectorize';
const JOB_KINDS: readonly JobKind[] = ['summarize', 'extract_actions', 'vectorize'];

interface ActionItem { task: string; assignee: string }

interface Meeting {
  id: string;                // uuid
  transcript: string;
  summary: string[] | null;
  actions: ActionItem[] | null;
  vector: number[] | null;   // 768 floats (mock)
  errors: Partial<Record<JobKind, string>>;
  createdAt: Date;
}

type MeetingPatch = Partial<Pick<Meeting, 'summary' | 'actions' | 'vector'>>;
type MeetingStatus = 'processing' | 'done' | 'failed';

function deriveStatus(m: Meeting): MeetingStatus;
```

## API contract

```
POST /api/meetings
  body   { transcript: string }      — IsString, Length(1, 200_000)
  202    → { id: string }
  400    → validation error (class-validator, global ValidationPipe with whitelist)

GET /api/meetings/:id
  200 → {
    id: string,
    status: 'processing' | 'done' | 'failed',
    summary: string[] | null,
    actions: { task: string; assignee: string }[] | null,
    vector: { dims: number; preview: number[] } | null,   // preview = first 8 floats
    errors: Partial<Record<JobKind, string>>,
    createdAt: string                                       // ISO
  }
  404 → not found
```

The `web/` folder holds a hand-copied `MeetingStatusDto` type mirroring the GET response.

## OOP patterns

| Pattern | Classes | Justification |
|---|---|---|
| **Strategy** | `interface TranscriptProcessor { readonly kind: JobKind; process(transcript: string): Promise<MeetingPatch> }` → `SummarizeProcessor`, `ActionExtractorProcessor`, `VectorizeProcessor` | Three concrete strategies; worker selects by `job.name` |
| **Repository** | `abstract class MeetingRepository { create(input: { transcript: string }): Promise<Meeting>; findById(id): Promise<Meeting \| null>; patch(id, patch: MeetingPatch & { errors?: Partial<Record<JobKind, string>> }): Promise<void> }` → `InMemoryMeetingRepository`, `MongoMeetingRepository` | Tests run on memory; deploy runs on Mongo. Abstract class doubles as the Nest DI token |
| **Adapter** | `abstract class LlmClient { complete(prompt: string): Promise<string>; embed(text: string): Promise<number[]> }` → `MockLlmClient` | Swapping to Gemini is one new file + one provider line. The mock's per-method delay (`summarize` ~1.5 s, `extract_actions` ~3 s, `embed` ~4.5 s) is the demo's staggered-reveal control |
| **DI multi-provider** | `PROCESSORS` injection token; `MeetingWorker` builds `Map<JobKind, TranscriptProcessor>` from the injected array in its constructor | Adding a fourth processor = one class + one provider entry, no worker edit |
| **Facade** | `MeetingsService.submit(transcript): Promise<{ id }>` / `status(id): Promise<MeetingStatusDto \| null>` | Controller is two thin handlers |

Deliberately not used: Factory (DI constructs), Observer (polling, not SSE), Command (jobs are plain data), Singleton (Nest providers already are).

## Processors (behaviour)

- **SummarizeProcessor** — `llm.complete(prompt)`; split response on newlines, strip leading `-`/`•`/digits, keep non-empty, take first 3 → `{ summary }`. Throws if zero bullets.
- **ActionExtractorProcessor** — `llm.complete(prompt)`; `JSON.parse`; must be an array of `{ task: string, assignee: string }` (checked with a small type guard) → `{ actions }`. Throws on invalid JSON or shape.
- **VectorizeProcessor** — `llm.embed(transcript)` → `{ vector }`. Throws if empty array.

`MockLlmClient.complete` inspects the prompt: contains `"JSON"` → returns a canned action-item array; otherwise returns three canned bullets. `embed` returns 768 deterministic floats seeded from text length. Delays are constructor-injected (`{ complete: (prompt) => ms, embed: ms }`) so tests pass `0`.

## Error handling

- Processor throws → BullMQ retries (`attempts: 3`, exponential backoff from 500 ms).
- After the final attempt, `MeetingWorker`'s `@OnWorkerEvent('failed')` handler runs `repo.patch(id, { errors: { [job.name]: err.message } })`. The other two fields are unaffected; the UI shows that card in an error state.
- Unknown `job.name` → throw immediately (no retry benefit; surfaces mis-wiring in tests).
- `GET` for an unknown id → `NotFoundException` → 404.
- Redis/Mongo connection failures surface as Nest bootstrap errors; no custom handling.

## File layout

```
api/
  src/
    main.ts                                  (global ValidationPipe, CORS, prefix /api)
    app.module.ts                            (ConfigModule, BullModule.forRoot(REDIS_URL), MongooseModule.forRoot(MONGO_URL), MeetingsModule)
    llm/
      llm.module.ts                          (provides LlmClient → MockLlmClient)
      llm.client.ts                          (abstract LlmClient)
      mock-llm.client.ts
    meetings/
      meetings.module.ts                     (BullModule.registerQueue('meetings'), PROCESSORS, MeetingRepository → Mongo)
      meetings.controller.ts
      meetings.service.ts
      meeting.entity.ts                      (Meeting, MeetingPatch, JobKind, JOB_KINDS, deriveStatus)
      dto/create-meeting.dto.ts
      dto/meeting-status.dto.ts              (toStatusDto(meeting))
      repository/meeting.repository.ts       (abstract)
      repository/in-memory-meeting.repository.ts
      repository/mongo-meeting.repository.ts (+ mongoose schema)
      processors/transcript.processor.ts     (interface + PROCESSORS token)
      processors/summarize.processor.ts
      processors/action-extractor.processor.ts
      processors/vectorize.processor.ts
      queue/meeting.worker.ts                (@Processor('meetings', { concurrency: 3 }) extends WorkerHost)
  test/meetings.e2e-spec.ts
  .env.example                               (PORT, REDIS_URL, MONGO_URL)

web/
  src/
    app/layout.tsx                           (html className="dark")
    app/page.tsx                             (textarea, "Load sample", "Process Pipeline", 3 cards)
    lib/api.ts                               (submitMeeting, getMeetingStatus; NEXT_PUBLIC_API_URL)
    lib/types.ts                             (MeetingStatusDto copy)
    lib/sample-transcript.ts
    hooks/useMeetingStatus.ts                (useEffect + setTimeout chain every 1500 ms; stops on done/failed/unmount)
    components/MeetingCard.tsx               (data null → Skeleton; error → red text; else render(data))
  .env.example                               (NEXT_PUBLIC_API_URL)
```

## Frontend behaviour

- Page state: `meetingId: string | null`, `transcript: string`.
- Submit → `POST` → set `meetingId` → hook starts polling.
- Three `MeetingCard`s: **Summary** (bullets), **Action Items** (task / assignee table), **Vector** (`dims` + first 8 floats, monospace). Each renders a pulsing skeleton until its field is non-null; the card whose `errors[kind]` is set shows the error.
- Header pill shows `status`. Polling stops on `done` or `failed`.
- Re-submitting resets `meetingId` and all three cards to skeletons.

## Testing (TDD order)

| # | File | Red test | Pins down |
|---|---|---|---|
| 1 | `meeting.entity.spec.ts` | `deriveStatus` table: all null → processing; all set → done; any error → failed (even if others set) | status rules |
| 2 | `in-memory-meeting.repository.spec.ts` | create returns id + nulls; findById unknown → null; patch merges field; patch merges `errors` | Repository contract |
| 3 | `summarize.processor.spec.ts` etc. | with `FakeLlmClient` returning canned strings: 3 bullets parsed; invalid JSON throws; vector length 768 | each Strategy |
| 4 | `meetings.service.spec.ts` | `submit` with a `FakeQueue` recording `add` calls: record created, 3 adds with names = JOB_KINDS, jobId `${id}-${kind}`, data `{ meetingId }`; `status(unknown)` → null | Facade + enqueue contract |
| 5 | `meeting.worker.spec.ts` | `process({ name: 'summarize', data })` → repo patched with summary; unknown name → throws; `onFailed` → `errors[kind]` set | dispatch |
| 6 | `test/meetings.e2e-spec.ts` | Nest testing module with `InMemoryMeetingRepository` + `FakeQueue` overriding `getQueueToken('meetings')`: POST → 202 `{id}`; POST empty → 400; GET unknown → 404; GET after manual `repo.patch` → fields + status | HTTP surface |
| 7 | `useMeetingStatus.test.tsx` | fake timers + mocked `fetch`: fetches at t=0 and every 1500 ms; stops after `done` | polling logic |
| 8 | `MeetingCard.test.tsx` | `data=null` → skeleton role; data → rendered; error → error text | card states |

Skipped: `MongoMeetingRepository` test (would need `mongodb-memory-server`; InMemory covers the contract — add a `describe.each([InMemory, Mongo])` contract suite if CI should verify both). Frontend page-level test (two component tests cover the logic).

## Epic mapping

| Epic | Delivered by |
|---|---|
| 1 Asynchronous queue | tests 1, 2, 4, 6; `MeetingsModule`, `MeetingsService`, `MeetingsController`, repositories, `BullModule` wiring |
| 2 Parallel AI pipeline | tests 3, 5; `LlmModule`, `MockLlmClient`, three processors, `MeetingWorker` |
| 3 Streaming UI | tests 7, 8; Next.js app, hook, cards |
| 4 Deployment & pitch | Render (`api`, env: `REDIS_URL`, `MONGO_URL`), Upstash, Atlas, Vercel (`web`, env: `NEXT_PUBLIC_API_URL`); Loom |

## Ceilings (each marked with a `ponytail:` comment in code)

- Single process for API + worker → split entrypoints when scaling independently.
- Single queue → per-kind queues when one processor needs different concurrency/retry policy.
- Polling → SSE when poll traffic matters.
- Mock LLM → `GeminiLlmClient` implementing `LlmClient` when a key exists.
