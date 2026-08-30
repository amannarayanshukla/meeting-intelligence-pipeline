#!/usr/bin/env node
// Load test: N concurrent submits, then poll every second until every meeting settles.
// Reports POST latency (the request path must stay flat), drain time / jobs per second
// (bounded by WORKER_CONCURRENCY), and the status-GET rate the polling UI would generate.
//   node scripts/load.mjs --n 100 --api http://localhost:3001
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : process.argv[i + 1]; };
const N = Number(arg('n', 100));
const API = arg('api', 'http://localhost:3001');
const POLL_MS = Number(arg('poll', 1000));
const transcript = '[00:00] Aman: ship the pipeline by Friday. [00:10] Priya: I will review the retries. '.repeat(40); // ~3.5 KB

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const post = async () => {
  const t = performance.now();
  const r = await fetch(`${API}/api/meetings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript }) });
  if (r.status !== 202) throw new Error(`POST returned ${r.status}`);
  return { id: (await r.json()).id, ms: performance.now() - t };
};

const t0 = performance.now();
const submitted = await Promise.all(Array.from({ length: N }, post));
const submitWall = performance.now() - t0;
const lat = submitted.map((s) => s.ms);
console.log(`submit  ${N} concurrent POSTs in ${submitWall.toFixed(0)} ms — p50 ${pct(lat, 50).toFixed(1)} ms · p95 ${pct(lat, 95).toFixed(1)} ms · max ${pct(lat, 100).toFixed(1)} ms`);

const pending = new Set(submitted.map((s) => s.id));
let gets = 0, failed = 0;
const t1 = performance.now();
while (pending.size) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  const rows = await Promise.all([...pending].map(async (id) => { gets++; const r = await fetch(`${API}/api/meetings/${id}`); return [id, (await r.json()).status]; }));
  for (const [id, status] of rows) if (status !== 'processing') { pending.delete(id); if (status === 'failed') failed++; }
  process.stdout.write(`\r  draining… ${N - pending.size}/${N} done, ${((performance.now() - t1) / 1000).toFixed(0)} s`);
}
const drain = (performance.now() - t1) / 1000;
console.log(`\ndrain   ${N * 3} jobs in ${drain.toFixed(1)} s → ${((N * 3) / drain).toFixed(2)} jobs/s · ${gets} status GETs (${(gets / drain).toFixed(1)}/s) · failed ${failed}`);
