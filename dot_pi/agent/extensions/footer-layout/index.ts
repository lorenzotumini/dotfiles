import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Usage } from '@earendil-works/pi-ai';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { homedir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';

const singleLine = (text: string) => text.replace(/[\r\n\t]/g, ' ').replace(/ +/g, ' ').trim();
const tokens = (n: number) => n < 1000 ? `${n}` : n < 1e6 ? `${+(n / 1000).toFixed(1)}k` : `${+(n / 1e6).toFixed(1)}M`;

// Wrap on small terminals instead of silently dropping extension statuses.
function columns(left: string, right: string, width: number): string[] {
  if (width < 1) return [];
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + rightWidth + (left && right ? 2 : 0) <= width) {
    return [left + ' '.repeat(right ? width - leftWidth - rightWidth : 0) + right];
  }
  return [
    ...(left ? wrapTextWithAnsi(left, width) : []),
    ...(right ? wrapTextWithAnsi(right, width).map(line => ' '.repeat(Math.max(0, width - visibleWidth(line))) + line) : []),
  ].map(line => truncateToWidth(line, width));
}

function project(ctx: ExtensionContext, branch: string | null): string {
  const path = relative(homedir(), ctx.cwd);
  const insideHome = path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  const cwd = insideHome ? path ? `~${sep}${path}` : '~' : ctx.cwd;
  const name = ctx.sessionManager.getSessionName();
  return singleLine(`${cwd}${branch ? ` (${branch})` : ''}${name ? ` · ${name}` : ''}`);
}

export default function balancedFooter(pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      let cached: { session: string; leaf: string | null; text: string } | undefined;
      function usageText(): string {
        const session = ctx.sessionManager.getSessionId();
        const leaf = ctx.sessionManager.getLeafId();
        if (cached?.session === session && cached.leaf === leaf) return cached.text;
        let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
        function add(usage: Usage | undefined) {
          if (!usage) return;
          input += usage.input;
          output += usage.output;
          cacheRead += usage.cacheRead;
          cacheWrite += usage.cacheWrite;
          cost += usage.cost.total;
        }
        // Public session data includes auxiliary, tool, and compaction usage.
        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type === 'usage' || entry.type === 'compaction' || entry.type === 'branch_summary') add(entry.usage);
          else if (entry.type === 'message') {
            if (entry.message.role === 'assistant' || entry.message.role === 'toolResult') add(entry.message.usage);
          }
        }
        const parts = [input ? `↑${tokens(input)}` : '', output ? `↓${tokens(output)}` : '',
          cacheRead ? `R${tokens(cacheRead)}` : '', cacheWrite ? `W${tokens(cacheWrite)}` : '',
          cost ? `$${cost.toFixed(3)}` : ''].filter(Boolean);
        const text = parts.join(' ');
        cached = { session, leaf, text };
        return text;
      }
      return {
        dispose: footerData.onBranchChange(() => tui.requestRender()),
        invalidate() { cached = undefined; },
        render(width: number): string[] {
          if (width < 1) return [];
          const dim = (text: string) => theme.fg('dim', text);
          const model = ctx.model;
          const thinking = model?.reasoning ? ` · ${pi.getThinkingLevel()}` : '';
          const modelText = dim(singleLine(model ? `(${model.provider}) ${model.id}${thinking}` : 'no-model'));
          const usage = ctx.getContextUsage();
          const percent = usage?.percent;
          const context = `ctx ${percent == null ? '?' : `${percent.toFixed(1)}%`}/${tokens(usage?.contextWindow ?? model?.contextWindow ?? 0)}`;
          const contextText = theme.fg(percent != null && percent > 90 ? 'error' : percent != null && percent > 70 ? 'warning' : 'dim', context);
          const totals = usageText();
          const statuses = [...footerData.getExtensionStatuses()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => singleLine(text)).filter(Boolean).join(' · ');
          const path = dim(project(ctx, footerData.getGitBranch()));
          return [...columns(path, modelText, width),
            ...columns(contextText + (totals ? dim(` · ${totals}`) : ''), statuses, width)];
        },
      };
    });
  });
}
