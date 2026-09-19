// Integration smoke test with real Pi APIs and existing local weights. No downloads or benchmark scoring.
// Usage: node --experimental-strip-types smoke.mjs [profile-id ...]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig, request, requestPayload } from './core.mjs';

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
try {
  await session.bindExtensions({ mode: 'tui', onError: error => errors.push(error.error),
    uiContext: { notify: (message, level) => { console.log(level ?? 'info', message); if (level === 'error') errors.push(message); }, setStatus: () => {} } });
  const ids = process.argv.slice(2);
  for (const id of ids.length ? ids : ['qwen3.5-4b']) {
    const runner = session.extensionRunner;
    await runner.getCommand('local').handler(id, runner.createCommandContext());
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
    if (id === 'qwen3.5-4b') {
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
