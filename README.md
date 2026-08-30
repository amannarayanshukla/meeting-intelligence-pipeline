# Parallelized Meeting Intelligence Pipeline

Drop a meeting transcript into a BullMQ queue; three workers independently produce a summary, action items, and a vector embedding; the UI polls and reveals each result as it lands.

## Links (fill after deploy)

- Live UI: <vercel-url>
- API: <render-url>/api/meetings
- 90-second demo: <loom-url>

## Why this shape

- `POST /api/meetings` returns `202 { id }` in milliseconds — no LLM call on the request path.
- One BullMQ queue, one worker with `concurrency: 3`, three jobs per meeting (`summarize`, `extract_actions`, `vectorize`). Job payload is just `{ meetingId }`; the worker reloads the transcript so a 60-minute transcript never sits in Redis three times.
- `jobId = ${meetingId}-${kind}` — a retried enqueue for the same meeting can't double-process (each submit is a new meeting id, so re-submitting a transcript intentionally reprocesses it).
- `status` is derived at read time: `processing` until every kind has settled (field filled or `errors[kind]` set); then `failed` if any error, else `done`. No counter, no "all done" race.
- Each worker writes only its own field with a per-field `$set` (`errors.<kind>` as a dotted path), so three concurrent writers never clobber each other — no transaction, no counter.
- Patterns: Strategy (processors), Repository (InMemory for tests / Mongo for deploy), Adapter (`LlmClient` → `MockLlmClient`; a Gemini client is one file away), Nest DI multi-provider (add a fourth processor with one class + one provider line).

## Run locally

Three separate terminals, all from the repo root:

    docker compose up -d                              # Redis + Mongo

In a second terminal:

    cd api && cp .env.example .env && npm i && npm run start:dev

In a third terminal:

    cd web && cp .env.example .env.local && npm i && npm run dev   # http://localhost:3000

The API defaults to port 3001 and the web app to 3000, both overridable (`PORT` for the API, `next dev -p <port>` for the web app).

## Tests

Both `api` and `web` run their tests on Vitest.

    cd api && npm test && npm run test:e2e
    cd web && npm test

## Proof it's parallel

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

A real run against a live worker, three jobs enqueued for one meeting:

```
[Nest] 79716  - 30/08/2026, 9:11:54 am     LOG [MeetingWorker] ▶ summarize       start  meeting=9ef39835-be40-4704-bf89-11c80111343a
[Nest] 79716  - 30/08/2026, 9:11:54 am     LOG [MeetingWorker] ▶ extract_actions start  meeting=9ef39835-be40-4704-bf89-11c80111343a
[Nest] 79716  - 30/08/2026, 9:11:54 am     LOG [MeetingWorker] ▶ vectorize       start  meeting=9ef39835-be40-4704-bf89-11c80111343a
[Nest] 79716  - 30/08/2026, 9:11:56 am     LOG [MeetingWorker] ✔ summarize       done   meeting=9ef39835-be40-4704-bf89-11c80111343a
[Nest] 79716  - 30/08/2026, 9:11:57 am     LOG [MeetingWorker] ✔ extract_actions done   meeting=9ef39835-be40-4704-bf89-11c80111343a
[Nest] 79716  - 30/08/2026, 9:11:59 am     LOG [MeetingWorker] ✔ vectorize       done   meeting=9ef39835-be40-4704-bf89-11c80111343a
```

Wall clock is max(1.5, 3, 4.5) s, not the 9 s sum.

## Deploy

**Render (`api`)**

- Root directory: `api`
- Build command: `npm ci --include=dev && npm run build` (Render sets `NODE_ENV=production`, which makes plain `npm ci` skip the devDependencies that `nest build` needs)
- Start command: `npm run start:prod`
- Env: `REDIS_URL`, `MONGO_URL`, `CORS_ORIGIN`

**Vercel (`web`)**

- Root directory: `web`
- Env: `NEXT_PUBLIC_API_URL`

**Redis:** Upstash or Render Key Value.
**Mongo:** Atlas M0.

## Design

See [`docs/superpowers/specs/2026-08-30-meeting-pipeline-design.md`](docs/superpowers/specs/2026-08-30-meeting-pipeline-design.md) for the decisions table, tradeoffs, and the ceilings each `// ponytail:` comment names.

## Deliberate simplifications (grep `ponytail:`)

API and worker share one process · single queue · polling not SSE · mock LLM with staggered delays.
