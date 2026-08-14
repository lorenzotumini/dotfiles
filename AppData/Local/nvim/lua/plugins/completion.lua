local DEFAULT_COPILOT_MODE = "off" -- "off", "blink", or "ghost"
local COPILOT_MODES = { "off", "blink", "ghost" }
local COPILOT_MODE_FILE = vim.fn.stdpath("state") .. "/copilot-mode"

local function load_copilot_mode()
	if vim.fn.filereadable(COPILOT_MODE_FILE) ~= 1 then
		return DEFAULT_COPILOT_MODE
	end

	local mode = vim.fn.readfile(COPILOT_MODE_FILE, "", 1)[1]
	if vim.tbl_contains(COPILOT_MODES, mode) then
		return mode
	end

	return DEFAULT_COPILOT_MODE
end

local function save_copilot_mode(mode)
	local ok, err = pcall(vim.fn.writefile, { mode }, COPILOT_MODE_FILE)
	if not ok then
		vim.notify("Could not save Copilot mode: " .. tostring(err), vim.log.levels.WARN)
	end
end

local function apply_copilot_mode_to_buffer()
	local ghost = vim.g.copilot_mode == "ghost"
	vim.b.copilot_suggestion_auto_trigger = ghost
	vim.b.copilot_suggestion_hidden = not ghost

	if not ghost and package.loaded["copilot.suggestion"] then
		require("copilot.suggestion").dismiss()
	end
end

local function set_copilot_mode(mode, opts)
	opts = opts or {}

	if not vim.tbl_contains(COPILOT_MODES, mode) then
		vim.notify("Invalid Copilot mode: " .. mode, vim.log.levels.ERROR)
		return
	end

	vim.g.copilot_mode = mode
	apply_copilot_mode_to_buffer()

	if mode ~= "off" then
		require("lazy").load({
			plugins = {
				"copilot.lua",
				"blink-cmp-copilot",
			},
		})

		if require("copilot.client").is_disabled() then
			vim.cmd("Copilot enable")
		end
	end

	local blink_ok, blink = pcall(require, "blink.cmp")
	if blink_ok then
		blink.hide()
	end

	if opts.persist ~= false then
		save_copilot_mode(mode)
	end

	if opts.notify ~= false then
		vim.notify("Copilot mode: " .. mode)
	end
end

return {
	{
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
	},
	{
		"giuxtaposition/blink-cmp-copilot",
		lazy = true,
	},
	{
		"zbirenbaum/copilot.lua",
		cmd = "Copilot",
		opts = {
			suggestion = {
				enabled = true,
				auto_trigger = false,
			},
			panel = { enabled = false },
			server_opts_overrides = {
				exit_timeout = 2000,
			},
		},
		init = function()
			local restored_mode = load_copilot_mode()
			vim.g.copilot_mode = restored_mode
			apply_copilot_mode_to_buffer()

			local group = vim.api.nvim_create_augroup("CopilotMode", { clear = true })
			vim.api.nvim_create_autocmd({ "BufEnter", "InsertEnter" }, {
				group = group,
				callback = apply_copilot_mode_to_buffer,
			})

			vim.api.nvim_create_user_command("CopilotMode", function(args)
				set_copilot_mode(args.args)
			end, {
				nargs = 1,
				complete = function()
					return COPILOT_MODES
				end,
				desc = "Set Copilot mode (off, blink, or ghost)",
			})

			if restored_mode ~= "off" then
				vim.schedule(function()
					set_copilot_mode(restored_mode, { notify = false, persist = false })
				end)
			end
		end,
		keys = {
			{
				"<leader>yb",
				function()
					set_copilot_mode("blink")
				end,
				desc = "Copilot Blink mode",
			},
			{
				"<leader>yg",
				function()
					set_copilot_mode("ghost")
				end,
				desc = "Copilot ghost mode",
			},
			{
				"<leader>yo",
				function()
					set_copilot_mode("off")
				end,
				desc = "Copilot off",
			},
		},
	},
}
