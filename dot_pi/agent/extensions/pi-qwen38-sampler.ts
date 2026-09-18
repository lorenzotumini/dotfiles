import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type RequestBody = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQwen38(model: { provider?: string; id?: string } | undefined): boolean {
	return model?.provider === "llama.cpp" && /qwen3\.8-27b/i.test(model.id ?? "");
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		if (!isQwen38(ctx.model)) return;
		if (!isRecord(event.payload) || !Array.isArray(event.payload.messages)) return;

		const level = String(ctx.thinkingLevel ?? pi.getThinkingLevel?.() ?? "medium");
		const thinking = level !== "off";
		const next: RequestBody = { ...event.payload };

		// Qwen3.8's recommended samplers differ between thinking and direct mode.
		Object.assign(
			next,
			thinking
				? {
					 temperature: 1.0,
					 top_p: 0.95,
					 top_k: 20,
					 min_p: 0.0,
					 presence_penalty: 0.0,
				}
				: {
					 temperature: 0.7,
					 top_p: 0.8,
					 top_k: 20,
					 min_p: 0.0,
					 presence_penalty: 1.5,
				},
		);

		// Set these explicitly so the extension remains correct even if the Pi
		// model override still has the older qwen-chat-template compatibility mode.
		const effort =
			level === "off"
				? "none"
				: level === "xhigh" || level === "max"
					? "xhigh"
					: level === "medium" || level === "high"
						? "medium"
						: "low";
		next.reasoning_effort = effort;
		next.chat_template_kwargs = {
			...(isRecord(next.chat_template_kwargs) ? next.chat_template_kwargs : {}),
			enable_thinking: thinking,
			preserve_thinking: true,
		};

		return next;
	});
}
