import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import subagents, { getRunningSubagentCount } from '../../optional/interactive-subagents/pi-extension/subagents/index.ts';

const TOOLS = ['subagent', 'subagent_message', 'subagents_list'];
const ENTRY = 'herdr-subagents-enabled';
const insideHerdr = () => process.env.HERDR_ENV === '1' &&
  !!process.env.HERDR_PANE_ID && !!process.env.HERDR_SOCKET_PATH &&
  (!process.env.PI_SUBAGENT_MUX || process.env.PI_SUBAGENT_MUX === 'herdr');

export default function integratedSubagents(pi: ExtensionAPI) {
  const profile = process.env.PI_SUBAGENTS_DEFAULT === 'off' ? 'lean' : 'main';
  let enabled = false;
  function available() {
    const configured = new Set(pi.getAllTools().map(t => t.name));
    return insideHerdr() && TOOLS.every(t => configured.has(t));
  }
  function setEnabled(want: boolean) {
    enabled = want && available();
    const active = new Set(pi.getActiveTools());
    for (const name of TOOLS) enabled ? active.add(name) : active.delete(name);
    pi.setActiveTools([...active]);
  }
  function restore(ctx: ExtensionContext) {
    let want = profile === 'main';
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== ENTRY) continue;
      const data = entry.data as { profile?: string; on?: boolean } | undefined;
      if (data?.profile === profile && typeof data.on === 'boolean') want = data.on;
    }
    setEnabled(want);
  }
  // Guard executions as well as visibility: being registered must not allow
  // disabled tools to create panes or inject a /subagents:spawn prompt.
  subagents(new Proxy(pi, {
    get(target, key) {
      if (key === 'registerTool') return (tool: any) => pi.registerTool({
        ...tool,
        execute: (...args: any[]) => {
          if (!enabled || !insideHerdr()) throw new Error('Subagents are off or Herdr is unavailable. Use /subagents status.');
          return tool.execute(...args);
        },
      });
      if (key === 'registerCommand') return (name: string, command: any) => pi.registerCommand(name, {
        ...command,
        handler: (args: string, ctx: ExtensionContext) => {
          if (!enabled || !insideHerdr()) {
            if (ctx.hasUI) ctx.ui.notify('Subagents are off. Inside Herdr, enable with /subagents on.', 'warning');
            return;
          }
          return command.handler(args, ctx);
        },
      });
      return Reflect.get(target, key);
    },
  }));
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));
  pi.on('session_shutdown', () => { enabled = false; });
  pi.registerCommand('subagents', {
    description: 'Herdr read-only scout: bare /subagents toggles; /subagents on|off|status (normal Pi: on; lean: off)',
    handler: async (args, ctx) => {
      const raw = args.trim().toLowerCase();
      const notify = (text: string, kind: 'info' | 'warning' = 'info') => { if (ctx.hasUI) ctx.ui.notify(text, kind); };
      if (raw === 'status') {
        notify(`Subagents: ${enabled ? 'on' : 'off'} (${profile} profile). ${insideHerdr() ? 'Herdr context available.' : 'Requires a Herdr-managed pane; no plain-terminal fallback.'}`);
        return;
      }
      if (raw !== '' && !['on', 'off'].includes(raw)) { notify('Usage: /subagents [on|off|status]', 'warning'); return; }
      const want = raw === '' ? !enabled : raw === 'on';
      if (want === enabled) { notify(`Subagents already ${want ? 'on' : 'off'}.`, 'info'); return; }
      if (want && !available()) {
        notify('Cannot enable subagents: run inside Herdr and allow all three subagent tools in your CLI tool selection.', 'warning');
        return;
      }
      if (!want && getRunningSubagentCount() > 0) {
        notify('Wait for the current scout to finish before disabling subagents.', 'warning');
        return;
      }
      setEnabled(want);
      pi.appendEntry(ENTRY, { profile, on: enabled });
      notify(`Subagents ${enabled ? 'on' : 'off'}.`);
    },
  });
}
