import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import observationalMemory from '../../optional/observational-memory/src/index.ts';
import { parentProfile } from '../../optional/observational-memory/src/parent-profile.ts';

// Normal Pi discovers this entry. pi-lean does not load it. The underlying
// per-session gate defaults off; /om toggles worker calls on for this session.
export default function memory(pi: ExtensionAPI): void {
  observationalMemory(pi, {
    configure(runtime, ctx) {
      runtime.config = parentProfile(ctx.model, pi.getThinkingLevel());
      runtime.configLoaded = true;
    },
  });
}
