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

The API defaults to port 3001 and the web app to 3000, both overridable (`PORT` for the API, `next dev -p <port>` for the web app).

## Tests

Both `api` and `web` run their tests on Vitest.

    cd api && npm test && npm run test:e2e
    cd web && npm test

## Deliberate simplifications (grep `ponytail:`)

API and worker share one process · single queue · polling not SSE · mock LLM with staggered delays.
