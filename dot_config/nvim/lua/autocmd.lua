vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking text",
	group = vim.api.nvim_create_augroup("kickstart-highlight-yank", { clear = true }),
	callback = function()
		vim.hl.on_yank()
	end,
})

require("jupytext").setup()

local augroup = vim.api.nvim_create_augroup("numbertoggle", {})

vim.api.nvim_create_autocmd({ "BufEnter", "FocusGained", "InsertLeave", "CmdlineLeave", "WinEnter" }, {
	desc = "Switch to relative numbers",
	group = augroup,
	callback = function()
		if vim.o.nu and vim.api.nvim_get_mode().mode ~= "i" then
			vim.opt.relativenumber = true
		end
	end,
})

vim.api.nvim_create_autocmd({ "BufLeave", "FocusLost", "InsertEnter", "CmdlineEnter", "WinLeave" }, {
	desc = "Switch to absolute numbers",
	group = augroup,
	callback = function()
		if vim.o.nu then
			vim.opt.relativenumber = false
			-- Redraw fix for specific command types
			if not vim.tbl_contains({ "@", "-" }, vim.v.event.cmdtype) then
				vim.cmd("redraw")
			end
		end
	end,
})

local terminal_background = {
	active = false,
	original = nil,
	query_pending = false,
	ready = false,
}

local function send_to_terminal(sequence)
	vim.api.nvim_ui_send(sequence)
end

local function write_to_terminal(sequence)
	io.stdout:write(sequence)
	io.stdout:flush()
end

local function restore_terminal_background(write_directly)
	local sequence = terminal_background.original and ("\027]11;" .. terminal_background.original .. "\027\\")
		or "\027]111\027\\"

	if write_directly then
		write_to_terminal(sequence)
	else
		send_to_terminal(sequence)
	end
end

local function sync_terminal_background()
	if vim.g.neovide or not terminal_background.active or not terminal_background.ready then
		return
	end

	local normal = vim.api.nvim_get_hl(0, { name = "Normal" })
	if normal.bg then
		send_to_terminal(string.format("\027]11;#%06x\027\\", normal.bg))
	else
		restore_terminal_background(false)
	end
end

local function capture_terminal_background(reset_to_config)
	if vim.g.neovide then
		return
	end

	terminal_background.active = true
	terminal_background.original = nil
	terminal_background.query_pending = true
	terminal_background.ready = false

	-- OSC 111 clears a program's dynamic OSC 11 override. This matters when
	-- the desktop theme changes while Neovim is running: querying first would
	-- otherwise capture Neovim's old background instead of Ghostty's new one.
	if reset_to_config then
		send_to_terminal("\027]111\027\\")
	end
	send_to_terminal("\027]11;?\027\\")

	vim.defer_fn(function()
		if not terminal_background.query_pending then
			return
		end

		terminal_background.query_pending = false
		terminal_background.ready = true
		sync_terminal_background()
	end, 200)
end

vim.api.nvim_create_autocmd("TermResponse", {
	desc = "Capture original terminal background",
	callback = function(args)
		if not terminal_background.query_pending then
			return
		end

		local sequence = (args.data and args.data.sequence) or ""
		local color = sequence:match("\027%]11;([^\007\027]+)")
		local valid = color
			and (
				color:match("^rgb:%x+/%x+/%x+$")
				or color:match("^rgba:%x+/%x+/%x+/%x+$")
				or color:match("^#%x+$")
			)
		if not valid then
			return
		end

		terminal_background.original = color
		terminal_background.query_pending = false
		terminal_background.ready = true
		sync_terminal_background()
	end,
})

vim.api.nvim_create_autocmd("UIEnter", {
	desc = "Capture and sync terminal background",
	callback = function()
		-- Query before applying any program color, then fall back for terminals
		-- which do not report their current background.
		capture_terminal_background(false)
	end,
})

vim.api.nvim_create_autocmd("ColorScheme", {
	desc = "Sync terminal background",
	callback = function()
		vim.schedule(sync_terminal_background)
	end,
})

vim.api.nvim_create_autocmd("User", {
	pattern = "DesktopThemeChanging",
	desc = "Recapture terminal default before a desktop colorscheme change",
	callback = function()
		if terminal_background.active then
			capture_terminal_background(true)
		end
	end,
})

vim.api.nvim_create_autocmd("User", {
	pattern = "DesktopThemeChanged",
	desc = "Sync terminal background after a desktop colorscheme change",
	callback = function()
		vim.schedule(sync_terminal_background)
	end,
})

vim.api.nvim_create_autocmd({ "UILeave", "VimSuspend" }, {
	desc = "Restore original terminal background",
	callback = function(args)
		if vim.g.neovide or not terminal_background.active then
			return
		end

		restore_terminal_background(true)
		if args.event == "UILeave" then
			terminal_background.active = false
			terminal_background.query_pending = false
		end
	end,
})

vim.api.nvim_create_autocmd("VimResume", {
	desc = "Resync terminal background",
	callback = sync_terminal_background,
})

-- change highlight color of floating window (background, border, title)
-- vim.api.nvim_set_hl(0, "NormalFloat", { link = "Normal" })
-- vim.cmd("highlight FloatBorder guibg=NormalFloat")
-- vim.cmd("highlight FloatTitle guibg=NormalFloat")

vim.api.nvim_create_autocmd("TermOpen", {
	desc = "Set scrolloff to 0 locally",
	callback = function()
		vim.opt_local.scrolloff = 0
	end,
})
