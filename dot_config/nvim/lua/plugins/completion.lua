return {
	"saghen/blink.cmp",
	event = "VeryLazy",
	dependencies = {
		"saghen/blink.lib",
		-- "rafamadriz/friendly-snippets",
	},
	version = "1.*",
	opts = {
		keymap = {
			["<Tab>"] = {
				"accept",
				function()
					if vim.g.copilot_mode ~= "ghost" or not package.loaded["copilot.suggestion"] then
						return
					end

					local suggestion = require("copilot.suggestion")
					if suggestion.is_visible() then
						suggestion.accept()
						return true
					end
				end,
				"fallback",
			},
			["<CR>"] = { "accept", "fallback" },
			["<C-e>"] = { "show", "show_documentation", "hide_documentation" }, -- "hide" for toggle behavior
			["<C-k>"] = { "show_signature", "hide_signature", "fallback" },
		},
		appearance = { nerd_font_variant = "normal" }, -- "mono"

		completion = {
			menu = {
				border = BORDER,
				auto_show = false, -- for buffers
				draw = { treesitter = { "lsp" } },
			},
			documentation = {
				window = { border = BORDER },
				auto_show = false,
				auto_show_delay_ms = 0,
			},
			list = {
				selection = {
					preselect = true, -- open with first item selected
					auto_insert = false, -- insert without CR after selection
				},
			},
		},
		signature = {
			window = {
				border = BORDER,
				show_documentation = false,
			},
			enabled = true,
			trigger = { enabled = false }, -- does not show automatically
		},
		cmdline = {
			keymap = {
				["<Tab>"] = { "accept", "fallback" },
			},
			completion = {
				menu = {
					auto_show = true, -- for cmdline
				},
			},
		},

		sources = {
			default = function()
				local sources = { "lsp", "path", "buffer" } -- "snippets"
				if vim.g.copilot_mode == "blink" then
					table.insert(sources, "copilot")
				end
				return sources
			end,
			providers = {
				copilot = {
					name = "copilot",
					module = "blink-cmp-copilot",
					score_offset = 100,
					async = true,
				},
			},
		},
		fuzzy = { implementation = "prefer_rust_with_warning" },
	},
}
