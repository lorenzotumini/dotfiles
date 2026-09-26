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
The user must not enable lingering for this shutdown lifecycle. Up to two models may remain resident when they use disjoint GPUs.
The vision-enabled FAST profile on CUDA0 can coexist with AGENT SOLO on CUDA1.
Selecting a profile that uses both cards unloads conflicting idle models; a
busy conflicting model blocks the switch. Use `/local` for this placement
policy: the native `/llama` command bypasses these checks.

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

Available profiles (K = 1024 tokens; context includes input, thinking and output):

| Role / stable ID | Context | Placement | Thinking / MTP |
| --- | ---: | --- | --- |
| FAST / `qwen3.5-4b` | 96K | 3070 Ti, Q8 KV, vision | off / off |
| CODE FAST / `qwen3.6-35b-a3b` | 96K | Both, Q8 KV | medium / off |
| CODE DEEP / `qwen3.8-27b-q4` | 128K | Both, Q5 KV | medium / on |
| CHAT / `gemma-4-31b` | 40K | Both, Q5 KV, projector and MTP drafter on 5060 Ti | off / on |
| LONG / `qwen3.8-27b-gsq` | 256K | Both, Q4 KV | medium / off |
| AGENT SOLO / `qwen3.8-27b-gsq-solo` | 128K | 5060 Ti, Q5 KV | medium / off |
| SECURITY / `qwen3.8-27b-orca` | 128K | Both, Q8 KV | medium / off |

Start with CODE FAST for routine agent work, CODE DEEP for harder coding,
and CHAT for general conversation. These role assignments are recommendations,
not measured quality rankings. SECURITY uses the downloaded lower-refusal Orca
fine-tune; lower refusal does not establish security expertise or accuracy.
LONG maximizes allocated context with IQ3 weights and Q4 KV, trading precision
for space. The Q4-weight, Q8-KV coding profile is the more conservative daily
choice. FAST includes vision so it can share the system with AGENT SOLO on the 5060 Ti. CHAT supports images and uses the paired Gemma MTP assistant. Q5 KV makes the larger CODE DEEP, CHAT, and AGENT SOLO windows fit with about 1 GiB or more free on their tightest card in a short, isolated probe; Q8 KV retains slightly more cache precision.

Calibrated on RTX 3070 Ti 8 GB + RTX 5060 Ti 16 GB with llama.cpp build 10964.
The display cable was connected to the 3070 Ti (CUDA0); its idle desktop allocation was about 630 MiB, versus 2 MiB on the 5060 Ti (CUDA1). Keep the display on CUDA0 for these profiles: AGENT SOLO and Gemma MTP use most of CUDA1, and moving the display there would likely leave too little margin. If the cable moves, check `nvidia-smi` and recalibrate the splits before relying on the largest contexts. See [the current audit](../../audits/2026-09-26-local-llama.md) for measurements and test limits; [the earlier audit](../../audits/2026-09-24-local-llama.md) records the prior profiles.
A large allocated window is not a guarantee of reliable retrieval across that
entire window. Prefill time grows with history; use compaction and targeted file
reads in long-running agents. Keep `parallel = 1` per model so its context is
not divided among slots. Two Pi sessions can use the disjoint GPU profiles.

Qwen3.8 Q4 contains an embedded MTP head; no separate download is needed.
Your Qwen3.6 Q4_K_S file has no MTP head. The Unsloth MTP variant is a replacement
full GGUF with the head included; this configuration intentionally uses the
existing non-MTP file. Gemma uses the separate assistant via `spec-draft-model`
with MTP enabled. On this llama.cpp build and layer split, placing its drafter on CUDA0 failed; explicit CUDA1 placement worked. Its benefit was measured locally, while MoE MTP was
not benchmarked. MoE does not universally benefit less: speedup depends on
hardware, prompt, acceptance rate, and verification cost.

Shared micro-batch size is 128, with four context checkpoints and 1 GiB of CPU
prompt cache per process. This saves working memory on the 8 GB card and host
RAM for dual residency; lower micro-batches may reduce prefill throughput.
Tensor splits differ by model to balance actual per-card allocation. These
profiles require the cards to have similar free VRAM to the calibration run.

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
Changes to the server binary, address, port, credentials, or `maxModels` require stopping
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
   For a separate MTP file, set `draftPath` on the model and select
   `spec-type: draft-mtp` in the profile; the router supplies it as
   `spec-draft-model`.

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
thinking switch with budget-based low/medium/high levels, as does Qwen3.6. Their thinking sampler
uses Qwen's precise-coding recommendation. Policies set llama.cpp's
`repeat_penalty`, not the Transformers spelling `repetition_penalty`.

Do not duplicate managed IDs in `~/.pi/agent/models.json`: those overrides take
priority over provider metadata. Keep managed model settings in the central
registry instead.

Profile fingerprints and effective server context are checked before requests.
A mismatch aborts the turn with an actionable error. This also catches using a
restored Pi session after another session unloads its model. Run `/local` to
select/reload it. Use two Pi sessions for simultaneous workloads on the two single-GPU profiles.
Loading, unloading, and reloading are serialized across sessions through
`model-operation.lock`. If the owning Pi process crashes, confirm it has exited
and remove that empty directory in the cache directory before retrying.

## Verification

From the chezmoi `dot_pi` directory:

```bash
node --experimental-strip-types agent/tests/local-llama.mjs
node --experimental-strip-types agent/local-llama/smoke.mjs qwen3.5-4b qwen3.8-27b-gsq
```

The first command tests validation, profile independence, request mapping,
context mismatch rejection, disjoint placement, operation locking, external
drafter wiring, and Pi's fail-closed hook behavior. The second uses
the installed Pi SDK and local server, changes the loaded profile, runs short
streamed completions, a synthetic tool round trip per profile, and render-only thinking
template checks on Qwen3.8. It writes isolated metadata to a temporary directory,
does not use real conversation history, and does not download weights.
It also checks simultaneous completions when both single-GPU profiles are
loaded, and synthetic image input for vision profiles. Set
`PI_LOCAL_SMOKE_LONG=1` to include roughly 15K-token retrieval probes.
The smoke command changes model residency; run it when local sessions are idle.

References: [Qwen3.5 settings](https://huggingface.co/Qwen/Qwen3.5-4B),
[Qwen3.8 settings](https://huggingface.co/Qwen/Qwen3.8-27B), and
[llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).
