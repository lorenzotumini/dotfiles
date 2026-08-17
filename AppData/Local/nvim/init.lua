-- --------------------
--  Global Variables
-- --------------------
if vim.fn.has("nvim-0.12") ~= 1 then
	local version = tostring(vim.version())
	vim.api.nvim_err_writeln("This config requires Neovim 0.12+; current version is " .. version)
	return
end

vim.g.mapleader = " "
vim.g.maplocalleader = "\\"
vim.g.have_nerd_font = true

local env = require("utils.env")
local python_host = env.is_windows and env.config_path("nvim_venv", "Scripts", "python.exe")
	or env.config_path("nvim_venv", "bin", "python")
if python_host then
	if env.executable(python_host) then
		vim.g.python3_host_prog = python_host
	end
end

-- border can be set globally with vim.opt but not every plugin supports it,
-- better to use a global variable for convenience
BORDER = "rounded" -- "bold", "shadow", "rounded", "single", "double", "solid", "none"

-- --------------------
--  Options
-- --------------------
vim.opt.winborder = BORDER

vim.opt.swapfile = false
vim.opt.tabstop = 4
vim.opt.wrap = true
vim.opt.linebreak = true
vim.opt.breakindent = true
vim.opt.cursorcolumn = false
vim.opt.cursorline = true
vim.opt.cursorlineopt = { "number" } -- , "line"
vim.opt.ignorecase = true
vim.opt.shiftwidth = 4
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.termguicolors = true
vim.opt.undofile = true
vim.opt.signcolumn = "yes"
vim.opt.mouse = "a"
vim.opt.updatetime = 250
vim.opt.timeoutlen = 300
vim.opt.scrolloff = 10
vim.opt.confirm = true
vim.opt.showtabline = 0
vim.opt.fileformats = { "unix", "dos" }
-- vim.opt.shell = "pwsh -NoLogo"

-- these are overruled when indentexpr is set (eg by treesitter)
vim.opt.autoindent = true -- follows previous line
vim.opt.smartindent = true -- recognizes syntax like '{'
-- vim.opt.cindent = true -- more strict for c-like syntax

-- "za" to fold
vim.opt.foldenable = true
vim.opt.foldlevel = 99
vim.opt.foldcolumn = "0"

-- global clipboard
vim.schedule(function()
	vim.o.clipboard = "unnamedplus"
end)

vim.filetype.add({
	extension = {
		h = "c",
		metal = "c",
		fth = "toy",
		tf = "toy",
		toy = "toy",
		joy = "joy",
		jai = "jai",
		p101 = "p101",
	},
})

-- --------------------
--  Keymaps
-- --------------------
require("keymaps")

-- --------------------
--  Autocmds
-- --------------------
require("autocmd")

-- --------------------
--  Plugins
-- --------------------
require("config.lazy")
require("terminal")
require("cheat-sh")

-- --------------------
--  Neovide
-- --------------------
require("neovide")
