# Offline Neovim completions (Linux)

Neovim supports `:CompletionMode off|blink|ghost|local`. `:CopilotMode` remains
an alias. The choice is saved in Neovim's state directory. `blink` and `ghost`
use Copilot; `local` uses `ggml-org/llama.vim` with a dedicated llama.cpp server.
Local suggestions render as inline ghost text using the Copilot suggestion
highlight, with performance statistics hidden. Only one AI completion provider
is active at a time. Normal Blink/LSP completion and its Tab mapping remain
available in local mode. Tab accepts a selected Blink menu item first; otherwise
it accepts a visible local or Copilot ghost suggestion, then falls back to the
normal Tab action.

Local mode starts `nvim-local-llama.service` on demand, waits for `/health`,
then enables automatic inline suggestions in editable, listed file buffers.
The server stays resident across mode changes and Neovim exits to avoid model
reloads. `<leader>yu` (or `:LocalLlamaStop`) disables local suggestions and stops
the server to release VRAM. It is a static user service, so it does not start at login.
The service also stops when the systemd user session ends. It is shared across
Neovim instances, so stopping it affects all instances using local completions;
closing one editor does not interrupt the others. Turning AI completions off
does not unload the model or disable normal LSP/Blink completion.

One-time setup (the model download can be resumed by repeating the command):

```sh
hf download ggml-org/Qwen2.5-Coder-3B-Q8_0-GGUF \
  qwen2.5-coder-3b-q8_0.gguf \
  --local-dir /mnt/shared/AI/models/llama.cpp/qwen2.5-coder-3b
chezmoi apply ~/.config/nvim/lua/plugins/copilot.lua \
  ~/.config/nvim/lua/plugins/llama.lua ~/.config/nvim/lua/local_completion.lua \
  ~/.local/bin/nvim-local-llama ~/.config/systemd/user/nvim-local-llama.service
systemctl --user daemon-reload
```

Install the plugin with `:Lazy sync` if it is not already installed. After the
download completes, restart Neovim, open a code file, and use
`:CompletionMode local` (or `<leader>yl`). In Insert mode, type the beginning of
a function or press `Alt-f` to request a suggestion. Tab or `Alt-l` accepts the entire
suggestion, `Alt-w` a word, `Alt-e` a line, and `Ctrl-]` dismisses it.
`Alt-]`/`Alt-[` cycle cached alternatives if configured; the default generates
one suggestion. `<leader>yb`, `<leader>yg`, and `<leader>yo` select Copilot Blink,
Copilot ghost, and off respectively.
These shortcuts appear under the **AI completions** group. Copilot's next edit
suggestions (edits away from the cursor) use `Alt-n` to accept and move to the
end of the edit, and `Alt-x` to dismiss, in Normal or Insert mode.

Check the server independently:

```sh
systemctl --user start nvim-local-llama.service
curl --fail http://127.0.0.1:8012/health
curl --fail http://127.0.0.1:8012/infill \
  -H 'Content-Type: application/json' \
  -d '{"input_prefix":"def add(a, b):\n    ","input_suffix":"\n","n_predict":32,"temperature":0,"stream":false}'
journalctl --user -u nvim-local-llama.service -n 40 --no-pager
```

`/health` can return 503 while the model is loading; retry once it is ready.
The initial model is Qwen2.5-Coder **base** 3B Q8, using CUDA0 (3070 Ti),
16K context, one slot, and cache reuse. Plugin and model downloads are the only
network-dependent setup steps; inference binds to loopback and uses a local
GGUF without automatic downloads. Context includes 128 lines before and 32
after the cursor. Cross-file ring context is disabled because upstream's ring
timer currently survives disable/re-enable.

The configured `n_predict = 512` in `plugins/llama.lua` caps each generation
request at 512 tokens; this is a latency choice, not the model's output limit.
Upstream applies a hard-coded 250 ms generation budget to the initial request;
we set `t_max_predict_ms = 3000` for follow-up requests. The model may stop
earlier, and the plugin can pre-generate continuations after displaying a hint.
Increasing `n_predict` can allow longer suggestions, though the time budget
still applies. Keep the server's `--cache-reuse` value strictly greater than
`n_predict` when increasing it (currently 1024). Restart the completion service
after changing server settings and restart Neovim after changing plugin settings.

Optional machine-specific settings go in the unmanaged
`~/.config/nvim/local-llama.env` (systemd EnvironmentFile syntax):

```ini
NVIM_LLAMA_MODEL=/absolute/path/to/a/FIM-compatible-model.gguf
NVIM_LLAMA_DEVICE=CUDA0
NVIM_LLAMA_CONTEXT=16384
```

Stop and select local mode again after changing these settings. Pi's local
model placement policy does not account for this server yet; manually stop it
before loading a Pi profile that needs the same GPU.
