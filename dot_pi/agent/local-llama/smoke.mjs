// Integration smoke test with real Pi APIs and existing local weights. No downloads or benchmark scoring.
// Usage: node --experimental-strip-types smoke.mjs [profile-id ...]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canCoexist, catalog, readConfig, request, requestPayload } from './core.mjs';

let root = dirname(realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()));
while (root !== dirname(root)) {
  try { if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === '@earendil-works/pi-coding-agent') break; } catch {}
  root = dirname(root);
}
const load = (path) => import(pathToFileURL(join(root, path)).href);
const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await load('dist/index.js');
const { default: nativeLlama } = await load('dist/extensions/llama/index.js');
const scratch = mkdtempSync(join(tmpdir(), 'pi-local-smoke-'));
const settingsManager = SettingsManager.inMemory({});
const loader = new DefaultResourceLoader({ cwd: scratch, agentDir: scratch, settingsManager,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  additionalExtensionPaths: [fileURLToPath(new URL('../extensions/local-llama.ts', import.meta.url))],
  extensionFactories: [nativeLlama], systemPrompt: 'Follow the user request precisely.' });
await loader.reload();
const { session, extensionsResult } = await createAgentSession({ cwd: scratch, agentDir: scratch, resourceLoader: loader,
  settingsManager, sessionManager: SessionManager.inMemory(), noTools: 'all' });
assert.equal(extensionsResult.errors.length, 0, JSON.stringify(extensionsResult.errors));
const errors = [];
let selectedId;
try {
  await session.bindExtensions({ mode: 'tui', onError: error => errors.push(error.error),
    uiContext: { select: async (_title, choices) => choices.find(choice => choice.endsWith(`[${selectedId}]`)), notify: (message, level) => { console.log(level ?? 'info', message); if (level === 'error') errors.push(message); }, setStatus: () => {} } });
  const ids = process.argv.slice(2);
  for (const id of ids.length ? ids : ['qwen3.5-4b']) {
    const runner = session.extensionRunner;
    selectedId = id;
    await runner.getCommand('local').handler('', runner.createCommandContext());
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(session.model?.id, id);
    console.log('Selected through /local:', id, session.model.contextWindow, session.thinkingLevel);
    session.setThinkingLevel('off');
    await session.prompt('Reply with exactly OK.');
    const answer = session.messages.filter(m => m.role === 'assistant').at(-1);
    assert.equal(answer?.stopReason, 'stop', JSON.stringify(answer));
    assert.match(answer.content.filter(b => b.type === 'text').map(b => b.text).join(''), /OK/);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Pi streaming completion passed:', id);
    const c = readConfig(); const p = c.profiles.find(p => p.id === id);
    {
      const tool = { type: 'function', function: { name: 'get_test_value', description: 'Return the test value.', parameters: { type: 'object', properties: {}, additionalProperties: false } } };
      const messages = [{ role: 'user', content: 'Call get_test_value now. After receiving its result, reply with that value only.' }];
      const first = await request(c, '/v1/chat/completions', { method: 'POST', timeoutMs: 60000,
        body: JSON.stringify(requestPayload(c, p, { model: id, messages, tools: [tool], tool_choice: 'required', max_tokens: 256 }, 'off')) });
      const assistant = first.choices[0].message;
      assert.equal(assistant.tool_calls?.[0]?.function.name, 'get_test_value');
      messages.push(assistant, { role: 'tool', tool_call_id: assistant.tool_calls[0].id, content: 'LOCAL_TOOL_OK' });
      const second = await request(c, '/v1/chat/completions', { method: 'POST', timeoutMs: 60000,
        body: JSON.stringify(requestPayload(c, p, { model: id, messages, tools: [tool], max_tokens: 128 }, 'off')) });
      assert.match(second.choices[0].message.content, /LOCAL_TOOL_OK/);
      console.log('Tool round trip passed');
    }
    const active = (await catalog(c)).filter(m => m.status.value === 'loaded');
    if (active.length === 2) {
      const residents = active.map(m => c.profiles.find(p => p.id === m.id));
      assert(canCoexist(c, ...residents));
      await Promise.all(residents.map(async resident => {
        const result = await request(c, '/v1/chat/completions', { method: 'POST', timeoutMs: 60000,
          body: JSON.stringify(requestPayload(c, resident, { model: resident.id,
            messages: [{ role: 'user', content: 'Reply with exactly CONCURRENT_OK.' }], max_tokens: 32 }, 'off')) });
        assert.match(result.choices[0].message.content, /CONCURRENT_OK/);
      }));
      console.log('Concurrent completions passed:', residents.map(p => p.id).join(', '));
    }
    if (process.env.PI_LOCAL_SMOKE_LONG === '1' && !p.vision) {
      const content = 'Remember the verification key LOCAL_CONTEXT_7319.\n'
        + Array.from({ length: 1024 }, (_, i) => `Record ${i}: routine inventory entry, nothing to change.\n`).join('')
        + '\nWhat verification key appeared at the beginning? Reply with only the key.';
      const result = await request(c, '/v1/chat/completions', { method: 'POST', timeoutMs: 180000,
        body: JSON.stringify(requestPayload(c, p, { model: id, messages: [{ role: 'user', content }], max_tokens: 64 }, 'off')) });
      assert.match(result.choices[0].message.content, /LOCAL_CONTEXT_7319/);
      console.log('Long prompt retrieval passed:', id, JSON.stringify({ usage: result.usage, timings: result.timings }));
    }
    if (p.vision) {
      // A synthetic 128x128 red PNG; no external images.
      const image = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABWklEQVR4nO3OQQ0AMBAEofVv+iqDxzRBALvtg/wgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwg7gEgaMOyrMtNTwAAAABJRU5ErkJggg==';
      const result = await request(c, '/v1/chat/completions', { method: 'POST', timeoutMs: 60000,
        body: JSON.stringify(requestPayload(c, p, { model: id, messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
          { type: 'text', text: 'What color fills this image? Reply with one color word.' },
        ] }], max_tokens: 32 }, 'off')) });
      assert.match(result.choices[0].message.content, /red/i);
      console.log('Vision input passed:', id);
    }
    if (c.policies[c.models[p.model].policy].thinking === 'toggle') {
      const rendered = [];
      for (const level of ['off', 'low']) {
        const payload = requestPayload(c, p, { model: id, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 2048 }, level);
        const result = await request(c, '/apply-template?model=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(payload) });
        assert.equal(typeof result.prompt, 'string');
        rendered.push(result.prompt);
      }
      assert.notEqual(rendered[0], rendered[1]);
      console.log('Thinking toggle template passed:', id);
    }
    if (c.policies[c.models[p.model].policy].thinking === 'effort') {
      for (const level of ['low', 'medium', 'xhigh']) {
        session.setThinkingLevel(level);
        const payload = await runner.emitBeforeProviderRequest({ model: id, messages: [
          { role: 'user', content: 'Remember the previous step.' },
          { role: 'assistant', content: 'Understood.', reasoning_content: 'LOCAL_REASONING_SENTINEL' },
          { role: 'user', content: 'Reply OK.' },
        ], max_tokens: 2048 });
        assert.equal(payload.reasoning_effort, level);
        // Render-only endpoint proves the server accepts the exact template controls without long generation.
        const result = await request(c, '/apply-template?model=' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(payload) });
        assert.equal(typeof result.prompt, 'string');
        assert(result.prompt.includes('LOCAL_REASONING_SENTINEL'));
        if (level !== 'medium') assert(result.prompt.includes(`Reasoning effort is set to ${level}.`));
        else assert(!result.prompt.includes('Reasoning effort is set to'));
        console.log('Thinking template accepted:', level);
      }
    }
  }
} finally { session.dispose(); }
console.log('Integration smoke passed. Scratch metadata:', scratch);
