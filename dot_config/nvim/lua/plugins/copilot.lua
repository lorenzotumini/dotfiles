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

local function detach_copilot_buffers()
	if not package.loaded["copilot.client"] then
		return
	end

	local client = require("copilot.client")
	for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
		client.buf_detach_if_attached(bufnr)
	end
end

local function toggle_copilot_panel()
	if vim.g.copilot_mode == "off" then
		vim.notify("Enable Copilot Blink or ghost mode before opening the panel")
		return
	end

	local panel = require("copilot.panel")
	if panel.is_open() then
		panel.close()
		return
	end

	local client = require("copilot.client")
	client.buf_attach(false, 0)
	if not client.initialized then
		vim.notify("Copilot is still starting; try opening the panel again")
		return
	end

	panel.open({})
end

local function accept_copilot_nes()
	if vim.g.copilot_mode == "off" then
		return
	end

	local bufnr = vim.api.nvim_get_current_buf()
	if not vim.b[bufnr].nes_state then
		return
	end

	local ok, nes = pcall(require, "copilot-lsp.nes")
	if ok and nes.apply_pending_nes(bufnr) then
		nes.walk_cursor_end_edit(bufnr)
	end
end

local function dismiss_copilot_nes()
	local ok, nes = pcall(require, "copilot-lsp.nes")
	if ok then
		nes.clear()
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

		require("copilot.client").buf_attach(false, 0)
	else
		detach_copilot_buffers()
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
		"giuxtaposition/blink-cmp-copilot",
		lazy = true,
	},
	{
		"zbirenbaum/copilot.lua",
		cmd = "Copilot",
		dependencies = {
			{
				"copilotlsp-nvim/copilot-lsp",
				init = function()
					vim.g.copilot_nes_debounce = 500
				end,
				opts = {
					nes = {
						move_count_threshold = 12,
						distance_threshold = 80,
						count_horizontal_moves = false,
					},
				},
			},
		},
		opts = {
			suggestion = {
				enabled = true,
				auto_trigger = false,
				keymap = {
					accept = "<M-l>",
					accept_word = "<M-w>",
					accept_line = "<M-e>",
					next = "<M-]>",
					prev = "<M-[>",
					dismiss = "<C-]>",
				},
			},
			nes = {
				enabled = true,
				auto_trigger = true,
				keymap = {
					accept_and_goto = false,
					accept = false,
					dismiss = false,
				},
			},
			panel = {
				enabled = true,
				auto_refresh = false,
				keymap = {
					jump_prev = "[[",
					jump_next = "]]",
					accept = "<CR>",
					refresh = "gr",
					open = false,
				},
				layout = {
					position = "bottom",
					ratio = 0.4,
				},
			},
			should_attach = function(buf_id, _)
				if vim.g.copilot_mode == "off" then
					return false
				end

				return vim.bo[buf_id].buflisted and vim.bo[buf_id].buftype == ""
			end,
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
			{
				"<leader>yp",
				toggle_copilot_panel,
				desc = "Copilot suggestions panel",
			},
			{
				"<M-n>",
				accept_copilot_nes,
				mode = { "n", "i" },
				desc = "Accept Copilot next edit",
			},
			{
				"<M-x>",
				dismiss_copilot_nes,
				mode = { "n", "i" },
				desc = "Dismiss Copilot next edit",
			},
		},
	},
}
