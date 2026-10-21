import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { analyzeSloppiness, commandOptions } from './core.mjs';

const ENTRY = 'sloppiness-report';
const HELP = 'Use /sloppiness [folder, file, or glob] [--include "*.c"] [--exclude "deps/**"] [--regex "\\.(c|h)$"] [--all] [--list] [--recover]. Repeat --include/--exclude for more patterns. --list previews selection without analysis; --all includes ignored/default-excluded files; --recover enables approximate C syntax recovery. Paths with spaces may be quoted. /sloppiness:cancel stops scans. First use downloads pinned dependencies through uv; analysis is local.';

export default function sloppiness(pi: ExtensionAPI) {
  const scans = new Set<AbortController>();

  async function scan(path: string, cwd: string, options = {}, signal?: AbortSignal) {
    const controller = new AbortController();
    scans.add(controller);
    try {
      return await analyzeSloppiness(path, {
        ...options, cwd, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
    } finally { scans.delete(controller); }
  }

  function cancel() { for (const controller of scans) controller.abort(); }
  pi.on('session_shutdown', cancel);
  // A command report stays in the transcript without entering model context.
  pi.registerEntryRenderer<{ text: string }>(ENTRY, entry => new Text(entry.data?.text ?? '', 0, 0));
  // Preserve rendering of reports already recorded under the old name.
  pi.registerEntryRenderer<{ text: string }>('quality-report', entry => new Text(entry.data?.text ?? '', 0, 0));
  pi.registerCommand('sloppiness', {
    description: 'Measure code sloppiness: verbosity, erosion, and complexity hotspots',
    handler: async (args, ctx) => {
      if (args.trim() === '--help') { ctx.ui.notify(HELP, 'info'); return; }
      ctx.ui.setStatus('sloppiness', 'sloppiness: scanning…');
      try {
        const { path, ...options } = commandOptions(args);
        const result = await scan(path, ctx.cwd, options);
        pi.appendEntry(ENTRY, result);
      } catch (error) {
        ctx.ui.notify(`Sloppiness: ${(error as Error).message}`, 'error');
      } finally {
        ctx.ui.setStatus('sloppiness', scans.size ? 'sloppiness: scanning…' : undefined);
      }
    },
  });
  pi.registerCommand('sloppiness:cancel', {
    description: 'Cancel running sloppiness scans',
    handler: async (_args, ctx) => {
      const count = scans.size;
      cancel();
      ctx.ui.notify(count ? `Cancelling ${count} sloppiness scan(s).` : 'No sloppiness scans running.', 'info');
    },
  });
  pi.registerTool({
    name: 'code_sloppiness',
    label: 'Code Sloppiness',
    description: 'Measure code verbosity, duplication, and structural erosion in a local folder, file, or glob. Deterministic analysis; no source edits. Supports include/exclude globs, path regex, selection previews, ignored-file inclusion, and explicit approximate C recovery. Returns a compact summary and full report paths. Scores are review signals, not authorship evidence or overall quality grades. Unsupported extensions are skipped. First use may download pinned analyzer dependencies using uv.',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: 'Local folder, file, or glob; relative to Pi’s working directory by default.' })),
      include: Type.Optional(Type.Array(Type.String(), { maxItems: 20, description: 'Include globs, e.g. ["src/**/*.c", "include/**/*.h"].' })),
      exclude: Type.Optional(Type.Array(Type.String(), { maxItems: 20, description: 'Exclude globs, e.g. ["deps/**", "**/generated/**"].' })),
      regex: Type.Optional(Type.String({ maxLength: 512, description: 'Python regex searched against relative paths with / separators, e.g. \\.(c|h)$.' })),
      all: Type.Optional(Type.Boolean({ description: 'Also consider Git-ignored and default-excluded files; explicit exclusions still apply.' })),
      listOnly: Type.Optional(Type.Boolean({ description: 'Preview file selection without parsing or scores.' })),
      recover: Type.Optional(Type.Boolean({ description: 'Opt in to C syntax recovery; resulting metrics are explicitly approximate.' })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const { path, ...options } = params;
      const result = await scan(path ?? '.', ctx.cwd, options, signal);
      return { content: [{ type: 'text' as const, text: result.text }], details: result.details };
    },
  });
}
