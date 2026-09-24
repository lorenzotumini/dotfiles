# Local llama.cpp profiles

`models.json` is the source of truth for model files, runtime profiles, and Pi
request policies. This directory and `../extensions/local-llama.ts` are managed
by chezmoi. No package installation is required: use the Node 22+ already used
by Pi, Pi 0.85.1+, and the installed CUDA-enabled `llama-server` (validated with
build 10964). Process management currently targets Linux.

## Everyday use

After applying chezmoi, restart Pi or run `/reload`, then:

```text
/local                         Pick, load, and select a profile
/local:status                  Show router model states
/local:reload                  Apply edited presets to the managed router
/local:cancel                  Cancel a pending load
/local:unload                  Unload all idle models, freeing VRAM and model-file mappings
```

Use the picker to select profiles; discrete actions use colon commands.

The status bar shows the latest llama.cpp prefill and generation throughput.
Rates are calculated from server metrics around each local model response; if
multiple Pi sessions send requests to the shared router at once, a sample can
include nearby traffic from another session.

Selecting a profile starts the static `pi-local-llama.service` user unit
automatically if nothing is listening. The router stays available across Pi
restarts and project changes, then systemd stops it when the user manager shuts
down, releasing model mappings before system shutdown unmounts filesystems.
The user must not enable lingering for this shutdown lifecycle. One model is
resident at a time; selecting another lets the router replace the idle model.
Busy models are checked before switching. Pi's existing `/llama` command
remains available.

`/local:unload` unloads every idle model but keeps the router available.
Select a profile again to reload it. `~/.pi/agent/local-llama/start.sh stop`
stops the whole managed service and releases all model resources.

The service unit is tracked at `agent/local-llama/pi-local-llama.service`.
Install or refresh it after changing the unit:

```bash
install -Dm644 ~/.pi/agent/local-llama/pi-local-llama.service ~/.config/systemd/user/pi-local-llama.service
systemctl --user daemon-reload
```

Existing installations already containing `~/.config/systemd/user/pi-local-llama.service`
can apply this update directly. The service remains static (started on demand),
so it does not start the large model router at login.
`/local` sets the profile's default thinking level; Shift+Tab can then change it.
The status line shows context and thinking mode, and Pi shows the model ID.

The integration uses the registry's loopback address and API key file for the
native llama.cpp provider. An existing `/login llama.cpp` entry is preserved,
but its connection settings are superseded while this extension is enabled.
No credentials are written into the registry, generated INI, or Pi models file.

Available initial profiles:

| ID | Context | Placement | Default thinking |
| --- | ---: | --- | --- |
| `qwen3.5-4b` | 32K | CUDA0 / 3070 Ti | off |
| `qwen3.8-27b-gsq` | 64K | Both GPUs | medium |
| `qwen3.8-27b-q4` | 64K | Both GPUs | medium |
| `qwen3.8-27b-gsq-long` | 128K | Both GPUs, Q4 KV, text only | medium |
| `qwen3.8-27b-orca` | 64K | Both GPUs | off |

These are starting configurations, not benchmark winners. The first three
keep their previous model IDs for existing sessions. OrcaRouter is a separate
optional choice; selecting it does not affect the normal models. MTP is enabled
only for the two artifacts previously confirmed to contain an embedded head.
Other profiles explicitly associate the existing vision projector with the
weights. Images consume additional context and memory.

## Launcher

```bash
~/.pi/agent/local-llama/start.sh check    # Validate config, paths, key readability
~/.pi/agent/local-llama/start.sh         # Foreground router; Ctrl+C stops it
~/.pi/agent/local-llama/start.sh ensure  # Start in background if absent
~/.pi/agent/local-llama/start.sh status
~/.pi/agent/local-llama/start.sh reload  # Reload changed runtime profiles
~/.pi/agent/local-llama/start.sh stop    # Stop only a router owned by this launcher
```

If another router already occupies port 8080, stop it in its original terminal.
The launcher will not kill unrelated processes or pretend their presets match.

Generated INI, logs, PID identity, startup lock, and the isolated llama.cpp cache
live in `~/.cache/pi-local-llama/`. Model weights remain on the SSD. The API key
remains at `~/.config/llama/api-key`. A missing/empty key fails explicitly.
An interrupted start can leave `start.lock`; remove that empty directory only
after confirming no start operation is in progress.

## Editing and adding models

In the chezmoi source, edit `dot_pi/agent/local-llama/models.json`, then apply
that file. Run `/local:reload` and select the desired profile. Runtime changes
may unload an affected model; reload refuses while a loaded model is busy.
Changes to the server binary, address, port, or credentials require stopping
the old managed router before applying the edit, then starting it again.

1. Add a `models` entry with an absolute `path` and an explicit `policy`.
   Add the matching `projector` only if available. `source` records optional
   provenance; keep revision/checksum information when known. There is no
   downloader or automatic model update in this integration.
2. Reuse a policy only if the new model actually supports its template controls
   and sampling settings. Otherwise add a policy with `thinking` set to
   `none`, `toggle`, or `effort`. List supported Pi levels and hard token budgets.
   `none` uses only `off`. Unsupported levels are hidden rather than guessed.
3. Add a profile with a unique stable `id`, model reference, context, output
   limit, default thinking, vision flag, and runtime options. Multiple profiles
   can refer to the same model file without copying weights.
4. Run `start.sh check`, apply/reload, and perform a short functional check.

`runtimeDefaults` contains shared defaults; profile `runtime` overrides them.
Use llama.cpp's canonical long option names without `--`. Supported options are
allowlisted in `core.mjs`; extend that list deliberately for additional runtime
features. Model paths and context are generated from dedicated fields. Router
CLI flags never impose per-model device, context, sampling, or cache settings.
Inherited `LLAMA_ARG_*` variables are removed when launching to avoid hidden
overrides. GPU numbering should be checked if hardware changes.

`maxOutput` limits thinking plus answer tokens. Each thinking budget is capped
to leave at least 1024 answer tokens when the requested output limit allows it.
Qwen3.8 uses native off/low/medium/xhigh effort controls; Qwen3.5 uses a boolean
thinking switch with budget-based low/medium/high levels. Its thinking sampler
uses Qwen's precise-coding recommendation. Policies set llama.cpp's
`repeat_penalty`, not the Transformers spelling `repetition_penalty`.

Do not duplicate managed IDs in `~/.pi/agent/models.json`: those overrides take
priority over provider metadata. Keep managed model settings in the central
registry instead.

Profile fingerprints and effective server context are checked before requests.
A mismatch aborts the turn with an actionable error. This also catches using a
restored Pi session after another session unloads its model. Run `/local` to
select/reload it. Multiple simultaneous model workloads are not a goal of this
initial single-resident-model setup.

## Verification

From the chezmoi `dot_pi` directory:

```bash
node --experimental-strip-types agent/tests/local-llama.mjs
node --experimental-strip-types agent/local-llama/smoke.mjs qwen3.5-4b qwen3.8-27b-gsq
```

The first command tests validation, profile independence, request mapping,
context mismatch rejection, and Pi's fail-closed hook behavior. The second uses
the installed Pi SDK and local server, changes the loaded profile, runs short
streamed completions, a synthetic tool round trip on 4B, and render-only thinking
template checks on Qwen3.8. It writes isolated metadata to a temporary directory,
does not use real conversation history, and does not download weights.

References: [Qwen3.5 settings](https://huggingface.co/Qwen/Qwen3.5-4B),
[Qwen3.8 settings](https://huggingface.co/Qwen/Qwen3.8-27B), and
[llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).
