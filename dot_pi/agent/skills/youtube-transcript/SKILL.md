---
name: youtube-transcript
disable-model-invocation: true
description: Fetch the transcript and title of a YouTube video as JSON. Use when the user provides a YouTube URL and you need the spoken content (captions) for analysis, summarization, quoting, or search.
---

# YouTube Transcript

Fetches a YouTube video's title and full transcript by pulling captions via `yt-dlp`. Prefers manual English subtitles, falls back to auto-generated English.

## Requirements

- `yt-dlp` on PATH (already installed here; on Arch: `sudo pacman -S yt-dlp`, on macOS: `brew install yt-dlp`)
- Python 3

## Usage

Save the JSON to a private temporary file first, rather than dumping a potentially
long transcript into the agent context:

```bash
out=$(mktemp /tmp/pi-youtube-XXXXXX.json)
python3 ~/.pi/agent/skills/youtube-transcript/fetch_transcript.py "<youtube_url>" > "$out" && printf 'Transcript saved to: %s\n' "$out"
```

Inspect the title, transcript length and a short excerpt first. For long videos,
read/search selected transcript sections with a small Python script; the transcript
is stored as one JSON string, so line-based limits alone are not enough. Do not
print the full JSON or transcript unless its size is known to be small. Delete the
temporary output when it is no longer needed.

## Output

Prints a JSON object to stdout:

```json
{
  "title": "Video title",
  "transcript": "full transcript text as a single string"
}
```

Progress/info logs go to stderr. On failure (no English captions, network error, bad URL), the script exits non-zero with a message on stderr.

## Notes

- Only English captions are attempted (`en`, `en-US`, `en-GB`, then any `en*`). Manual captions are preferred over auto-generated.
- Transcript is plain text with timing/formatting stripped — not timestamped.
- For non-English videos or missing captions, ask the user for a transcript or another source. No `video_extract` fallback is installed.
- Downloads only one video's subtitles (`--no-playlist`), with a 60-second timeout per yt-dlp subprocess and bounded retry settings. Metadata and subtitle retrieval are separate calls.
- Uses `--ignore-config` so personal yt-dlp configuration cannot unexpectedly trigger downloads or hooks. It does not automatically import browser cookies or credentials.
- Network/rate-limit/bot challenges can still prevent retrieval. Report the failure; do not retry indefinitely or bypass access controls.
- The script's stdout contract remains full `{title, transcript}` JSON. Context protection depends on saving it to a file as instructed above.
