/**
 * Minimal env so `src/config.ts` parses at import time. Any test that
 * transitively pulls in `src/slack.ts` will otherwise fail at the zod schema.
 *
 * We use `??=` so a real env (e.g. CI) wins over these defaults.
 */
process.env.PORT ??= "3000";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgres://test@localhost:5432/test";
process.env.SLACK_SIGNING_SECRET ??= "test";
process.env.SLACK_CLIENT_ID ??= "test";
process.env.SLACK_CLIENT_SECRET ??= "test";
process.env.SLACK_STATE_SECRET ??= "test-state-secret-long-enough-32-chars";
process.env.NODE_ENV ??= "test";
