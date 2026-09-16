/**
 * File-based IPC between the in-process orchestrator and subprocess workers.
 *
 * A subprocess cannot append to the master's ledger, so it writes its output to a transient
 * result file under `<project>/.memory/.runs/<runId>.json`. The orchestrator reads + validates
 * it after the process exits, then commits to the right tier (observations → ledger).
 *
 * Worker recordings themselves live in pi's GLOBAL session store, not here (decision 11).
 * `.memory/.runs/` clutter is not GC'd in v1 (accepted).
 */
import { join } from "node:path";
import { atomicWrite as privateAtomicWrite } from "../memory/paths.js";
import { readSmallJson } from "./receipt.js";

/** What the observer model emits, before the orchestrator re-derives precise timestamp-ids. */
export type RawObservation = {
	timestamp: string; // "YYYY-MM-DD HH:MM"
	content: string;
};

export type ObserverRunResult = {
	observations: RawObservation[];
	/** True only after the observer actually calls its recording tool. */
	recorded?: boolean;
};

export function runsDir(root: string): string {
	return join(root, ".runs");
}

export function runResultPath(root: string, runId: string): string {
	return join(runsDir(root), `${runId}.result.json`);
}

/**
 * Per-run cost handoff file. Written by the worker EXTENSION (never the model) from pi's
 * built-in `usage.cost.total`, read by the orchestrator after the process exits. Uniform
 * across roles — the consolidator has no observations result file but still reports cost here.
 */
export function runCostPath(root: string, runId: string): string {
	return join(runsDir(root), `${runId}.cost.json`);
}

export function runStatusPath(root: string, runId: string): string {
	return join(runsDir(root), `${runId}.status.json`);
}

export type WorkerCostResult = {
	costUsd: number;
};

export function writeWorkerCost(path: string, cost: WorkerCostResult): void {
	atomicWrite(path, JSON.stringify(cost));
}

/** Best-effort read of a worker cost file; returns undefined on missing/malformed input. */
export function readWorkerCost(path: string): WorkerCostResult | undefined {
	try {
		const raw = readSmallJson(path, 8192) as unknown;
		if (!raw || typeof raw !== "object") return undefined;
		const cost = (raw as { costUsd?: unknown }).costUsd;
		if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return undefined;
		return { costUsd: cost };
	} catch {
		return undefined;
	}
}

/** Atomic write (temp + rename) so a reader never sees a half-written file. */
export function atomicWrite(path: string, content: string): void {
	privateAtomicWrite(path, content);
}

function isRawObservation(value: unknown): value is RawObservation {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return typeof v.timestamp === "string" && typeof v.content === "string" && v.content.trim().length > 0;
}

/** Parse + validate an observer result file. Throws on malformed input. */
export function readObserverResult(path: string): ObserverRunResult {
	const raw = readSmallJson(path) as unknown;
	if (!raw || typeof raw !== "object" || !Array.isArray((raw as { observations?: unknown }).observations)) {
		throw new Error("observer result missing observations array");
	}
	const observations = (raw as { observations: unknown[] }).observations.filter(isRawObservation);
	return { observations, recorded: (raw as { recorded?: boolean }).recorded === true };
}

export function writeObserverResult(path: string, result: ObserverRunResult): void {
	atomicWrite(path, JSON.stringify({ recorded: true, ...result }));
}
