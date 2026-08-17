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

vim.api.nvim_create_autocmd({ "UIEnter", "ColorScheme" }, {
	desc = "Sync terminal background",
	callback = function()
		local normal = vim.api.nvim_get_hl(0, { name = "Normal" })
		if normal.bg then
			io.stdout:write(string.format("\027]11;#%06x\007", normal.bg))
		end
	end,
})

-- does not work reliably
vim.api.nvim_create_autocmd({ "UILeave", "VimSuspend" }, {
	desc = "Reset terminal background on exit",
	callback = function()
		io.stdout:write("\027]111\007")
	end,
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
