local env = require("utils.env")

local state = { floating = { buf = -1, win = -1 } }
local shell = env.default_shell()

local function floating_geometry()
	local width = math.max(1, math.floor(vim.o.columns * 0.8))
	local height = math.max(1, math.floor(vim.o.lines * 0.7))

	local col = math.floor((vim.o.columns - width) / 2)
	local row = math.floor((vim.o.lines - height) / 2)

	return { relative = "editor", width = width, height = height, col = col, row = row }
end

local function create_floating_window(opts)
	opts = opts or {}
	local buf = nil
	if vim.api.nvim_buf_is_valid(opts.buf) then
		buf = opts.buf
	else
		buf = vim.api.nvim_create_buf(false, true)
	end

	local win_config = floating_geometry()
	win_config.style = "minimal"
	win_config.border = BORDER
	local win = vim.api.nvim_open_win(buf, true, win_config)
	-- change default window highliting group to background group
	-- vim.api.nvim_win_set_option(win, "winhl", "NormalFloat:Normal")
	return { buf = buf, win = win }
end

vim.api.nvim_create_autocmd("VimResized", {
	group = vim.api.nvim_create_augroup("FloatingTerminalResize", { clear = true }),
	desc = "Resize and recenter the floating terminal",
	callback = function()
		if vim.api.nvim_win_is_valid(state.floating.win) then
			vim.api.nvim_win_set_config(state.floating.win, floating_geometry())
		end
	end,
})

local toggle_terminal = function()
	if not vim.api.nvim_win_is_valid(state.floating.win) then
		state.floating = create_floating_window({ buf = state.floating.buf })
		if vim.bo[state.floating.buf].buftype ~= "terminal" then
			vim.cmd("terminal " .. shell)
		end
		vim.api.nvim_command("startinsert")
	else
		vim.api.nvim_win_hide(state.floating.win)
	end
end

local close_floating_terminal = function()
	if vim.api.nvim_buf_is_valid(state.floating.buf) then
		local chan = vim.b[state.floating.buf].terminal_job_id
		if chan and vim.fn.jobwait({ chan }, 0)[1] == -1 then
			vim.fn.jobstop(chan)
		end
		vim.api.nvim_buf_delete(state.floating.buf, { force = true })
	end
	if vim.api.nvim_win_is_valid(state.floating.win) then
		vim.api.nvim_win_close(state.floating.win, true)
	end
	state.floating = { buf = -1, win = -1 }
end

vim.api.nvim_create_user_command("Floaterminal", toggle_terminal, {})
vim.api.nvim_create_user_command("FloaterminalClose", close_floating_terminal, {})
vim.keymap.set({ "n", "t" }, "<leader>j", toggle_terminal, { desc = "Toggle floating terminal" })
vim.keymap.set("n", "<leader>J", function()
	vim.cmd("tab term " .. shell)
	vim.api.nvim_command("startinsert")
end, { desc = "Open terminal" })
