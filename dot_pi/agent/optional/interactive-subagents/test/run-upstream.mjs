import { jiti } from './local-loader.mjs';
// Upstream's unit tests use disposable synthetic sessions, not real accounts or panes.
process.env.PI_SUBAGENT_HERDR_TRIAL = '0';
delete process.env.PI_SUBAGENT_ALLOWED;
await jiti.import(new URL('./test.ts', import.meta.url).pathname);
