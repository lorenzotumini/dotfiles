local DEFAULT_COPILOT_MODE = "off" -- "off", "blink", "ghost", or "local"
local COPILOT_MODES = { "off", "blink", "ghost", "local" }
local COPILOT_MODE_FILE = vim.fn.stdpath("state") .. "/copilot-mode"

local function cloud_enabled()
	return vim.g.copilot_mode == "blink" or vim.g.copilot_mode == "ghost"
end

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
	vim.fn.mkdir(vim.fn.stdpath("state"), "p")
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
	if not cloud_enabled() then
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
	if not cloud_enabled() then
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
		vim.notify("Invalid completion mode: " .. mode, vim.log.levels.ERROR)
		return
	end
	if mode == "local" and not require("local_completion").available() then
		return
	end
	if package.loaded["local_completion"] then
		require("local_completion").disable()
	end

	vim.g.copilot_mode = mode
	apply_copilot_mode_to_buffer()

	if cloud_enabled() then
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
		dismiss_copilot_nes()
		if package.loaded["copilot.panel"] then
			require("copilot.panel").close()
		end
		if mode == "local" then
			require("local_completion").enable(function()
				set_copilot_mode("off")
			end)
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
		vim.notify("Completion mode: " .. mode)
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
				if not cloud_enabled() then
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

			local function mode_command(args)
				set_copilot_mode(args.args)
			end
			local command_opts = {
				nargs = 1,
				complete = function()
					return COPILOT_MODES
				end,
				desc = "Set completion mode (off, blink, ghost, or local)",
			}
			vim.api.nvim_create_user_command("CopilotMode", mode_command, command_opts)
			vim.api.nvim_create_user_command("CompletionMode", mode_command, command_opts)
			vim.api.nvim_create_user_command("LocalLlamaStop", function()
				if vim.g.copilot_mode == "local" then
					set_copilot_mode("off")
				end
				if require("local_completion").available() then
					require("local_completion").stop()
				end
			end, { desc = "Stop the local completion server and free its VRAM" })

			if restored_mode ~= "off" then
				vim.schedule(function()
					set_copilot_mode(restored_mode, { notify = false, persist = false })
				end)
			end
		end,
		keys = {
			{
				"<leader>yu",
				"<cmd>LocalLlamaStop<CR>",
				desc = "AI unload local model",
			},
			{
				"<leader>yl",
				function()
					set_copilot_mode("local")
				end,
				desc = "AI local ghost",
			},
			{
				"<leader>yb",
				function()
					set_copilot_mode("blink")
				end,
				desc = "AI Copilot blink",
			},
			{
				"<leader>yg",
				function()
					set_copilot_mode("ghost")
				end,
				desc = "AI Copilot ghost",
			},
			{
				"<leader>yo",
				function()
					set_copilot_mode("off")
				end,
				desc = "AI off",
			},
			{
				"<leader>yp",
				toggle_copilot_panel,
				desc = "AI Copilot suggestions panel",
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
