# Local llama.cpp profile review — 2026-09-24

Hardware: CUDA0 RTX 3070 Ti, 8192 MiB; CUDA1 RTX 5060 Ti, 16311 MiB;
32 GB system RAM. Runtime: llama.cpp build 10964, b29c606e28.
The display uses CUDA0. Available memory varies with desktop applications.

## Decisions

Use Qwen3.6 MoE for fast coding/agent turns, Qwen3.8 Q4 for harder coding,
Gemma 31B for conversation, and 4B for lightweight work. These are starting
role assignments, not a measured ranking of coding quality. Compare them on
actual repository tasks before removing a model. All existing profile IDs are
preserved; descriptive picker names now include purpose and context.

The two cards are separate memory pools. Combined weight size below 24 GB does
not establish fit: KV, computation, speculative decoding, projector, display,
and driver allocations must fit on each card. Use explicit tensor splits and
place the large vision projector on CUDA1. Text profiles omit the projector.
Shared settings: all layers on GPU, flash attention, batch 512, micro-batch 128,
one slot per model, four context checkpoints, and 1024 MiB CPU prompt cache.

Qwen3.6 Q4_K_S is a reasonable choice: the existing weights are 20,893,015,008
bytes (19.46 GiB). The publisher lists Q4_K_M at approximately 22.1 GB versus
20.9 GB for Q4_K_S. The extra roughly 1.2 GB would consume most of the measured
working margin and force less context or other compromises. Keep Q4_K_S for
this setup. An IQ4_XS variant around 17.7 GB is an optional experiment if more
memory headroom becomes the priority; its quality has not been evaluated here.
[Quantization files](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/tree/main).

## MTP and sampling

- The inspected Unsloth Qwen3.8 Q4 and GSQ artifacts contain an embedded MTP
  head. The Q4 profile enables it; the GSQ profiles disable it to retain memory
  for context or single-card use. Embedded does not mean zero runtime overhead.
- The inspected Qwen3.6 Q4_K_S has no MTP head. Unsloth offers a replacement full
  MTP GGUF, so a separate drafter is not mandatory if choosing that packaging.
  This setup keeps the already downloaded non-MTP model. MoE MTP speedup was
  not measured: lower benefit is a workload-dependent expectation, not a rule.
  [MTP variants](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF).
- Gemma's separate assistant is correct. The local file is 514,687,104 bytes;
  its runtime overhead includes more than the weights. The text profile uses
  it and the vision profile disables it. Use an assistant compatible with the
  target, especially if later switching to QAT weights.
  [Google assistant documentation](https://huggingface.co/google/gemma-4-31B-it-assistant).
- Qwen3.6 uses the documented precise-coding thinking sampler: temperature 0.6,
  top-p 0.95, top-k 20, min-p 0, presence penalty 0. Its thinking control is a
  boolean switch with local token budgets, not Qwen3.8's effort control.
  [Qwen3.6 recommendations](https://huggingface.co/Qwen/Qwen3.6-35B-A3B).
- Qwen3.8 uses temperature 1, top-p 0.95, top-k 20 in thinking mode; native
  effort levels are off/low/medium/xhigh. Its non-thinking sampler is 0.7/0.8/20.
  [Qwen3.8 recommendations](https://huggingface.co/Qwen/Qwen3.8-27B).
- Gemma uses temperature 1, top-p 0.95, top-k 64. Conversation defaults to
  thinking off. Historical thinking is not requested for later user turns;
  the model template controls formatting and tool-turn handling.
  [Gemma best practices](https://huggingface.co/google/gemma-4-31B).

## Earlier capacity and speed measurements

The following values were captured from the earlier calibration in this
conversation. The temporary raw logs did not survive the interruption/restart.
Each used a 36–37-token synthetic Python prompt, greedy decoding, thinking off,
and at most 160 output tokens. They measure short-output throughput, not
reasoning quality, realistic agent latency, or speed at a full context window.
Free VRAM was sampled after generation, not continuously at peak usage.

| Profile configuration | Output tok/s | Free CUDA0 / CUDA1, MiB |
| --- | ---: | ---: |
| FAST 128K, Q8 KV, CUDA0 | 111 | 1609 / 15804 |
| CODE FAST 96K, Q8 KV, split 2:5, no MTP | 106 | 709 / 856 |
| CODE DEEP 96K, Q8 KV, split 1:2, MTP 2 | 53 | 917 / 1376 |
| CHAT 32K, Q8 KV, split 2:5, MTP 2 | 49 | 701 / 650 |
| Same Gemma text configuration without MTP | 22 | 939 / 1350 |
| LONG 256K, Q4 KV, split 1:2, no MTP | 30 | 977 / 3304 |
| AGENT SOLO 96K, Q8 KV, CUDA1, no MTP | 30 | 7023 / 844 |
| SECURITY 128K, Q8 KV, split 2:5 | 25 | 943 / 898 |
| VISION FAST 64K, Q8 KV, CUDA0 | 116 | 1919 / 15804 |

Gemma MTP approximately doubled throughput on this particular prompt. This
supports retaining it for text, but does not predict an equal improvement on
all workloads. Qwen3.8 MTP worked; an exact on/off comparison was not run.

Rejected configurations included 256K GSQ with Q8 KV (loaded, then failed during
generation), Gemma 64K Q8 with the tested splits, and configurations leaving
only tens or a few hundred MiB free. Qwen3.6 128K Q8 loaded and generated, but
96K provides more margin. Qwen3.8 Q4 128K with MTP left only 240 MiB on CUDA1;
96K provides more useful working room. These are not proofs that no alternative
split, quantization, CPU offload, or smaller compute batch could fit more.

## Context and concurrency

96K means 98,304 total tokens, shared by prompt, history, tool definitions,
thinking, and output. With 32K reserved output, roughly 64K remains for input;
the exact client compaction threshold can be lower. Set a smaller output cap
if a task primarily needs reading space. Do not confuse allocated context with
validated comprehension across the entire window.

The LONG profile reaches the models' native 256K limit without extrapolation,
using IQ3 weights and Q4 KV. Both are precision compromises. Prefer Q4 weights
and Q8 KV for everyday coding; use LONG when the input actually requires it.
Full-window accuracy and performance have not been evaluated. Targeted file
reads, tool output limits and compaction remain useful for long agents.

`maxModels = 2` permits FAST or VISION FAST on CUDA0 to coexist with AGENT SOLO
on CUDA1. Select each in a different Pi session. Switching to a two-card model
unloads conflicting idle profiles. Busy conflicting models block switching.
The extension serializes residency changes across Pi processes and rejects
stale loaded settings. Native `/llama` or direct router calls bypass that policy.

## Further models to evaluate

1. **Gemma 4 12B QAT Q4_0** is the first additional download I would evaluate
   for the 16 GB card: the official GGUF is 6.98 GB, plus a 175 MB projector.
   It leaves substantially more space than the 27B IQ3 model for context and
   working buffers. Fit and speed still require local calibration. It may be
   a useful daily chat/vision model while 4B runs on CUDA0.
   [Official files](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/tree/main).
2. **Qwen3.5 9B**, at a sensible Q4/Q5 quantization, is another candidate for
   a more lightly quantized single-card coding assistant. Compare tool use
   and actual task success against the existing GSQ 27B before choosing.
   [Official model](https://huggingface.co/Qwen/Qwen3.5-9B).

The existing models already cover the requested roles. No further weights were
downloaded. “Uncensored” describes refusal behavior; it does not demonstrate
better security analysis. The security profile is retained as an option, while
the regular coding models remain candidates for security code review.

## Final verification

The resumed run passed for all nine configured profiles through Pi's actual
`/local` picker and native streaming provider. Source and installed files were
compared after the user's `chezmoi update`; no unrelated changes were replaced.

- 12 unit tests passed, including external drafter wiring, disjoint GPU
  placement, residency locking and router option alias normalization.
- All nine profiles loaded at their configured context and passed streaming
  chat plus a forced tool-call/result round trip.
- All seven text profiles retrieved a key from 15,313–15,315-token synthetic
  prompts. This is a limited integration probe, not a full-window evaluation.
- FAST and AGENT SOLO remained resident and completed simultaneous requests.
  Subsequent two-card selections successfully unloaded conflicting profiles.
- Both vision profiles processed a synthetic red image correctly. Gemma 16K
  vision used split 3:7, Q8 KV, CUDA1 projector and no MTP. After the image
  probe, free VRAM was 1233 MiB on CUDA0 and 848 MiB on CUDA1.
- All Qwen3.8 effort levels passed template rendering checks. Gemma's thinking
  on/off switch was also confirmed against the loaded vision template.
- The router reports several canonical flags under legacy aliases; verification
  now accepts those aliases while still checking their values and rejecting
  conflicting duplicates.

The complete resumed transcript is in
[the smoke log](2026-09-24-local-llama-smoke.log). Reproduce the integration run
from this directory's parent with:

```sh
PI_LOCAL_SMOKE_LONG=1 node --experimental-strip-types agent/local-llama/smoke.mjs \
  qwen3.5-4b qwen3.8-27b-gsq-solo qwen3.6-35b-a3b qwen3.8-27b-q4 \
  gemma-4-31b qwen3.8-27b-gsq qwen3.8-27b-orca \
  qwen3.5-4b-vision gemma-4-31b-vision
```

The script now also includes toggle-template checks for subsequent runs.
No broad coding benchmark, autonomous security task, or full-context accuracy
suite was run. The tested tool calls were explicitly required; this does not
measure a model's ability to choose the right tools independently.

The idle test router was stopped after verification, returning the GPUs to the
pre-test state. `/local` starts it on demand. The changes are applied locally
and remain uncommitted.
