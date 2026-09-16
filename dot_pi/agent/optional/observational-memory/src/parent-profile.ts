import { DEFAULTS, type Config, type ConfiguredModel } from './config.js';

/** Installed trial profile: no untrusted project/provider overrides. */
export function parentProfile(model: {provider:string;id:string;contextWindow:number} | undefined, thinking = 'off'): Config {
  if (!model?.provider || !model.id || !Number.isFinite(model.contextWindow) || model.contextWindow < 16_384) {
    throw new Error('Observational memory requires a selected parent model with at least a 16k context window');
  }
  const window = model.contextWindow;
  const worker: ConfiguredModel = {provider:model.provider,id:model.id};
  if (['off','minimal','low','medium','high','xhigh','max'].includes(thinking)) worker.thinking = thinking as ConfiguredModel['thinking'];
  return {
    ...DEFAULTS,
    models: {observer:{...worker},consolidator:{...worker}},
    chunkTokens: Math.min(2000, Math.floor(window / 16)),
    chunkOverlapTokens: 0,
    poolTargetTokens: Math.min(2000, Math.floor(window / 16)),
    consolidateAtPoolTokens: Math.min(4000, Math.floor(window / 8)),
    compactAtContextTokens: Math.min(64_000, Math.floor(window * 0.6)),
    tailTokens: Math.min(8000, Math.floor(window / 8)),
    journeyTargetTokens: Math.min(500, Math.floor(window / 64)),
    observerConcurrency: 1,
    debugLog: false,
    passive: ['1','true','yes','on'].includes((process.env.PI_OM_PASSIVE ?? '').toLowerCase()),
  };
}
