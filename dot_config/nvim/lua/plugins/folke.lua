return {
	{
		"folke/todo-comments.nvim",
		opts = {
			keywords = {
				FIX = { alt = { "FIXED", "BUG" } },
				NOTE = { icon = " ", color = "hint", alt = { "INFO" } },
				TEST = { icon = "󰓅 ", color = "test", alt = { "TESTING", "PASSED", "FAILED" } },
				COOL = { icon = " ", color = "error", alt = { "FIGO", "FIGATA" } },
				-- can use HEX for color eg #348d72, but won't folow theme
			},
		},
		-- TODO:
		-- FIX:
		-- NOTE:
		-- WARN:
		-- HACK:
		-- PERF:
		-- TEST:
		-- COOL:
	},
	{
		"folke/snacks.nvim",
		priority = 1000,
		opts = {
			-- Images are rendered by image.nvim; treating their binary data as a
			-- large text buffer is unhelpful. Disable this optional safeguard.
			bigfile = { enabled = false },
			dashboard = { enabled = false },
			explorer = { enabled = false }, -- neotree alternative
			indent = {
				enabled = true,
				animate = { enabled = false },
				scope = { enabled = false }, -- this disables highlighting
			},
			input = { enabled = false },
			picker = { enabled = false }, -- telescope alternative
			notifier = {
				enabled = true,
				margin = { top = 0, right = 1000, bottom = 0 },
				style = "compact", -- "compact", "fancy", "minimal"
			},
			quickfile = { enabled = true },
			scope = { enabled = true },
			scroll = { enabled = false },
			statuscolumn = { enabled = false },
			words = { enabled = false }, -- highliht multiple word occurences
		},
	},
	{
		-- :checkhealth which-key to find OVERLAPPING keybindings
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = {
			preset = "classic", -- "modern", "helix"
			win = { border = BORDER },
			sort = { "local", "order", "group", "alphanum", "mod" },
		},
	},
}
