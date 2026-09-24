/**
 * Observational memory — ORCHESTRATOR (master-side, in-process).
 *
 * The conductor: owns the clocks/triggers, spawns subprocess workers, commits their output to
 * the ledger (observations) or files (long-term, Phase B), renders compaction, and drives the
 * TUI. Event-driven only — no daemon.
 *
 * Ships in the global extensions folder during development, so it is gated OFF by default per
 * session (A2a). When the gate is off, every handler returns at its first line and the
 * extension is completely invisible.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCompactCommand } from "./commands/compact.js";
import { registerConsolidateCommand } from "./commands/consolidate.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerCompactionHook } from "./hooks/compaction-hook.js";
import { registerCompactionTrigger } from "./hooks/compaction-trigger.js";
import { registerConsolidatorTrigger } from "./hooks/consolidator-trigger.js";
import { registerObserverTrigger } from "./hooks/observer-trigger.js";
import { OM_ENABLED, type Entry } from "./ledger/index.js";
import { ensureSessionMemory } from "./memory/session.js";
import { Runtime } from "./runtime.js";

function readGateFromLedger(branch: Entry[]): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "custom" && entry.customType === OM_ENABLED) {
			return (entry.data as { enabled?: boolean } | undefined)?.enabled ?? false;
		}
	}
	return false;
}

export default function observationalMemory(pi: ExtensionAPI, options: {
	configure?: (runtime: Runtime, ctx: any) => void;
} = {}): void {
	const runtime = new Runtime();
	function configure(ctx: any): void {
		try { options.configure?.(runtime, ctx); }
		catch (error) {
			runtime.enabled = false;
			runtime.abortAllWorkers();
			runtime.status.detach();
			throw error;
		}
	}

	function attachIfEnabled(ctx: any): void {
		if (runtime.enabled && ctx.mode === "tui" && ctx.hasUI && ctx.ui) {
			runtime.status.attach(ctx.ui);
		} else {
			runtime.status.detach();
		}
	}

	async function restore(ctx: any): Promise<void> {
		runtime.enabled = false;
		runtime.abortAllWorkers();
		await runtime.whenWorkersIdle();
		runtime.configLoaded = false;
		runtime.ensureConfig(ctx.cwd);
		runtime.dispatchedCoversUpToId = undefined;
		const branch = ctx.sessionManager.getBranch() as Entry[];
		const want = readGateFromLedger(branch);
		if (want) configure(ctx);
		runtime.memoryRoot = want ? ensureSessionMemory(ctx) : "";
		runtime.enabled = want;
		attachIfEnabled(ctx);
		runtime.refreshFooterGauges(branch, ctx.getContextUsage?.()?.tokens ?? null);
		runtime.refreshCost(ctx.sessionManager.getEntries() as Entry[]);
	}
	pi.on("session_start", (_event: unknown, ctx: any) => restore(ctx));
	pi.on("session_tree", (_event: unknown, ctx: any) => restore(ctx));

	pi.on("session_shutdown", async () => {
		runtime.enabled = false;
		runtime.status.detach();
		runtime.abortAllWorkers();
		await runtime.whenWorkersIdle();
	});

	const handleOMCommand = async (args: string, ctx: any) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg !== "") {
				if (ctx.hasUI) ctx.ui.notify("Use /om to toggle, or /om:status to inspect state.", "warning");
				return;
			}
			const next = !runtime.enabled;
			if (next === runtime.enabled) {
				if (ctx.hasUI) ctx.ui.notify(`om already ${next ? "on" : "off"}`, "info");
				return;
			}
			if (next) {
				configure(ctx);
				runtime.memoryRoot = ensureSessionMemory(ctx);
				runtime.enabled = true;
				attachIfEnabled(ctx);
				runtime.refreshFooterGauges(ctx.sessionManager.getBranch() as Entry[], ctx.getContextUsage?.()?.tokens ?? null);
				runtime.refreshCost(ctx.sessionManager.getEntries() as Entry[]);
			} else {
				runtime.enabled = false;
				runtime.abortAllWorkers();
				runtime.status.detach();
				await runtime.whenWorkersIdle();
			}
			pi.appendEntry(OM_ENABLED, { enabled: next });
			if (ctx.hasUI) ctx.ui.notify(`om ${next ? "enabled" : "disabled"}`, "info");
	};
	pi.registerCommand("om", {
		description: "Toggle observational memory for this session; use /om:status to inspect state",
		handler: handleOMCommand,
	});
	// Refresh the installed parent-model profile before any background dispatch.
	// Existing workers retain their launch model; subsequent workers use the new selection.
	const refreshProfile = (_event: unknown, ctx: any) => {
		if (!runtime.enabled) return;
		try { configure(ctx); }
		catch (error) { if (ctx.hasUI) ctx.ui.notify(`om disabled: ${(error as Error).message}`, "warning"); }
	};
	pi.on("model_select", refreshProfile);
	pi.on("agent_start", refreshProfile);
	pi.on("turn_end", refreshProfile);

	// Triggers + hook self-gate on runtime.enabled / passive at their first line.
	registerObserverTrigger(pi, runtime);
	registerConsolidatorTrigger(pi, runtime);
	registerCompactionTrigger(pi, runtime);
	registerCompactionHook(pi, runtime);

	registerStatusCommand(pi, runtime);
	registerCompactCommand(pi, runtime);
	registerConsolidateCommand(pi, runtime);
}
