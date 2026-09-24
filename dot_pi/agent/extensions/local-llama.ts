import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { setTimeout as delay } from 'node:timers/promises';
import { apiKey, assertProfile, catalog, checkFiles, decorateModel, profileReloadHint, readConfig, request, requestPayload, serverUrl, verifyLoaded } from '../local-llama/core.mjs';
import { ensureRouter, paths, reloadRouter } from '../local-llama/router.mjs';

export default function localLlama(pi: ExtensionAPI) {
  let config: ReturnType<typeof readConfig>;
  let base: any;
  let operation: AbortController | undefined;

  function install(ctx: ExtensionContext) {
    config = readConfig();
    base ??= ctx.modelRegistry.getRegisteredNativeProvider('llama.cpp');
    if (!base) throw new Error('Pi’s native llama.cpp provider is unavailable. This extension requires Pi 0.85.1 or newer.');
    // Preserve native discovery, streaming, and /llama. Overlay local configuration.
    pi.registerProvider({
      ...base,
      baseUrl: `${serverUrl(config)}/v1`,
      auth: {
        ...base.auth,
        apiKey: {
          ...base.auth.apiKey,
          check: async () => {
            try { apiKey(config); return { type: 'api_key', source: 'local-llama/models.json' }; } catch { return undefined; }
          },
          resolve: async () => ({
            auth: { apiKey: apiKey(config), baseUrl: `${serverUrl(config)}/v1` },
            env: { LLAMA_BASE_URL: serverUrl(config) }, source: 'local-llama/models.json',
          }),
        },
      },
      getModels: () => base.getModels().map((model: any) => decorateModel(config, model)),
      refreshModels: (context: any) => base.refreshModels({
        ...context, credential: { type: 'api_key', key: apiKey(config), env: { LLAMA_BASE_URL: serverUrl(config) } },
      }),
    });
  }

  function status(ctx: ExtensionContext) {
    const p = ctx.model?.provider === 'llama.cpp' && config?.profiles.find((p: any) => p.id === ctx.model?.id);
    ctx.ui.setStatus('local-llama', p ? `local ${p.context / 1024}K · ${pi.getThinkingLevel()}` : undefined);
  }

  async function refresh(ctx: ExtensionContext, signal: AbortSignal) {
    const result = await ctx.modelRegistry.refresh({ providers: ['llama.cpp'], allowNetwork: true, force: true, signal });
    if (result.aborted) throw new Error('Model refresh cancelled or timed out.');
    const error = result.errors.get('llama.cpp');
    if (error) throw error;
  }

  pi.on('session_start', (_event, ctx) => {
    try { install(ctx); status(ctx); }
    catch (error) { ctx.ui.notify(`Local llama: ${(error as Error).message}`, 'warning'); }
  });
  pi.on('model_select', (_event, ctx) => status(ctx));
  pi.on('thinking_level_select', (_event, ctx) => status(ctx));
  pi.on('session_shutdown', () => operation?.abort());

  pi.on('before_provider_request', async (event, ctx) => {
    if (ctx.model?.provider !== 'llama.cpp' || !config) return;
    const p = config.profiles.find((p: any) => p.id === ctx.model?.id);
    if (!p) return;
    try {
      if (ctx.model.contextWindow !== p.context || ctx.model.maxTokens !== p.maxOutput) throw new Error(`Local model metadata is stale or overridden in models.json. ${profileReloadHint(p)}`);
      await verifyLoaded(config, p, ctx.signal);
      return requestPayload(config, p, event.payload, ctx.thinkingLevel ?? pi.getThinkingLevel());
    } catch (error) {
      // Pi reports hook errors and continues. Abort the turn as well to prevent a stale request being sent.
      ctx.abort();
      ctx.ui.notify((error as Error).message, 'error');
      throw error;
    }
  });

  const localCommand: Parameters<ExtensionAPI['registerCommand']>[1] = {
    description: 'Pick a local profile; use /local:status, /local:reload, /local:cancel, or /local:unload',
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === 'cancel') { operation?.abort(new Error('Cancelled by /local:cancel')); return; }
      if (operation) { ctx.ui.notify('A local model operation is in progress. Use /local:cancel to cancel.', 'warning'); return; }
      if (!ctx.isIdle()) { ctx.ui.notify('Wait for the current answer before switching local models.', 'warning'); return; }
      operation = new AbortController();
      let loading: string | undefined;
      let signal: AbortSignal | undefined;
      try {
        install(ctx);
        signal = AbortSignal.any([operation.signal, AbortSignal.timeout(config.server.loadTimeoutMs)]);
        if (arg === 'status') {
          const models = await catalog(config, signal);
          ctx.ui.notify(models.map((m: any) => `${m.id}: ${m.status.value}`).join('\n'));
          return;
        }
        if (arg === 'reload') {
          await reloadRouter(config, signal);
          await refresh(ctx, signal);
          ctx.ui.notify('Reloaded presets. Use /local to select a profile.');
          return;
        }
        if (arg === 'unload') {
          const models = await catalog(config, signal);
          const loaded = models.filter((model: any) => model.status.value === 'loaded');
          if (!loaded.length) {
            ctx.ui.notify('No models are loaded.');
            return;
          }
          if (models.some((model: any) => ['loading', 'downloading'].includes(model.status.value))) {
            throw new Error('A model is loading or downloading. Wait for it to finish before unloading.');
          }
          for (const model of loaded) {
            const slots = await request(config, `/slots?model=${encodeURIComponent(model.id)}`, { signal });
            if (!Array.isArray(slots) || slots.some((slot: any) => slot.is_processing)) {
              throw new Error(`${model.id} is busy in this or another session. Wait for its request before unloading.`);
            }
          }
          for (const model of loaded) {
            const result = await request(config, '/models/unload', {
              method: 'POST', body: JSON.stringify({ model: model.id }), signal,
            });
            if (result.success === false) throw new Error(result.error || `Could not unload ${model.id}.`);
          }
          const deadline = Date.now() + config.server.loadTimeoutMs;
          while (loaded.length && Date.now() < deadline) {
            const current = await catalog(config, signal);
            if (loaded.every((model: any) => current.find((entry: any) => entry.id === model.id)?.status.value === 'unloaded')) {
              ctx.ui.notify(`Unloaded ${loaded.map((model: any) => model.id).join(', ')}. Run /local to pick a profile again.`);
              return;
            }
            await delay(250, undefined, { signal });
          }
          throw new Error('Timed out waiting for models to unload. Check /local:status and the llama server log.');
        }
        const choices = config.profiles.map((p: any) => `${p.name} [${p.id}]`);
        const choice = await ctx.ui.select('Local model profile', choices);
        if (!choice) return;
        const p = config.profiles[choices.indexOf(choice)];
        checkFiles(config, [p]);
        ctx.ui.setStatus('local-llama', `loading ${p.id}…`);
        await ensureRouter(config, { signal });
        const models = await catalog(config, signal);
        const target = models.find((m: any) => m.id === p.id);
        assertProfile(config, p, target);
        if (models.some((m: any) => m.id !== p.id && ['loading', 'downloading'].includes(m.status.value))) throw new Error('Another model operation is in progress. Try again after it finishes.');
        for (const other of models.filter((m: any) => m.id !== p.id && m.status.value === 'loaded')) {
          const slots = await request(config, `/slots?model=${encodeURIComponent(other.id)}`, { signal });
          if (!Array.isArray(slots) || slots.some((s: any) => s.is_processing)) throw new Error(`${other.id} is busy in another session; try again after it finishes.`);
        }
        if (target.status.value !== 'loaded') {
          if (target.status.value === 'unloaded') loading = p.id;
          if (target.status.value !== 'loading') await request(config, '/models/load', { method: 'POST', body: JSON.stringify({ model: p.id }), signal });
          while (true) {
            const entry = (await catalog(config, signal)).find((m: any) => m.id === p.id);
            if (entry?.status.value === 'loaded') break;
            if (!entry || entry.status.failed || (entry.status.exit_code != null && entry.status.exit_code !== 0)) throw new Error(`Failed to load ${p.id}. See ${paths(config).log}`);
            await delay(500, undefined, { signal });
          }
        }
        await verifyLoaded(config, p, signal);
        await refresh(ctx, signal);
        const model = ctx.modelRegistry.find('llama.cpp', p.id);
        if (!model) throw new Error('Loaded model is missing from Pi’s refreshed catalog.');
        if (!await pi.setModel(model)) throw new Error('Pi could not authenticate the local model. Check the configured API key file.');
        pi.setThinkingLevel(p.defaultThinking);
        ctx.ui.notify(`${p.name} ready · thinking ${p.defaultThinking}`);
        loading = undefined;
      } catch (error) {
        if (loading && signal?.aborted) await request(config, '/models/unload', { method: 'POST', body: JSON.stringify({ model: loading }) }).catch(() => {});
        ctx.ui.notify(`Local llama: ${(error as Error).message}`, 'error');
      } finally { operation = undefined; status(ctx); }
    },
  };
  pi.registerCommand('local', {
    ...localCommand,
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify('Use /local to pick a profile. Discrete actions use /local:<action>.', 'warning');
        return;
      }
      await localCommand.handler('', ctx);
    },
  });
  for (const [action, description] of Object.entries({
    reload: 'Apply changed local llama.cpp server presets',
    status: 'Show local router model states',
    cancel: 'Cancel a pending local model operation',
    unload: 'Unload every idle model from VRAM and release mapped model files',
  })) {
    pi.registerCommand(`local:${action}`, {
        description,
      handler: async (args, ctx) => {
        if (args.trim()) { ctx.ui.notify(`Usage: /local:${action}`, 'warning'); return; }
        await localCommand.handler(action, ctx);
      },
    });
  }
}
