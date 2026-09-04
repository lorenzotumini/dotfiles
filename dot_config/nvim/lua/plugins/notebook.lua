local env = require("utils.env")
local term_program = (vim.env.TERM_PROGRAM or ""):lower()
local term = (vim.env.TERM or ""):lower()
local use_native_images = env.is_linux
	and not env.is_wsl
	and (term_program == "ghostty" or term:match("ghostty") or term_program == "kitty" or term == "xterm-kitty")
local use_wezterm_images = (env.is_windows or env.is_wsl)
	and (vim.env.WEZTERM_EXECUTABLE ~= nil or term_program == "wezterm")

local molten_image_provider = "none"
local molten_dependencies = {}

if use_native_images then
	molten_image_provider = "image.nvim"
	molten_dependencies = {
		{
			"3rd/image.nvim",
			build = false,
			opts = {
				backend = "kitty",
				processor = "magick_cli",
				integrations = {},
				max_width = 100,
				max_height = 12,
				max_height_window_percentage = math.huge,
				max_width_window_percentage = math.huge,
				window_overlap_clear_enabled = true,
				window_overlap_clear_ft_ignore = { "cmp_menu", "cmp_docs", "snacks_notif", "" },
			},
		},
	}
elseif use_wezterm_images then
	molten_image_provider = "wezterm"
	molten_dependencies = { "willothy/wezterm.nvim" }
end

return {
	{
		-- this is a remote plugin, may need to run :UpdateRemotePlugins after update,
		-- see https://github.com/benlubas/molten-nvim/blob/main/docs/Windows.md
		"benlubas/molten-nvim",
		build = ":UpdateRemotePlugins",
		dependencies = molten_dependencies,
		init = function()
			-- WezTerm uses a dedicated split, while compatible Linux terminals
			-- render images directly in Neovim through image.nvim.
			vim.g.molten_auto_open_output = not use_wezterm_images
			vim.g.molten_output_show_more = true
			vim.g.molten_image_provider = molten_image_provider
			vim.g.molten_image_location = "both"
			vim.g.molten_output_virt_lines = true
			vim.g.molten_split_direction = "right" -- "left", "top", "bottom"
			vim.g.molten_split_size = 40 -- 0-100% size of the screen dedicated to the output window
			vim.g.molten_virt_text_output = true
			vim.g.molten_virt_text_max_lines = 12
			vim.g.molten_output_win_max_height = 20
			vim.g.molten_tick_rate = 200
			vim.g.molten_wrap_output = true
			vim.g.molten_use_border_highlights = true
			vim.g.molten_virt_lines_off_by_1 = false
			vim.g.molten_auto_image_popup = false
			vim.g.molten_output_win_zindex = 50
		end,
		keys = {
			-- keys that load the plugin
			{
				"<leader>mi",
				function()
					local venv = os.getenv("VIRTUAL_ENV") or os.getenv("CONDA_PREFIX")
					local name = venv and venv:match("([^/\\]+)$") or "python3"
					vim.cmd(("MoltenInit %s"):format(name))
				end,
				desc = "Molten Initialize",
			},
			{ "<leader>ms", ":MoltenInit<CR>", desc = "Molten Select" },
			{ "<leader>me", ":MoltenEvaluateOperator<CR>", desc = "Molten Eval operator" },
			{ "<leader>ml", ":MoltenEvaluateLine<CR>", desc = "Molten Eval line" },
			{
				"<leader>mv",
				":<C-u>MoltenEvaluateVisual<CR>gv",
				mode = { "v" },
				desc = "Molten Eval visual selection",
			},
			{
				"<leader>m<CR>",
				function()
					vim.cmd("MoltenEvaluateOperator")
					vim.schedule(function()
						-- press i (inside) h (cell object befined by mini.ai)
						local keys = vim.api.nvim_replace_termcodes("ih", true, false, true)
						vim.api.nvim_feedkeys(keys, "m", false)
					end)
				end,
				desc = "Molten Eval cell",
			},
		},
		config = function()
			-- keys defined post-loading
			vim.keymap.set(
				"n",
				"<leader>mr",
				":MoltenReevaluateCell<CR>",
				{ silent = true, desc = "Molten Re-eval cell" }
			)
			vim.keymap.set("n", "<leader>mc", ":MoltenDelete<CR>", { silent = true, desc = "Molten Clear cell" })
			vim.keymap.set("n", "<leader>mp", ":MoltenImagePopup<CR>", { silent = true, desc = "Molten Popup" })
			-- vim.keymap.set("n", "<leader>mh", ":MoltenHideOutput<CR>", { silent = true, desc = "Molten Hide output" })
			-- vim.keymap.set(
			-- 	"n",
			-- 	"<leader>mo",
			-- 	":noautocmd MoltenEnterOutput<CR>",
			-- 	{ silent = true, desc = "Molten Show output" }
			-- )

			local notebook = require("mini_notebook")
			-- create new obj (eg can do 'dah' for cells like 'dap' for paragraphs)
			require("mini.ai").setup({
				custom_textobjects = {
					h = function()
						return notebook.miniai_spec("i", { python = "# %%", lua = "-- %%" })
					end,
				},
			})
			-- highlight # %% separator
			require("mini.hipatterns").setup({
				highlighters = {
					notebook_cells = notebook.minihipatterns_spec({ python = "# %%", lua = "-- %%" }, "Folded"),
				},
			})
		end,
	},
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = {
			"nvim-tree/nvim-web-devicons",
		},
		opts = {
			code = {
				language = false, -- show language header
				style = "language", -- disable codeblock highlighting
			},
		},
		keys = {
			{
				"<leader>md",
				"<cmd>RenderMarkdown toggle<CR>",
				desc = "Toggle RenderMarkdown",
			},
		},
	},
}
