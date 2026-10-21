# Balanced footer

The balanced footer loads automatically on Pi startup, `/reload`, `/new`, and
session switches. It displays two rows: path/model above context-and-usage/statuses.
There are no layout commands, selectors, or startup flags.

A launcher using `--no-extensions` needs
`-e ~/.pi/agent/extensions/footer-layout/index.ts` to load this extension.

Examples at a wide terminal (usage and throughput are illustrative):

```text
balanced
~/Probe/toy (main)                         (openrouter) openrouter/free · high
ctx 0.0%/200k                                                       [BG off]

balanced with a local model
~/Probe/toy (main)                              (llama.cpp) local-model · high
ctx 12.3%/64k · ↑4k ↓800         [BG off] · prefill 900 tok/s · gen 45 tok/s

```

This extension uses documented APIs: `setFooter`, `getContextUsage`,
session entries, and the footer data provider. Existing extensions keep using
`setStatus`; all their statuses are displayed in key order, with colors preserved.
Rows wrap on narrower terminals. Git branch changes request a render, and the
subscription is disposed when the footer is replaced.

Pi supports adding statuses to the native footer, or replacing the entire footer.
It does not expose a native row-rearrangement API. This extension does not import Pi's
internal footer, patch the installation, or change Bash Guard or model behavior.
It requires no additional packages.

Public APIs reduce update risk but cannot guarantee compatibility forever. The
balanced footer deliberately shows basic context, token, cache, and cost totals;
it does not reproduce native-only details such as the auto-compaction indicator,
subscription label, cache-hit percentage, or routed-model display. Context usage
shows `?` when Pi has no estimate, including just after compaction.
