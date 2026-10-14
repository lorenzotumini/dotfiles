#!/usr/bin/env python3
"""Import the app's shared skill into the chezmoi source, retaining manual invocation."""

import re
from pathlib import Path


def main():
    destination = Path(__file__).resolve().parent
    # Refuse to edit the deployed copy: source changes must precede chezmoi apply.
    if destination == Path.home() / ".pi/agent/skills/manual/tldraw-offline":
        raise SystemExit("Run this script from the chezmoi source directory.")

    upstream = Path.home() / "skills/tldraw-offline"
    content = (upstream / "SKILL.md").read_text()
    match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", content, re.S)
    if not match:
        raise SystemExit("Upstream SKILL.md has no YAML frontmatter; nothing changed.")
    header = re.sub(r"(?m)^disable-model-invocation:.*\n?", "", match[1])
    content = "---\n" + header + "\ndisable-model-invocation: true\n---\n" + content[match.end():]
    content = content.replace("<!-- installed-by:tldraw-desktop-agent-skills -->\n", "")
    content = content.replace("$HOME/skills/tldraw-offline/", "$HOME/.pi/agent/skills/manual/tldraw-offline/")
    # Read all upstream files before changing the source copy.
    helpers = {name: (upstream / name).read_bytes() for name in ("tq.mjs", "inject-server-context.mjs")}
    (destination / "SKILL.md").write_text(content)
    for name, data in helpers.items():
        (destination / name).write_bytes(data)
    print(f"Updated {destination}. Review the diff, then run chezmoi apply.")


if __name__ == "__main__":
    main()
