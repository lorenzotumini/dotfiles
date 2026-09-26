import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, validateConfig, renderIni, profileOptions, profileTag, assertProfile, decorateModel, requestPayload, verifyLoaded, canCoexist } from '../local-llama/core.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverArgs, acquireModelOperation } from '../local-llama/router.mjs';
import localLlama from '../extensions/local-llama.ts';

const config = readConfig();
const profile = config.profiles.find(p => p.id === 'qwen3.8-27b-gsq');
const expectedArgs = Object.entries(profileOptions(config, profile)).flatMap(([k,v]) => typeof v === 'boolean' ? [v ? `--${k}` : `--no-${k}`] : [`--${k}`,String(v)]);

test('configuration rejects ambiguity, injected INI, unknown policy, and unverified MTP', () => {
  for (const change of [
    c => c.profiles.push(c.profiles[0]),
    c => c.profiles[0].runtime['ctx-size'] = 1,
    c => c.profiles[0].runtime.c = 1,
    c => c.profiles[0].runtime.device = 'CUDA0\nmodel = /wrong',
    c => c.models['qwen35-4b'].policy = 'unknown',
    c => c.profiles[0].runtime['spec-type'] = 'draft-mtp',
    c => c.profiles[0].maxOutput = c.profiles[0].context,
    c => c.policies.qwen38.levels.high = 'high',
    c => c.policies.qwen38.sampling.on.repetition_penalty = 1,
  ]) {
    const c = structuredClone(config); change(c); assert.throws(() => validateConfig(c));
  }
});

test('model runtime settings stay out of router CLI and each profile has an independent context', () => {
  const args = serverArgs(config);
  for (const forbidden of ['--ctx-size', '--device', '--tensor-split', '--cache-type-k', '--n-gpu-layers']) assert(!args.includes(forbidden));
  const ini = renderIni(config);
  for (const p of config.profiles) {
    const section = ini.split(`[${p.id}]\n`)[1].split('\n\n')[0];
    assert(section.includes(`ctx-size = ${p.context}`));
    assert(section.includes(profileTag(config, p)));
    assert.equal(section.includes('mmproj = '), p.vision);
  }
});

test('runtime fingerprint changes with configuration but not sampling preferences', () => {
  const c = structuredClone(config);
  c.policies.qwen38.sampling.on.temperature = 0.9;
  assert.equal(profileTag(config, profile), profileTag(c, profile));
  const changed = { ...profile, context: 32768 };
  assert.notEqual(profileTag(config, profile), profileTag(config, changed));
  assert.throws(() => assertProfile(config, profile, { status: { args: [] }, tags: ['wrong'] }), /differ.*Run \/local:reload, then select qwen3\.8-27b-gsq in \/local/);
  assertProfile(config, profile, { status: { args: expectedArgs }, tags: [profileTag(config, profile)] });
  const overridden = [...expectedArgs]; overridden[overridden.indexOf('--device') + 1] = 'CPU';
  assert.throws(() => assertProfile(config, profile, { status: { args: overridden }, tags: [profileTag(config, profile)] }), /option device differs/);
});

test('effort, hard thinking cap, and output cap are independent; answer room is reserved', () => {
  const original = { messages: [], max_completion_tokens: 4096, repetition_penalty: 9, chat_template_kwargs: { custom: true } };
  const on = requestPayload(config, profile, original, 'xhigh');
  assert.equal(on.reasoning_effort, 'xhigh');
  assert.equal(on.thinking_budget_tokens, 3072);
  assert.equal(on.max_tokens, 4096);
  assert.equal(on.repeat_penalty, 1);
  assert.equal(on.repetition_penalty, undefined);
  assert.equal(on.chat_template_kwargs.custom, true);
  const off = requestPayload(config, profile, on, 'off');
  assert.equal(off.thinking_budget_tokens, undefined);
  assert.equal(off.reasoning_effort, 'none');
  assert.equal(off.chat_template_kwargs.enable_thinking, false);
  assert.equal(off.temperature, 0.7);
  assert.equal(original.max_completion_tokens, 4096);
  assert.throws(() => requestPayload(config, profile, original, 'high'), /does not support/);
});

test('toggle-only and non-thinking policies do not receive native effort settings', () => {
  const p = config.profiles[0];
  const payload = requestPayload(config, p, { messages: [], reasoning_effort: 'high' }, 'medium');
  assert.equal(payload.reasoning_effort, undefined);
  assert.equal(payload.thinking_budget_tokens, 2048);
  assert.equal(payload.chat_template_kwargs.preserve_thinking, false);
  const c = structuredClone(config);
  c.policies.qwen35 = { ...c.policies.qwen35, thinking: 'none', levels: { off: 'none' }, budgets: {} };
  validateConfig(c);
  assert.equal(requestPayload(c, p, { messages: [] }, 'off').chat_template_kwargs, undefined);
});

test('native model decoration retains provider identity and disables unsupported levels', () => {
  const native = { id: profile.id, provider: 'llama.cpp', api: 'openai-completions', baseUrl: 'http://localhost/v1', contextWindow: 262144 };
  const decorated = decorateModel(config, native);
  assert.equal(decorated.contextWindow, profile.context);
  assert.equal(decorated.thinkingLevelMap.high, null);
  assert.equal(decorated.thinkingLevelMap.xhigh, 'xhigh');
  assert.equal(decorated.provider, native.provider);
  assert.equal(native.contextWindow, 262144);
});

test('effective server context mismatch is rejected', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => new Response(JSON.stringify(String(url).includes('/models')
    ? { data: [{ id: profile.id, tags: [profileTag(config, profile)], status: { value: 'loaded', args: expectedArgs } }] }
    : { default_generation_settings: { n_ctx: 4096 } }), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(() => verifyLoaded(config, profile), /4096 differs/);
});

test('extension keeps native provider behavior and aborts stale requests despite Pi swallowing hook errors', async () => {
  const handlers = new Map(); let registered; let aborted = false; const notifications = [];
  const native = { id: 'llama.cpp', auth: { apiKey: {} }, getModels: () => [], refreshModels: async () => {}, stream: () => {}, streamSimple: () => {} };
  const pi = {
    on: (event, handler) => handlers.set(event, handler), registerCommand: () => {},
    registerProvider: p => { registered = p; }, getThinkingLevel: () => 'medium',
  };
  const ctx = { modelRegistry: { getRegisteredNativeProvider: () => native }, ui: { notify: (message, level) => notifications.push({ message, level }), setStatus: () => {} }, abort: () => { aborted = true; } };
  localLlama(pi);
  handlers.get('session_start')({}, ctx);
  assert.equal(registered.stream, native.stream);
  assert.equal(registered.streamSimple, native.streamSimple);
  ctx.model = { id: profile.id, provider: 'llama.cpp', contextWindow: 4096, maxTokens: 2048 };
  await assert.rejects(() => handlers.get('before_provider_request')({ payload: { messages: [] } }, ctx), /stale/);
  assert.equal(aborted, true);
  assert.equal(notifications.at(-1).level, 'error');
  assert.match(notifications.at(-1).message, /Run \/local:reload, then select qwen3\.8-27b-gsq in \/local/);
  assert.match(notifications.at(-1).message, /You can continue this conversation/);
});


test('two residents require disjoint verified CUDA placement, including the projector', () => {
  const c = structuredClone(config); c.server.maxModels = 2;
  const a = { ...c.profiles[0], id: 'left', vision: false, runtime: { ...c.profiles[0].runtime, device: 'CUDA0' } };
  const b = { ...a, id: 'right', runtime: { ...a.runtime, device: 'CUDA1' } };
  assert.equal(canCoexist(c, a, b), true);
  assert.equal(canCoexist(c, a, { ...b, vision: true, runtime: { ...b.runtime, 'mmproj-device': 'CUDA0' } }), false);
  const drafted = { ...b, model: 'gemma4-31b', runtime: { ...b.runtime, 'spec-type': 'draft-mtp', 'spec-draft-device': 'CUDA0' } };
  assert.equal(canCoexist(c, a, drafted), false);
  delete drafted.runtime['spec-draft-device'];
  assert.equal(canCoexist(c, a, drafted), false);
  assert.equal(canCoexist(c, a, { ...b, runtime: { ...b.runtime, device: 'CUDA0,CUDA1' } }), false);
  assert.equal(canCoexist(c, a, { ...b, runtime: { ...b.runtime, device: 'CPU' } }), false);
  assert.equal(canCoexist(c, a, undefined), false);
  assert.equal(canCoexist(c, a, a), false);
  c.server.maxModels = 1;
  assert.equal(canCoexist(c, a, b), false);
  c.server.maxModels = 3;
  assert.throws(() => validateConfig(c), /maxModels/);
  delete c.server.maxModels;
  assert.equal(validateConfig(c).server.maxModels, 1);
  assert.equal(serverArgs({ ...c, server: { ...c.server, maxModels: 2 } })[3], '2');
});

test('external draft model is generated only for an enabled MTP profile', () => {
  const p = config.profiles.find(p => p.model === 'gemma4-31b');
  const on = { ...p, runtime: { ...p.runtime, 'spec-type': 'draft-mtp' } };
  assert.equal(profileOptions(config, on)['spec-draft-model'], config.models[p.model].draftPath);
  const off = { ...p, runtime: { ...p.runtime, 'spec-type': 'none' } };
  assert.equal(profileOptions(config, off)['spec-draft-model'], undefined);
  assert.notEqual(profileTag(config, on), profileTag(config, off));
  const c = structuredClone(config);
  c.runtimeDefaults['spec-draft-model'] = '/tmp/wrong.gguf';
  assert.throws(() => validateConfig(c), /unsupported runtime option/);
});

test('residency changes are serialized across callers and release is idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-local-lock-test-'));
  const c = { ...config, server: { ...config.server, cacheDirectory: directory } };
  try {
    const release = acquireModelOperation(c);
    assert.throws(() => acquireModelOperation(c), /Another session/);
    release(); release();
    acquireModelOperation(c)();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('router aliases preserve value verification and reject conflicting duplicates', () => {
  const base = config.profiles.find(p => p.model === 'gemma4-31b');
  const p = { ...base, runtime: { ...base.runtime, 'spec-type': 'draft-mtp', 'spec-draft-n-max': 2, 'spec-draft-device': 'CUDA1', 'spec-draft-type-k': 'q8_0', 'spec-draft-type-v': 'q8_0' } };
  const aliases = { 'ctx-checkpoints': 'swa-checkpoints', 'spec-draft-model': 'model-draft', 'spec-draft-device': 'device-draft', 'spec-draft-type-k': 'cache-type-k-draft', 'spec-draft-type-v': 'cache-type-v-draft' };
  const args = Object.entries(profileOptions(config, p)).flatMap(([k, v]) => typeof v === 'boolean' ? [v ? `--${k}` : `--no-${k}`] : [`--${aliases[k] ?? k}`, String(v)]);
  const entry = { tags: [profileTag(config, p)], status: { args } };
  assertProfile(config, p, entry);
  args.push('--ctx-checkpoints', '99');
  assert.throws(() => assertProfile(config, p, entry), /ctx-checkpoints differs/);
});
