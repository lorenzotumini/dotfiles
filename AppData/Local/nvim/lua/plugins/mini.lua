return {
	"nvim-mini/mini.nvim",
	version = false,
	config = function()
		require("mini.pairs").setup({
			mappings = {
				-- basically only {} active
				["("] = false,
				[")"] = false,
				["["] = false,
				["]"] = false,
				['"'] = false,
				["'"] = false,
				["`"] = false,
			},
		})

		local misc = require("mini.misc")
		misc.setup({
			-- there are many more
			make_global = { "put", "put_text", "resize_window", "zoom" },
		})
		-- misc.setup_auto_root()
		misc.setup_restore_cursor()

		-- works only on Windows Terminal
		if not (vim.env.WEZTERM_EXECUTABLE or vim.env.ALACRITTY_LOG or vim.env.HERDR or vim.env.HERDR_ENV or vim.env.HERDR_PANE_ID) then
			misc.setup_termbg_sync({ explicit_reset = true })
		end

		require("mini.comment").setup()
		require("mini.surround").setup()
	end,
}
