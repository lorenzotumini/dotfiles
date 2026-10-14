# tldraw offline Pi skill

This skill is managed with the Pi configuration in chezmoi. Edit this copy and
run `chezmoi apply` to deploy it to `~/.pi/agent/skills/manual/tldraw-offline`.

Pi loads it only through `/skill:tldraw-offline`, because its frontmatter sets
`disable-model-invocation: true`.

tldraw Desktop overwrites `~/.pi/agent/skills/tldraw-offline/SKILL.md` when the
app updates. That directory is no longer managed by chezmoi and is excluded
from Pi discovery by `~/.pi/agent/skills/.ignore`. The manual copy lives at a
different path so the app cannot overwrite its frontmatter or instructions.

After updating tldraw, import its shared skill and helpers into the chezmoi
source with:

```bash
python3 "$(chezmoi source-path ~/.pi/agent/skills/manual/tldraw-offline)/update-from-app.py"
chezmoi diff --recursive ~/.pi/agent/skills/manual/tldraw-offline
chezmoi apply --recursive ~/.pi/agent/skills
```

The importer uses `~/skills/tldraw-offline`, restores the manual-invocation flag,
and adjusts helper paths to the managed Pi directory. Run it from the source
copy; it refuses to run from the deployed copy. Restart Pi or use `/reload`
after applying. Other agents' app-managed skills are unaffected.
