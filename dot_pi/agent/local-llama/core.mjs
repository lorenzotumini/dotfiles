import { createHash } from 'node:crypto';
import { readFileSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const RESERVED = new Set(['model', 'mmproj', 'ctx-size', 'host', 'port', 'models-preset', 'models-dir', 'models-max', 'models-autoload', 'api-key', 'api-key-file', 'tags', 'alias']);
// Explicit names avoid aliases overriding generated fields. Extend this list for new runtime features.
const RUNTIME = new Set(['device', 'n-gpu-layers', 'split-mode', 'tensor-split', 'main-gpu', 'flash-attn', 'threads', 'threads-batch', 'parallel', 'jinja', 'reasoning', 'fit', 'cache-type-k', 'cache-type-v', 'batch-size', 'ubatch-size', 'cache-ram', 'ctx-checkpoints', 'spec-type', 'spec-draft-n-max', 'spec-draft-type-k', 'spec-draft-type-v']);
const SAMPLERS = new Set(['temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'frequency_penalty', 'repeat_penalty']);
const fail = (message) => { throw new Error(`Local llama: ${message}`); };
const record = (x) => x && typeof x === 'object' && !Array.isArray(x);
const integer = (x, min) => Number.isSafeInteger(x) && x >= min;
const safe = (x) => ['string', 'number', 'boolean'].includes(typeof x) && !/[\r\n\0]/.test(String(x)) && String(x).length > 0;

export function expandPath(path) {
  if (typeof path !== 'string') fail('expected a file path');
  const expanded = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded) || !safe(expanded)) fail(`path must be absolute or start with ~/: ${path}`);
  return expanded;
}

export function configPath() {
  return process.env.PI_LOCAL_LLAMA_CONFIG || fileURLToPath(new URL('./models.json', import.meta.url));
}

export function readConfig(path = configPath()) {
  return validateConfig(JSON.parse(readFileSync(path, 'utf8')));
}

export function validateConfig(raw) {
  const c = structuredClone(raw);
  if (c.version !== 1) fail('unsupported configuration version');
  if (!record(c.server) || !['127.0.0.1', 'localhost'].includes(c.server.host)) fail('server.host must be loopback');
  if (!integer(c.server.port, 1) || c.server.port > 65535) fail('invalid server port');
  if (!safe(c.server.binary) || typeof c.server.binary !== 'string') fail('invalid server binary');
  if (!integer(c.server.loadTimeoutMs, 1000)) fail('invalid load timeout');
  c.server.apiKeyFile = expandPath(c.server.apiKeyFile);
  c.server.cacheDirectory = expandPath(c.server.cacheDirectory);
  if (!record(c.runtimeDefaults) || !record(c.models) || !record(c.policies) || !Array.isArray(c.profiles) || !c.profiles.length) fail('models, policies, defaults and profiles are required');
  const validateRuntime = (runtime) => {
    if (!record(runtime)) fail('runtime must be an object');
    for (const [k, v] of Object.entries(runtime)) {
      if (RESERVED.has(k) || !RUNTIME.has(k) || !safe(v)) fail(`unsupported runtime option: ${k}`);
    }
  };
  validateRuntime(c.runtimeDefaults);
  for (const [id, policy] of Object.entries(c.policies)) {
    if (!record(policy) || !['none', 'toggle', 'effort'].includes(policy.thinking)) fail(`invalid thinking policy: ${id}`);
    if (typeof policy.preserveThinking !== 'boolean' || !record(policy.levels) || !record(policy.budgets)) fail(`incomplete policy: ${id}`);
    if (policy.levels.off !== 'none') fail(`${id}: off must map to none`);
    for (const [level, value] of Object.entries(policy.levels)) {
      if (!LEVELS.includes(level) || typeof value !== 'string' || !safe(value)) fail(`${id}: invalid thinking level ${level}`);
      if (level !== 'off' && (!integer(policy.budgets[level], 1) || policy.thinking === 'none')) fail(`${id}: missing thinking budget for ${level}`);
    }
    for (const mode of ['off', 'on']) {
      const sampling = policy.sampling?.[mode];
      if (!record(sampling)) fail(`${id}: missing ${mode} sampling`);
      for (const [k, v] of Object.entries(sampling)) {
        if (!SAMPLERS.has(k) || typeof v !== 'number' || !Number.isFinite(v)) fail(`${id}: invalid sampler ${k}`);
        if (['top_p', 'min_p'].includes(k) && (v < 0 || v > 1)) fail(`${id}: ${k} must be between 0 and 1`);
        if (['temperature', 'repeat_penalty', 'top_k'].includes(k) && v < 0) fail(`${id}: invalid ${k}`);
      }
    }
  }
  for (const [id, model] of Object.entries(c.models)) {
    if (!record(model) || !c.policies[model.policy]) fail(`${id}: unknown policy`);
    model.path = expandPath(model.path);
    if (model.projector) model.projector = expandPath(model.projector);
  }
  const seen = new Set();
  for (const p of c.profiles) {
    if (!record(p) || !/^[a-z0-9][a-z0-9._-]*$/.test(p.id) || seen.has(p.id)) fail(`invalid or duplicate profile ID: ${p.id}`);
    seen.add(p.id);
    if (typeof p.name !== 'string' || !safe(p.name) || !c.models[p.model]) fail(`${p.id}: missing name or model`);
    if (!integer(p.context, 2048) || !integer(p.maxOutput, 1024) || p.maxOutput > p.context - 1024) fail(`${p.id}: invalid context/output limits`);
    const model = c.models[p.model];
    if (!Object.hasOwn(c.policies[model.policy].levels, p.defaultThinking)) fail(`${p.id}: unsupported default thinking level`);
    if (typeof p.vision !== 'boolean' || (p.vision && !model.projector)) fail(`${p.id}: vision requires a projector`);
    validateRuntime(p.runtime);
    const runtime = { ...c.runtimeDefaults, ...p.runtime };
    if (runtime.parallel !== 1) fail(`${p.id}: this integration currently requires parallel = 1`);
    if (!runtime.device || !runtime['cache-type-k'] || !runtime['cache-type-v']) fail(`${p.id}: device and KV cache types must be explicit`);
    if (runtime['spec-type'] === 'draft-mtp' && !model.embeddedMtp) fail(`${p.id}: embedded MTP has not been confirmed`);
  }
  return c;
}

export function profileOptions(c, p) {
  const model = c.models[p.model];
  return {
    ...c.runtimeDefaults, ...p.runtime,
    model: model.path, 'ctx-size': p.context,
    ...(p.vision ? { mmproj: model.projector } : {}),
  };
}

export function profileTag(c, p) {
  const stable = Object.entries(profileOptions(c, p)).sort(([a], [b]) => a.localeCompare(b));
  return `pi-local-${createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16)}`;
}

export function renderIni(c) {
  return '; Generated from local-llama/models.json. Do not edit.\nversion = 1\n\n' + c.profiles.map((p) =>
    `[${p.id}]\n` + Object.entries({ ...profileOptions(c, p), tags: profileTag(c, p) })
      .map(([k, v]) => `${k} = ${v}`).join('\n') + '\n',
  ).join('\n');
}

export function checkFiles(c, profiles = c.profiles) {
  const paths = new Set(profiles.flatMap((p) => [c.models[p.model].path, ...(p.vision ? [c.models[p.model].projector] : [])]));
  for (const path of paths) {
    try { accessSync(path, constants.R_OK); } catch { fail(`model file is missing or unreadable: ${path}`); }
  }
}

export function apiKey(c) {
  const key = readFileSync(c.server.apiKeyFile, 'utf8').trim();
  if (!key || /\s/.test(key)) fail('apiKeyFile must contain one nonempty API key');
  return key;
}

export const serverUrl = (c) => `http://${c.server.host}:${c.server.port}`;

export function decorateModel(c, model) {
  const p = c.profiles.find((p) => p.id === model.id);
  if (!p) return model;
  const policy = c.policies[c.models[p.model].policy];
  return {
    ...model, name: p.name, contextWindow: p.context, maxTokens: p.maxOutput,
    reasoning: policy.thinking !== 'none', input: p.vision ? ['text', 'image'] : ['text'],
    thinkingLevelMap: Object.fromEntries(LEVELS.map((l) => [l, policy.levels[l] ?? null])),
    compat: {
      ...model.compat, supportsStore: false, supportsDeveloperRole: false,
      supportsReasoningEffort: policy.thinking === 'effort', supportsStrictMode: false,
      maxTokensField: 'max_tokens', thinkingFormat: 'openai',
      thinkingTokenBudgetField: undefined, supportsThinkingTokenBudget: false,
    },
  };
}

export function requestPayload(c, p, payload, level) {
  if (!record(payload) || !Array.isArray(payload.messages)) fail('expected a chat completions payload');
  const policy = c.policies[c.models[p.model].policy];
  if (!Object.hasOwn(policy.levels, level)) fail(`${p.id} does not support thinking level ${level}`);
  const enabled = level !== 'off' && policy.thinking !== 'none';
  const next = { ...payload, ...policy.sampling[enabled ? 'on' : 'off'] };
  delete next.reasoning_effort;
  delete next.thinking_budget_tokens;
  delete next.max_completion_tokens;
  delete next.repetition_penalty;
  const requested = payload.max_tokens ?? payload.max_completion_tokens ?? p.maxOutput;
  next.max_tokens = Math.min(integer(requested, 1) ? requested : p.maxOutput, p.maxOutput);
  if (policy.thinking !== 'none') {
    next.chat_template_kwargs = { ...payload.chat_template_kwargs, enable_thinking: enabled, preserve_thinking: policy.preserveThinking };
    if (policy.thinking === 'effort') next.reasoning_effort = policy.levels[level];
    if (enabled) next.thinking_budget_tokens = Math.max(0, Math.min(policy.budgets[level], next.max_tokens - 1024));
  }
  return next;
}

export async function request(c, path, { signal, timeoutMs = 15000, ...init } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(`${serverUrl(c)}${path}`, {
    ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey(c)}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `llama.cpp HTTP ${response.status} (${path})`);
  return body;
}

export async function catalog(c, signal) {
  const body = await request(c, '/models', { signal });
  if (!Array.isArray(body.data) || !body.data.every((m) => typeof m.id === 'string' && typeof m.status?.value === 'string')) fail('endpoint is not a llama.cpp router');
  return body.data;
}

export function profileReloadHint(p) {
  return `Run /local:reload, then /local ${p.id}, and retry your message. Reloading or restarting Pi alone does not reload the llama server. You can continue this conversation.`;
}

export function assertProfile(c, p, entry) {
  if (!entry) fail(`${p.id} is missing from the router. Run start.sh reload (or start the new router).`);
  const args = entry.status?.args ?? [];
  const tagIndex = args.indexOf('--tags');
  const tags = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
  if (!Array.isArray(entry.tags) && typeof tags !== 'string') fail('router does not expose profile tags');
  if (!(entry.tags ?? []).includes(profileTag(c, p)) && !String(tags ?? '').split(',').includes(profileTag(c, p))) fail(`${p.id}: router settings differ from models.json. ${profileReloadHint(p)}`);
  for (const [key, value] of Object.entries(profileOptions(c, p))) {
    const flag = typeof value === 'boolean' && !value ? `--no-${key}` : `--${key}`;
    const index = args.indexOf(flag);
    if (index < 0 || (typeof value !== 'boolean' && args[index + 1] !== String(value))) fail(`${p.id}: effective router option ${key} differs from the profile. ${profileReloadHint(p)}`);
  }
  if (!p.vision && args.includes('--mmproj')) fail(`${p.id}: unexpected vision projector. ${profileReloadHint(p)}`);
}

export async function verifyLoaded(c, p, signal) {
  const entry = (await catalog(c, signal)).find((m) => m.id === p.id);
  assertProfile(c, p, entry);
  if (entry.status.value !== 'loaded') fail(`${p.id} is not loaded. Select it with /local.`);
  const props = await request(c, `/props?model=${encodeURIComponent(p.id)}`, { signal });
  const context = props.default_generation_settings?.n_ctx ?? props.n_ctx;
  if (context !== p.context) fail(`${p.id}: server context ${context ?? 'unknown'} differs from configured ${p.context}. ${profileReloadHint(p)}`);
  if (props.modalities?.vision !== p.vision) fail(`${p.id}: server vision capability differs from the profile. ${profileReloadHint(p)}`);
  return entry;
}
