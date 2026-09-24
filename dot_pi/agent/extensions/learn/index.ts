import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import mdLog from "./md-log.ts";
import quiz from "./quiz.ts";
import { fileURLToPath } from "node:url";

const STATE_KEY = "learn-mode";
const QUIZ_TOOL = "quiz";
const TEACH_GUIDE = fileURLToPath(new URL("./teach.md", import.meta.url));

export default function learnMode(pi: ExtensionAPI): void {
	quiz(pi);
	mdLog(pi);
	let enabled = false;

	function setEnabled(want: boolean): void {
		enabled = want;
		const active = new Set(pi.getActiveTools());
		if (enabled) active.add(QUIZ_TOOL);
		else active.delete(QUIZ_TOOL);
		pi.setActiveTools([...active]);
	}

	function restore(ctx: ExtensionContext): void {
		let want = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_KEY) continue;
			const data = entry.data as { on?: boolean } | undefined;
			if (typeof data?.on === "boolean") want = data.on;
		}
		setEnabled(want);
	}

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", () => { enabled = false; });

	pi.on("before_agent_start", (event) => {
		if (!enabled) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nLearning mode is on. For learning or teaching requests, read and follow the teaching guide at ${TEACH_GUIDE}. Use the quiz tool for graded knowledge checks. Do not force the learning workflow onto unrelated requests.`,
		};
	});

	pi.registerCommand("learn", {
		description: "Toggle learning mode and graded quiz access; /learn:status shows the current state",
		handler: async (args, ctx) => {
			if (args.trim()) {
				if (ctx.hasUI) ctx.ui.notify("Use /learn to toggle, or /learn:status to inspect state.", "warning");
				return;
			}
			setEnabled(!enabled);
			pi.appendEntry(STATE_KEY, { on: enabled });
			if (ctx.hasUI) ctx.ui.notify(`Learning mode ${enabled ? "on" : "off"}.`);
		},
	});

	pi.registerCommand("learn:status", {
		description: "Show whether learning mode is enabled",
		handler: async (args, ctx) => {
			if (args.trim()) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /learn:status", "warning");
				return;
			}
			if (ctx.hasUI) ctx.ui.notify(`Learning mode ${enabled ? "on" : "off"}.`);
		},
	});
}
