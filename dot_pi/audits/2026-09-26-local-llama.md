# Local llama.cpp calibration — 2026-09-26

Hardware: RTX 3070 Ti 8 GiB (CUDA0, display enabled), RTX 5060 Ti 16 GiB
(CUDA1, display disabled), 32 GiB host RAM. Runtime: llama.cpp build 10964.
Idle VRAM used before each isolated run was approximately 628 MiB on CUDA0
and 2 MiB on CUDA1. The display cable was connected to CUDA0. The previous
profiles and findings are in [the September 24 audit](2026-09-24-local-llama.md).

## Method and limits

The managed router was stopped for isolated trials. Each trial launched a
single `llama-server` with the target weight, projector when applicable, full
GPU offload, flash attention, one slot, batch 512, micro-batch 128, four context
checkpoints, and the profile's cache quantization and device placement. A
37-token synthetic Python request generated 160 tokens with temperature 0 and
thinking off. Vision trials then sent a synthetic 128×128 red PNG. `nvidia-smi`
free VRAM was sampled after completion, not at peak usage. Speed is llama.cpp
reported output tokens per second for that short response. These runs establish
load, generation, and image viability; they do not establish full-window
retrieval accuracy, sustained peak memory margin, coding quality, or a typical
speedup under the production sampler.

| Configuration tested | Output tok/s | Free CUDA0 / CUDA1, MiB | Result |
| --- | ---: | ---: | --- |
| FAST 96K vision, Q8 KV, CUDA0 | 110.3 | 1259 / 15937 | Image passed |
| CODE FAST 128K, Q5 KV, split 2:5 | 104.5 | 693 / 858 | Fit; retain 96K Q8 for coding precision |
| CODE DEEP 128K, Q5 KV, MTP 2, split 5:11 | 52.2 | 1193 / 1072 | Fit |
| CHAT QAT 16K vision, Q8 KV, no MTP, split 3:7 | 23.1 | 1505 / 1850 | Image passed |
| CHAT QAT 16K vision, Q8 KV, MTP 2 on CUDA1, split 3:7 | 55.6 | 1505 / 1440 | Image passed |
| CHAT QAT 32K vision, Q8 KV, MTP 2 on CUDA1, split 3:7 | 56.0 | 1157 / 688 | Fit, tight on CUDA1 |
| CHAT QAT 40K vision, Q5 KV, MTP 2 on CUDA1, split 5:11 | 54.1 | 991 / 1124 | Selected; image passed |
| CHAT QAT 40K vision, Q8 KV, MTP 2 on CUDA1, split 5:11 | 54.4 | 747 / 580 | Fit, less margin |
| CHAT QAT 48K vision, Q5 KV, MTP 2 on CUDA1, split 5:11 | 54.1 | 853 / 832 | Fit, less margin |
| LONG 256K, Q4 KV, split 1:3 | 29.2 | 2067 / 2286 | Fit |
| AGENT SOLO 128K, Q5 KV, CUDA1 | 29.9 | 7227 / 1156 | Fit |

The first audit measured the old CODE FAST 96K Q8 setup at 106 tok/s with
709 / 856 MiB free; the 128K Q5 trial has almost the same memory margin and
speed. Since CODE DEEP and AGENT SOLO now cover longer agent contexts, CODE
FAST stays at 96K Q8. The first audit's CODE DEEP 96K Q8 setup measured 53
tok/s with 917 / 1376 MiB free. The new 128K Q5 split balances the cards more
evenly. Moving LONG from split 1:2 to 1:3 raised display-card free VRAM from
about 977 to 2067 MiB at the same 256K context, with similar short-output
speed. Actual margin can change with desktop VRAM use and future llama.cpp
builds.

Gemma QAT with its matching 280 MB smart Q4 MTP assistant more than doubled
greedy short-output throughput in the 16K comparison, with target verification
of 101 accepted from 116 draft tokens. The assistant is a separate GGUF in
this packaging. [Unsloth's MTP guide](https://huggingface.co/unsloth/gemma-4-31B-it-qat-GGUF/blob/main/MTP/README.md)
documents the pairing and shared KV cache. With this local build and split,
placing the assistant on CUDA0 crashed the backend (`cache_k_l58` allocated on
CUDA1 could not run an operation). Explicit CUDA1 placement passed text and
vision. A 64K Q5 vision trial on CUDA1 left only 92 MiB after text and the
image request disconnected, so it is excluded.

This build logs that its CUDA FlashAttention vector kernel is not compiled for
Q5/Q5 KV and converts that cache to F16 during attention. Short probes and the
15K-token retrieval passed, but full-window prefill and generation speed may
change materially. A build with `q5_0-q5_0` in `GGML_CUDA_FA_QUANTS` is worth
comparing before pushing these windows further; there was no local rebuild.

## Display placement

Moving the display cable to the 5060 Ti would move the desktop VRAM burden
toward the card with the smallest AI headroom. If its idle display cost matched
the present roughly 626 MiB difference, AGENT SOLO's 1156 MiB measured margin
would fall to roughly 530 MiB and CHAT's 1124 MiB would fall to roughly 500
MiB. That is an estimate, not a measured result after moving the cable; the
compositor may allocate differently. For this profile mix, keep video output
on the 3070 Ti and adjust the tensor splits instead. Recalibrate if the cable
moves, a VRAM-heavy desktop app is opened, or the llama.cpp build changes.

## Model and quantization options

- The installed Qwen3.6 35B-A3B Q4_K_S is still a reasonable fast coding MoE
  for 24 GB split VRAM. The publisher's Q4_K_M is about 1.2 GB larger; given
  the present 96K profile's sub-1 GiB per-card margin, adopting it would need
  a new split/context calibration. The MoE MTP variant is a replacement full
  GGUF, while the current non-MTP file has no embedded head. No local MoE MTP
  speed comparison was made. [Qwen3.6 quant files](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/tree/main),
  [MTP variant](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF).
- The installed Gemma 31B QAT Q4_K_XL plus the paired MTP assistant gives a
  useful 40K vision/chat configuration. An optional Gemma 26B-A4B QAT
  Q4_K_XL is about 14.2 GB versus 17.3 GB for the 31B QAT and might trade
  some quality for more context or speed. No local quality or fit comparison
  has been done. [Gemma 26B-A4B QAT files](https://huggingface.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF/tree/main),
  [Google Gemma 4 model card](https://huggingface.co/google/gemma-4-26B-A4B).
- For a second, stronger single-card companion than the 4B, official Gemma
  12B QAT Q4_0 weighs about 7.0 GB plus a 175 MB projector. It is an
  evaluation candidate for the 16 GB card; its quality is expected to differ
  from the installed 27B IQ3, and its context fit is unmeasured here.
  [Official Gemma 12B files](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/tree/main).

No additional weights were downloaded. Q5 and Q4 KV are capacity choices;
prefer the Q8 profiles when the task does not need the larger window. An
allocated 128K or 256K context is a capacity setting, not proof of reliable
reasoning or retrieval at that length.

## Integration verification

The updated `models.json`, `core.mjs`, README, and local tests were applied
through chezmoi; `chezmoi status` was empty for those paths. `start.sh check`
validated all seven profiles and their model files. All 12 local integration
unit tests passed, including explicit drafter placement in coexistence checks
and the router's `--device-draft` alias. The live Pi `/local` picker was used
for each changed profile:

- FAST 96K: streaming, forced tool round trip, synthetic red image, and
  thinking template passed.
- AGENT SOLO 128K: streaming, tool round trip, 15,313-token key retrieval,
  three Qwen3.8 effort templates, and concurrent requests with FAST passed.
- CODE DEEP 128K: streaming, tool round trip, 15,313-token key retrieval, and
  effort templates passed.
- CHAT 40K QAT MTP: streaming, tool round trip, synthetic red image, and
  thinking template passed when checked alone.
- LONG 256K: streaming, tool round trip, 15,313-token key retrieval, and
  effort templates passed.

One combined run reported `Local llama: fetch failed` on the first streaming
request immediately after switching CODE DEEP to CHAT. The router and Gemma
worker remained running; a fresh Gemma Pi smoke run passed. This leaves a
profile-transition reliability issue to watch, even though the chosen Gemma
settings passed isolated and live integration probes. The cause was not
established. No full 40K/128K/256K retrieval or code-quality benchmark was
run.
