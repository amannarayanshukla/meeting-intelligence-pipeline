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
