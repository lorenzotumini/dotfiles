import { truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@mariozechner/pi-tui";
import { fetchAndExtract } from "./fetch.mjs";
import { saveArtifact } from "../web-shared/artifacts.mjs";
const MAX_OUTPUT_BYTES = 24 * 1024;
const MAX_OUTPUT_LINES = 600;
function boundedText(text: string, maxBytes: number, maxLines = MAX_OUTPUT_LINES): string {
    const bytes = Buffer.from(text, "utf8");
    const prefix = bytes.length > maxBytes ? new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true }) : text;
    return truncateHead(prefix, { maxBytes, maxLines }).content;
}

// ── Extension Registration ───────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch a web page as readable markdown (HTML, PDF, or plain text). Output is limited to 24 KiB / 600 lines; full extracted text is saved when truncated (24h / 128 MiB retention). PDF originals are saved for pdf-reader; page coverage is reported separately. Read selected sections from that file, not the whole document at once. Jina fallback is OFF by default; allowJina=true explicitly permits sending the full URL to external Jina Reader after failed/incomplete extraction. Never enable it for private or signed URLs.",
		promptSnippet:
			"Fetch a URL and extract readable content locally as markdown. Supports HTML pages, PDFs, and plain text; external Jina fallback is opt-in.",
		promptGuidelines: [
			"Use web_fetch with allowJina omitted or false by default. Set allowJina=true only when the user explicitly authorizes Jina fallback for the public, non-sensitive URL; do not silently escalate after local extraction fails.",
		],

		parameters: Type.Object({
			url: Type.String({ description: "HTTP(S) URL to fetch" }),
			mode: Type.Optional(Type.Union([Type.Literal("readable"), Type.Literal("raw"), Type.Literal("render")], { description: "readable (default), raw source, or disposable local Chromium for JS pages; render sends subresource requests without debug-profile cookies." })),
			pages: Type.Optional(Type.String({ maxLength: 100, description: "PDF physical pages, e.g. 1-5 or 7,9; default first 20 (maximum 100 per call)." })),
			allowJina: Type.Optional(Type.Boolean({ description: "Opt in to external Jina Reader fallback for this call (default false). Sends the full URL to Jina; use only for public, non-sensitive URLs." })),
		}),

		async execute(_toolCallId, params, signal) {
			const result = await fetchAndExtract(params, signal);

			if (result.error) {
				throw new Error(boundedText(`${params.url}: ${result.error}`, 2048, 20));
			}
			signal?.throwIfAborted();

			const title = boundedText(result.title, 512, 1);
			const url = boundedText(result.url, 2048, 1);
			const header = `${title ? `# ${title}\n\n` : ""}Source: ${url}\n${result.url !== params.url ? `Requested: ${boundedText(params.url, 2048, 1)}\n` : ""}\n---\n\n`;
			const fullText = header + result.content;
			const totalBytes = Buffer.byteLength(fullText, "utf8");
			const totalLines = fullText.split("\n").length;
			const truncated = totalBytes > MAX_OUTPUT_BYTES || totalLines > MAX_OUTPUT_LINES;
			let text = fullText;
			let fullOutputPath: string | undefined;
			if (truncated) {
				fullOutputPath = await saveArtifact(fullText, "md", signal);
				const notice = `\n\n[Output truncated: full extracted text is ${totalBytes} bytes / ${totalLines} lines.\nSaved to: ${fullOutputPath}\nUse read with offset/limit, or search the file for the relevant section. Do not load the whole file into context.]`;
				text = boundedText(fullText, MAX_OUTPUT_BYTES - Buffer.byteLength(notice), MAX_OUTPUT_LINES - 5) + notice;
			}
			return {
				content: [
					{
						type: "text" as const,
						text,
					},
				],
				details: {
					url,
					requestedUrl: boundedText(params.url, 2048, 1),
					...result.details,
					title,
					chars: result.content.length,
					totalBytes,
					truncated,
					fullOutputPath,
				},
			};
		},

		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);
			const { url } = args as { url?: string };
			if (!url) {
				text.setText(
					theme.fg("toolTitle", theme.bold("fetch ")) +
						theme.fg("error", "(no URL)"),
				);
				return text;
			}
			const display =
				url.length > 70 ? url.slice(0, 67) + "..." : url;
			text.setText(
				theme.fg("toolTitle", theme.bold("fetch ")) +
					theme.fg("accent", display),
			);
			return text;
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ??
				new Text("", 0, 0);

			if (isPartial) {
				text.setText(theme.fg("warning", "Fetching…"));
				return text;
			}

			if (context.isError) {
				const msg =
					result.content.find((c) => c.type === "text")?.text ||
					"Error";
				text.setText(theme.fg("error", msg));
				return text;
			}

			const details = result.details as {
				title?: string;
				chars?: number;
				truncated?: boolean;
				fullOutputPath?: string;
			};

			const title = details?.title || "Untitled";
			const chars = details?.chars ?? 0;
			const status =
				theme.fg("success", title) +
				theme.fg("muted", ` (${chars} chars)`) +
				(details?.truncated ? theme.fg("warning", " [truncated; full text saved]") : "");

			if (!expanded) {
				text.setText(status);
				return text;
			}

			const content =
				result.content.find((c) => c.type === "text")?.text || "";
			const preview =
				content.length > 500
					? content.slice(0, 500) + "..."
					: content;
			text.setText(status + "\n" + theme.fg("dim", preview));
			return text;
		},
	});
}
