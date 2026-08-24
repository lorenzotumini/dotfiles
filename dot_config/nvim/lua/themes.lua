local M = {}

-- Theme-specific configurations
M.theme_configs = {
	cyberdream = function()
		require("cyberdream").setup({
			variant = "default",
			transparent = true,
		})
	end,
	["rose-pine"] = function()
		require("rose-pine").setup({
			palette = {
				main = {
					pine = "#3e93b5", -- #46a7cd
				},
			},
			styles = {
				bold = true,
				italic = false,
				transparency = true,
			},
		})
	end,
	onedark = function()
		require("onedark").setup({
			style = "warmer",
			-- colors = {
			-- 	grey = "#7e8084",
			-- },
		})
	end,
	["solarized-osaka"] = function()
		require("solarized-osaka").setup({
			transparent = true,
		})
	end,
	vague = function()
		require("vague").setup({
			transparent = true,
		})
	end,
}

-- Theme-specific highlights that must be applied after :colorscheme,
-- because loading a colorscheme clears existing highlight definitions.
M.theme_overrides = {
	["gruber-darker"] = function()
		vim.api.nvim_set_hl(0, "@property", { link = "GruberDarkerNiagara" })
		vim.api.nvim_set_hl(0, "CmpItemKindProperty", { link = "GruberDarkerNiagara" })
	end,
}

-- Track which themes have been setup to avoid redundant calls
M.setup_cache = {}

-- Detect terminal emulator
function M.detect_terminal()
	if vim.env.WT_SESSION then
		return "windows_terminal"
	end

	if vim.env.TERM_PROGRAM == "WezTerm" or vim.env.WEZTERM_EXECUTABLE then
		return "wezterm"
	end

	if vim.env.ALACRITTY_SOCKET or vim.env.ALACRITTY_LOG or vim.env.ALACRITTY_WINDOW_ID then
		return "alacritty"
	end

	if vim.g.neovide then
		return "neovide"
	end

	-- Fallback to TERM variable
	local term = vim.env.TERM or ""
	if term:match("alacritty") then
		return "alacritty"
	end

	return "unknown"
end

-- Get theme file path based on terminal
function M.get_theme_file()
	local data_path = vim.fn.stdpath("data")
	local terminal = M.detect_terminal()

	-- Create terminal-specific filename
	return string.format("%s/last_colorscheme_%s", data_path, terminal)
end

-- Setup a specific theme (run its config function)
function M.setup_theme(name)
	-- Only setup once per session to avoid redundant calls
	if M.setup_cache[name] then
		return true
	end

	if M.theme_configs[name] then
		local ok, err = pcall(M.theme_configs[name])
		if not ok then
			vim.notify("Failed to setup theme: " .. name .. "\n" .. tostring(err), vim.log.levels.WARN)
			return false
		end
		M.setup_cache[name] = true
	end

	return true
end

function M.apply_theme_overrides(name)
	if M.theme_overrides[name] then
		M.theme_overrides[name]()
	end
end

-- Function to safely apply a colorscheme
function M.safe_colorscheme(name)
	if not name or name == "" then
		return false
	end

	-- Setup theme-specific config if it exists
	M.setup_theme(name)

	-- Apply colorscheme
	local ok, err = pcall(vim.cmd.colorscheme, name)
	if not ok then
		vim.notify("Failed to load colorscheme: " .. name .. "\n" .. tostring(err), vim.log.levels.WARN)
		return false
	end

	M.apply_theme_overrides(name)

	return true
end

-- Load last used theme
function M.load_last_theme(default)
	default = default or "kanagawa-wave"
	local theme_file = M.get_theme_file()

	local theme = nil
	if vim.fn.filereadable(theme_file) == 1 then
		theme = vim.fn.readfile(theme_file)[1]
	end

	if theme and theme ~= "" then
		M.safe_colorscheme(theme)
	else
		M.safe_colorscheme(default)
	end
end

-- Save current theme
function M.save_current_theme(name)
	local theme_file = M.get_theme_file()
	local file = io.open(theme_file, "w")
	if file then
		file:write(name)
		file:close()
	else
		vim.notify("Failed to save theme to: " .. theme_file .. ". Check permissions.", vim.log.levels.ERROR)
	end
end

-- Setup autocmd to save theme on change AND setup theme before applying
function M.setup_autocmd()
	local group = vim.api.nvim_create_augroup("ThemeManager", { clear = true })

	-- This runs BEFORE the colorscheme is applied
	vim.api.nvim_create_autocmd("ColorSchemePre", {
		group = group,
		callback = function(args)
			M.setup_theme(args.match)
		end,
	})

	-- This runs AFTER the colorscheme is applied (for saving)
	vim.api.nvim_create_autocmd("ColorScheme", {
		group = group,
		callback = function(args)
			M.apply_theme_overrides(args.match)
			M.save_current_theme(args.match)
		end,
	})
end

-- Show current terminal info
function M.show_terminal_info()
	local terminal = M.detect_terminal()
	local theme_file = M.get_theme_file()
	local current_theme = vim.g.colors_name or "none"

	local info = string.format("Terminal: %s\nTheme file: %s\nCurrent theme: %s", terminal, theme_file, current_theme)
	vim.notify(info, vim.log.levels.INFO)
end

-- Setup user command
function M.setup_usercmd()
	vim.api.nvim_create_user_command("ColorschemeInfo", function()
		require("themes").show_terminal_info()
	end, {})
end

return M
