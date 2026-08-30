# Playbook — set up, run, demo

## 0. Prerequisites
- Docker Desktop (Compose v2). That's all for the one-command path.
- For host-side dev: Node 22+, and Docker for Redis + Mongo.

## 1. One command (interviewer path)
    git clone https://github.com/amannarayanshukla/meeting-intelligence-pipeline && cd meeting-intelligence-pipeline && ./demo.sh

`demo.sh` builds four images (web, api, redis, mongo), picks free host ports if 3000/3001/6379/27017 are taken, waits until the API and UI answer, opens the UI, and prints the log-tail command. First build ≈ 2–3 min (npm installs); later runs ≈ 10 s.
Stop: `docker compose down`.

## 2. Host-side dev (hot reload)
    docker compose up -d redis mongo
    cd api && cp .env.example .env && npm i && npm run start:dev      # http://localhost:3001
    cd web && cp .env.example .env.local && npm i && npm run dev       # http://localhost:3000
Ports busy? `PORT=3002 npm run start:dev` for the API and `npm run dev -- -p 3005` for the web app, with `NEXT_PUBLIC_API_URL=http://localhost:3002` in `web/.env.local` and `CORS_ORIGIN=http://localhost:3005` in `api/.env`.

## 3. Tests
    cd api && npm test && npm run test:e2e     # 35 unit + 5 HTTP e2e (in-memory repo, fake queue)
    cd web && npm test                          # 7 (RTL + fake timers)
No Redis/Mongo needed for tests. The Mongo repository is verified live (see the spec), not unit-tested — deliberate.

## 4. Deploy
See README §Deploy: one-click Render (API + Redis via `render.yaml`) and Vercel (UI). You supply a MongoDB Atlas URL. Then set `CORS_ORIGIN` on Render to the Vercel domain.

## 5. 90-second demo script (split screen)
Left: the UI. Right: `docker compose logs -f api | grep -E '▶|✔'` (or the Render log stream).
1. 0–15 s — "Most AI prototypes block on one giant LLM call. This returns 202 in milliseconds and fans out to three BullMQ workers."
2. 15–45 s — Load sample → Process Pipeline. Point at the three `▶ start` lines in the same second, then the cards landing: summary 1.5 s, actions 3 s, vector 4.5 s. "Wall clock is max, not sum."
3. 45–75 s — Open `api/src/meetings/meetings.module.ts`: Strategy processors, Repository swap (InMemory ↔ Mongo), `LlmClient` adapter — "a Gemini client is one file."
4. 75–90 s — "Job payload is just an id; per-field `$set` means three writers never clobber each other; status is derived so there's no counter and no race."

## 6. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `demo.sh` says a port is in use | It auto-picks the next free port; read the printed URLs. |
| UI loads but "Submit failed: …" | The web image bakes `NEXT_PUBLIC_API_URL` at build time. If you changed `API_PORT`, rebuild: `docker compose up --build -d web`. On Vercel, set the env var and redeploy. |
| Cards never fill; API logs show Redis errors | BullMQ needs Redis with `maxmemory-policy noeviction` (compose sets it; on Upstash/Render it's the default). |
| First Render build fails with `nest: not found` | `NODE_ENV=production` makes `npm ci` skip devDeps — build command must be `npm ci --include=dev && npm run build` (already in `render.yaml`). |
| `errors` missing on Mongo documents | Mongoose `minimize` strips `{}` — the schema sets `minimize: false`. |
| Same summary for every transcript | Expected: the LLM is a mock (badge on the page). See §7. |

## 7. Swap in a real LLM
1. `api/src/llm/gemini-llm.client.ts`: `export class GeminiLlmClient extends LlmClient` implementing `complete(prompt)` (text) and `embed(text)` (`text-embedding-004`).
2. `api/src/llm/llm.module.ts`: `{ provide: LlmClient, useFactory: () => process.env.GEMINI_API_KEY ? new GeminiLlmClient(process.env.GEMINI_API_KEY) : new MockLlmClient() }`.
3. Remove the mock badge in `web/src/app/page.tsx`. Nothing else changes — processors and the worker only know `LlmClient`.

## 8. Load test
    WORKER_CONCURRENCY=30 docker compose up --build -d api      # or leave the default 3
    node scripts/load.mjs --n 100 --api http://localhost:<API_PORT>
Prints POST p50/p95, drain time, jobs/s and the status-GET rate. Results and what they mean: README §"What breaks first". Local only — don't point it at a free-tier hosted Redis.
