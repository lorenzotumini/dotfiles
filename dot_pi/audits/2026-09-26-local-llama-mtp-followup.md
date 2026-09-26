# LONG MTP and SECURITY headroom — 2026-09-26

Hardware and build: RTX 3070 Ti 8 GiB (CUDA0, display connected), RTX 5060 Ti
16 GiB (CUDA1), llama.cpp build 10964. These are follow-up trials to
[the profile calibration](2026-09-26-local-llama.md). The managed router had
no loaded models before each isolated run. GPU idle use varied between runs;
typical readings were 631 MiB on CUDA0 and 5 MiB on CUDA1.

Each isolated run used the same installed weights, all layers on the GPUs,
flash attention, one slot, batch 512, micro-batch 128, and a short synthetic
Python request at temperature 0. The reported free VRAM is after generation,
not a peak-memory trace. Speed is llama.cpp's short-output generation rate.
These trials measure feasibility and a speed indication, not 240K-token
retrieval quality or typical sampled-response throughput.

## LONG: embedded MTP

The installed `Qwen3.8-27B-GSQ-RCO-IQ3_S-mtp.gguf` contains an embedded MTP
head, so no additional file is needed. llama.cpp's `draft-mtp` mode uses it.
[llama.cpp speculative decoding documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md).

| Context; split; target KV; MTP draft KV / max tokens | tok/s | Free CUDA0 / CUDA1, MiB | Result |
| --- | ---: | ---: | --- |
| 256K; 1:3; Q4; off | 29.7 | 2067 / 2286 | Old baseline |
| 256K; 1:3; Q4; Q8 / 2 | 54.2 | 1987 / 76 | Too little margin |
| 256K; 1:2; Q4; Q8 / 2 | 52.1 | 943 / 908 | Fit, tight |
| 256K; 5:11; Q4; F16 / 3 | 60.4 | 1065 / 1170 | Fit |
| **240K; 5:11; Q4; F16 / 4** | **64.1** | **1185 / 1428** | **Selected** |
| 224K; 1:3; Q4; Q8 / 2 | 53.9 | 2291 / 684 | Tight on CUDA1 |
| 192K; 1:3; Q4; Q8 / 2 | 54.2 | 2595 / 1504 | Fit, much shorter |

At 240K/F16/4, the 148-token greedy probe drafted 140 tokens and accepted
116. F16 draft KV used less GPU memory here than Q8, Q5, or Q4 draft KV;
the MTP draft context has only one layer, so quantization overhead does not
amortize like the target model's multi-layer KV cache. A llama.cpp contributor
describes that effect in [this project discussion](https://github.com/ggml-org/llama.cpp/discussions/24102).
Target KV remains Q4 to preserve the long window. All drafted tokens are
verified by the target, so MTP changes throughput rather than the intended
target sampling distribution; actual outputs still vary under nondeterministic
sampling.

The selected 240K context gives 208K tokens for input when reserving its full
32K output cap. The 256K MTP/F16/3 trial also fit, but the 240K configuration
leaves more margin for normal desktop VRAM variation while producing faster
generation on this one prompt.

## SECURITY: Orca load headroom before MTP

The prior 128K/Q8 security profile loaded and passed Pi streaming, a forced
tool round trip, and a 15,313-token retrieval test during this follow-up. It
left 1166 MiB free on CUDA0 and 896 MiB on CUDA1 in that live check. Earlier
router logs contain Orca CUDA allocation failures under older profile settings;
this follow-up did not reproduce a current load failure. The user later
confirmed that the 112K profile worked.

| Context; split; Q8 KV | tok/s | Free CUDA0 / CUDA1, MiB |
| --- | ---: | ---: |
| 112K; 2:5 | 24.5 | 1231 / 1386 |
| 96K; 2:5 | 24.5 | 1447 / 1874 |
| 112K; 5:11 | 24.5 | 563 / 2056 |

The first 112K profile retained Q8 KV and the same model weights, while
raising the tight card's margin by about 490 MiB relative to the 128K live
check. Split 2:5 is safer than 5:11 with video output on CUDA0. This is a
headroom improvement, not proof that VRAM caused the user's report. If it
it failed, capturing the exact Pi error and nearby router log entries would
have been the next step.

## Live integration

The new source profiles were applied through chezmoi and the managed router's
model presets were reloaded. The 12 local configuration and integration unit
tests passed. Through Pi's `/local` picker, both profiles loaded at their
configured contexts and passed native streaming, a forced tool round trip,
15,313-token key retrieval, and Qwen3.8 effort-template checks. After LONG's
15K request, free VRAM was 1175 / 1422 MiB.

A second LONG request used its configured non-thinking sampler for a 300-token
synthetic coding answer. It reported 54.3 output tok/s, with 217 of 323 draft
tokens accepted. That is a sampled single-prompt result; it cannot predict
every workload or be directly compared with the greedy no-MTP baseline.

## SECURITY: embedded MTP follow-up

The [OrcaRouter model card](https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-GGUF)
states that its GGUF quants preserve the embedded `nextn` MTP head. The local
Q4_K_M file loaded with `draft-mtp`, confirming no separate drafter download is
needed. The following trials used the same weights and split 2:5. MTP draft KV
was F16; target KV is shown in the first column.

| Context; target KV; maximum draft tokens | tok/s | Free CUDA0 / CUDA1, MiB | Result |
| --- | ---: | ---: | --- |
| 112K; Q8; MTP off | 24.7 | 1160 / 1386 | Previous profile |
| 112K; Q8; 2 | 52.2 | 1066 / 308 | Too tight on CUDA1 |
| 112K; Q8; 4 | 58.3 | 974 / 102 | Too tight on CUDA1 |
| 80K; Q8; 4 | 58.3 | 1410 / 1238 | Fit, shorter window |
| 112K; Q5; 2 | 51.9 | 1406 / 1316 | Fit |
| **112K; Q5; 3** | **58.4** | **1376 / 1214** | **Selected** |
| 112K; Q5; 4 | 58.4 | 1314 / 1110 | No gain on this prompt |
| 128K; Q5; 4 | 58.7 | 1146 / 686 | Too tight on CUDA1 |

The selected setting keeps the 112K context and Q4_K_M model weights. Q5
target KV is the precision trade needed for MTP to retain a workable margin;
the F16 draft KV belongs only to the speculative head. On the selected greedy
prompt, 108 of 123 draft tokens were accepted. MTP verification by the target
does not establish that Q5 target KV has the same quality as the former Q8
cache, and the short speed figures do not predict all workloads.

The MTP profile was applied through chezmoi and reloaded in the managed
router. All 12 local configuration tests passed. Through Pi's `/local` picker,
SECURITY loaded at 112K and passed streaming, a forced tool round trip,
15,313-token retrieval, and Qwen3.8 effort-template checks. A separate
300-token synthetic coding response with the configured non-thinking sampler
ran at 50.2 output tok/s, drafting 279 tokens and accepting 205. Free VRAM
afterward was 1408 / 1214 MiB. A medium-thinking request also generated
successfully: 1024 output tokens at 41.1 tok/s, with 615 of 1220 draft tokens
accepted; that request reached its deliberately low test output cap.

These are short synthetic checks, not full-window quality or VRAM peak tests.
The installed CUDA build logs that Q5/Q5 KV has no compiled FlashAttention
vector kernel and converts K/V to F16 for attention, so speed at very long
prompts may differ from the short probes.
