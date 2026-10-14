return {
	"ggml-org/llama.vim",
	lazy = true,
	init = function()
		local function highlights()
			-- Copilot may still be lazy-loaded when local mode is selected.
			vim.api.nvim_set_hl(0, "CopilotSuggestion", { default = true, link = "Comment" })
			vim.api.nvim_set_hl(0, "llama_hl_fim_hint", { link = "CopilotSuggestion" })
		end
		highlights()
		vim.api.nvim_create_autocmd("ColorScheme", {
			group = vim.api.nvim_create_augroup("LocalCompletionHighlights", { clear = true }),
			callback = highlights,
		})
		vim.g.llama_config = {
			endpoint_fim = "http://127.0.0.1:8012/infill",
			model_fim = "nvim-fim",
			enable_at_startup = false,
			auto_fim = true,
			fim_debounce_ms = 150,
			n_prefix = 128,
			n_suffix = 32,
			n_predict = 512,
			t_max_predict_ms = 3000,
			show_info = 0,
			-- Upstream's ring timer survives disable/re-enable. Use cursor context
			-- until its lifecycle can be managed without background requests.
			ring_n_chunks = 0,
			-- Our buffer-local maps avoid overriding Blink and Copilot mappings.
			keymap_fim_trigger = "",
			keymap_fim_accept_full = "",
			keymap_fim_accept_line = "",
			keymap_fim_accept_word = "",
			keymap_fim_next = "",
			keymap_fim_prev = "",
			keymap_debug_toggle = "",
			keymap_inst_trigger = "",
			keymap_inst_rerun = "",
			keymap_inst_continue = "",
			keymap_inst_accept = "",
			keymap_inst_cancel = "",
		}
	end,
}
