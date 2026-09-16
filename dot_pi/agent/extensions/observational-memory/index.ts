import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import observationalMemory from '../../optional/observational-memory/src/index.ts';
import { parentProfile } from '../../optional/observational-memory/src/parent-profile.ts';

// Normal Pi discovers this entry. pi-lean does not load it. The underlying
// per-session gate defaults off; /om on is the explicit opt-in to worker calls.
export default function memory(pi: ExtensionAPI): void {
  observationalMemory(pi, {
    configure(runtime, ctx) {
      runtime.config = parentProfile(ctx.model, pi.getThinkingLevel());
      runtime.configLoaded = true;
    },
  });
}
