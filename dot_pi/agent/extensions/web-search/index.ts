import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { buildQuery, search } from "./exa.mjs";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search via Exa's free hosted endpoint (no API key; rate limited). Returns source URLs, titles and excerpts. Output capped at 16 KiB / 400 lines, with no hidden full copy. exactPhrases, excludeTerms and site compose query hints, not guaranteed strict filters: verify returned sources. Queries go to Exa; do not include secrets.",
		promptSnippet:
			"Search the web with Exa free search. Use web_fetch to read selected source URLs; browser tools are for interactive pages.",
		promptGuidelines: [
			"Use one web_search call per search angle. Use exactPhrases for quoted query hints; verify matches because Exa is not Google's query engine.",
			"Keep web_search queries free of secrets. Respect rate-limit errors; do not retry in a loop. Fetch only relevant URLs rather than collecting large excerpts.",
		],
		parameters: Type.Object({
			query: Type.Optional(Type.String({ maxLength: 2000, description: "Base query. At least query or exactPhrases is required." })),
			exactPhrases: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), {
				maxItems: 10, description: "Quoted phrase hints; exact matching is best-effort, not guaranteed.",
			})),
			excludeTerms: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), {
				maxItems: 10, description: "Excluded term/phrase hints; verify results rather than assuming strict filtering.",
			})),
			site: Type.Optional(Type.String({ maxLength: 2048, description: "Domain or HTTP(S) URL used as a site: query hint; verify returned domains." })),
			count: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Requested number of results (default 5); actual count may differ." })),
		}),
		async execute(_id, params, signal) {
			return search(params, signal);
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			let display: string;
			try {
				const built = buildQuery(args);
				display = built.query.length > 100 ? built.query.slice(0, 97) + "..." : built.query;
			} catch {
				display = "(incomplete or invalid query)";
			}
			text.setText(theme.fg("toolTitle", theme.bold("search · Exa ")) + theme.fg("accent", display));
			return text;
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const content = result.content.find(c => c.type === "text")?.text ?? "";
			if (isPartial) text.setText(theme.fg("warning", "Searching Exa…"));
			else if (context.isError) text.setText(theme.fg("error", content));
			else {
				const details = result.details as { truncated?: boolean } | undefined;
				const status = theme.fg("success", "Exa search complete") + (details?.truncated ? theme.fg("warning", " [truncated]") : "");
				text.setText(status + (expanded ? "\n" + theme.fg("dim", content.slice(0, 500)) : ""));
			}
			return text;
		},
	});
}
