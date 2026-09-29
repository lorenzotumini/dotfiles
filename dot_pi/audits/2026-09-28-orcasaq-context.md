# OrcaSAQ-2 context headroom — 2026-09-28

Hardware: RTX 3070 Ti 8 GiB (CUDA0, display connected) and RTX 5060 Ti 16 GiB
(CUDA1). Runtime: llama.cpp build 10964. The managed router remained running
without loaded models. Each measurement used a separate temporary llama-server
on port 18081; it was stopped after the trial. Idle use immediately before the
trials was 748 MiB on CUDA0 and 5 MiB on CUDA1.

The OrcaSAQ-2 GGUF was loaded with full GPU offload, layer split 2:5, Flash
Attention on, one slot, batch 512, micro-batch 128, four context checkpoints,
Q5 target KV, embedded MTP with up to three tokens, and F16 MTP draft KV. Each
loaded context received the same short synthetic Python prompt at temperature
0 with a 160-token output cap. All three loads and generations completed. The
response drafted 150 tokens and accepted 108 at each context, about 58 output
tokens/s. Free VRAM was sampled after generation, not at peak.

| Context | Output tok/s | Free CUDA0 / CUDA1, MiB | Result |
| ---: | ---: | ---: | --- |
| **144K** | **58.1** | **1429 / 1306** | **Selected; over 1 GiB free on both cards** |
| 160K | 58.0 | 1261 / 882 | Fits, tight on CUDA1 |
| 176K | 58.1 | 1093 / 458 | Too little CUDA1 margin for normal desktop variation |

The SECURITY profile now uses 144K (147,456 tokens), retaining its 32K output
limit, Q5 target KV, and MTP settings. This leaves up to 112K tokens for input
when reserving the full output cap. The smaller weights make this 32K increase
over the previous 112K profile practical while keeping about 1.3 GiB free on
the tighter card in this short probe. The 160K and 176K trials show that larger
contexts load, but their remaining CUDA1 headroom is too small for the default
profile.

This is a load/generation and post-request headroom measurement, not a peak
memory trace or full-window retrieval, coding-quality, or sustained-throughput
test. The installed build has no CUDA FlashAttention vector kernel compiled
for Q5/Q5 KV and converts K/V to F16 for attention; long-prompt performance may
therefore differ from these short outputs.
