-- Palette-backed fallback for Omarchy themes that do not ship a native
-- Neovim plugin. Native themes continue to use their upstream colorscheme.
local palette_path = vim.fn.expand("~/.local/state/omarchy/current/theme/colors.toml")
local palette = {}

if vim.fn.filereadable(palette_path) == 1 then
	for _, line in ipairs(vim.fn.readfile(palette_path)) do
		local key, value = line:match('^([%w_]+)%s*=%s*"(#[%x]+)"')
		if key then
			palette[key] = value
		end
		local mode = line:match('^mode%s*=%s*"(light)"')
		if mode then
			palette.mode = mode
		end
	end
end

local c = setmetatable(palette, {
	__index = {
		background = "#1e1e2e",
		dark_background = "#181825",
		lighter_background = "#313244",
		foreground = "#cdd6f4",
		dark_foreground = "#6c7086",
		light_foreground = "#bac2de",
		accent = "#89b4fa",
		selection = "#45475a",
		muted = "#6c7086",
		red = "#f38ba8",
		yellow = "#f9e2af",
		orange = "#fab387",
		green = "#a6e3a1",
		cyan = "#94e2d5",
		blue = "#89b4fa",
		magenta = "#cba6f7",
	},
})

vim.cmd("highlight clear")
if vim.fn.exists("syntax_on") == 1 then
	vim.cmd("syntax reset")
end
vim.o.background = c.mode == "light" and "light" or "dark"
vim.g.colors_name = "omarchy"

local transparent = false
local ok, themes = pcall(require, "themes")
if ok then
	transparent = themes.prefer_transparency == true
end

local normal_bg = transparent and "NONE" or c.background
local set = vim.api.nvim_set_hl
local function link(name, target)
	set(0, name, { link = target })
end

set(0, "Normal", { fg = c.foreground, bg = normal_bg })
set(0, "NormalNC", { fg = c.foreground, bg = normal_bg })
set(0, "NormalFloat", { fg = c.foreground, bg = c.dark_background })
set(0, "FloatBorder", { fg = c.accent, bg = c.dark_background })
set(0, "CursorLine", { bg = c.lighter_background })
set(0, "CursorColumn", { bg = c.lighter_background })
set(0, "ColorColumn", { bg = c.lighter_background })
set(0, "LineNr", { fg = c.muted })
set(0, "CursorLineNr", { fg = c.accent, bold = true })
set(0, "Visual", { bg = c.selection })
set(0, "Search", { fg = c.background, bg = c.yellow })
set(0, "IncSearch", { fg = c.background, bg = c.orange })
link("CurSearch", "IncSearch")
set(0, "MatchParen", { fg = c.accent, bold = true, underline = true })
set(0, "StatusLine", { fg = c.foreground, bg = c.lighter_background })
set(0, "StatusLineNC", { fg = c.muted, bg = c.dark_background })
set(0, "WinSeparator", { fg = c.muted })
set(0, "Pmenu", { fg = c.foreground, bg = c.dark_background })
set(0, "PmenuSel", { fg = c.foreground, bg = c.selection, bold = true })
set(0, "Folded", { fg = c.muted, bg = c.dark_background })
set(0, "Title", { fg = c.accent, bold = true })
set(0, "Directory", { fg = c.blue })
set(0, "ErrorMsg", { fg = c.red, bold = true })
set(0, "WarningMsg", { fg = c.yellow })
set(0, "MoreMsg", { fg = c.green })
set(0, "Question", { fg = c.cyan })

set(0, "Comment", { fg = c.muted, italic = true })
set(0, "Constant", { fg = c.orange })
set(0, "String", { fg = c.green })
set(0, "Character", { fg = c.green })
set(0, "Number", { fg = c.orange })
set(0, "Boolean", { fg = c.orange })
set(0, "Identifier", { fg = c.cyan })
set(0, "Function", { fg = c.blue })
set(0, "Statement", { fg = c.magenta })
set(0, "Operator", { fg = c.light_foreground })
set(0, "PreProc", { fg = c.magenta })
set(0, "Type", { fg = c.yellow })
set(0, "Special", { fg = c.accent })
set(0, "Underlined", { fg = c.blue, underline = true })
set(0, "Todo", { fg = c.background, bg = c.yellow, bold = true })

set(0, "DiagnosticError", { fg = c.red })
set(0, "DiagnosticWarn", { fg = c.yellow })
set(0, "DiagnosticInfo", { fg = c.blue })
set(0, "DiagnosticHint", { fg = c.cyan })
link("@comment", "Comment")
link("@string", "String")
link("@number", "Number")
link("@boolean", "Boolean")
link("@variable", "Identifier")
link("@variable.builtin", "Special")
link("@function", "Function")
link("@function.builtin", "Special")
link("@keyword", "Statement")
link("@operator", "Operator")
link("@type", "Type")
link("@property", "Identifier")
link("@punctuation", "Operator")
set(0, "GitSignsAdd", { fg = c.green })
set(0, "GitSignsChange", { fg = c.yellow })
set(0, "GitSignsDelete", { fg = c.red })
