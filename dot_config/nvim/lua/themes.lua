local M = {}

M.prefer_transparency = true
M.current_theme = nil
M.current_desktop_generation = nil

local desktop_theme_watcher = nil

-- Each family owns its native configuration and optional post-colorscheme
-- adjustments. Variants point to the same family, so Telescope previews and
-- selections behave consistently.
local theme_families = {
	{
		schemes = { "omarchy" },
		-- colors/omarchy.lua reads the live palette. Registering it as
		-- configurable lets the existing transparency commands reload it.
		configure = function() end,
	},
	{
		schemes = { "kanagawa", "kanagawa-wave", "kanagawa-dragon", "kanagawa-lotus" },
		configure = function(transparent)
			require("kanagawa").setup({ transparent = transparent })
		end,
	},
	{
		schemes = { "gruvbox" },
		configure = function(transparent)
			require("gruvbox").setup({ transparent_mode = transparent })
		end,
	},
	{
		schemes = { "tokyonight", "tokyonight-day", "tokyonight-moon", "tokyonight-night", "tokyonight-storm" },
		configure = function(transparent)
			require("tokyonight").setup({ transparent = transparent })
		end,
	},
	{
		schemes = {
			"catppuccin",
			"catppuccin-frappe",
			"catppuccin-latte",
			"catppuccin-macchiato",
			"catppuccin-mocha",
			"catppuccin-nvim",
		},
		configure = function(transparent)
			require("catppuccin").setup({ transparent_background = transparent })
		end,
	},
	{
		schemes = { "onedark" },
		configure = function(transparent)
			require("onedark").setup({
				style = "warmer",
				transparent = transparent,
			})
		end,
	},
	{
		schemes = { "dracula", "dracula-soft" },
		configure = function(transparent)
			require("dracula").setup({ transparent_bg = transparent })
		end,
	},
	{
		schemes = { "rose-pine", "rose-pine-main", "rose-pine-moon", "rose-pine-dawn" },
		configure = function(transparent)
			require("rose-pine").setup({
				palette = {
					main = {
						pine = "#3e93b5", -- #46a7cd
					},
				},
				styles = {
					bold = true,
					italic = false,
					transparency = transparent,
				},
			})
		end,
	},
	{
		schemes = { "cyberdream", "cyberdream-light", "cyberdream-muted" },
		configure = function(transparent)
			require("cyberdream").setup({
				-- Runtime transparency changes must not reuse stale highlights.
				cache = false,
				variant = "default",
				transparent = transparent,
			})
		end,
	},
	{
		schemes = { "solarized-osaka", "solarized-osaka-light", "solarized-osaka-vivid" },
		configure = function(transparent)
			require("solarized-osaka").setup({ transparent = transparent })
		end,
	},
	{
		schemes = { "vague" },
		configure = function(transparent)
			require("vague").setup({ transparent = transparent })
			-- These modules materialize highlights at require-time, so reload
			-- them after changing Vague's configuration.
			package.loaded["vague.groups"] = nil
			package.loaded["vague.highlights"] = nil
		end,
	},
	{
		schemes = { "gruber-darker" },
		after = function()
			vim.api.nvim_set_hl(0, "@property", { link = "GruberDarkerNiagara" })
			vim.api.nvim_set_hl(0, "CmpItemKindProperty", { link = "GruberDarkerNiagara" })
		end,
	},
}

local themes = {}
for _, family in ipairs(theme_families) do
	for _, scheme in ipairs(family.schemes) do
		themes[scheme] = family
	end
end

function M.detect_terminal()
	if vim.g.neovide then
		return "neovide"
	end

	if vim.env.WT_SESSION then
		return "windows_terminal"
	end

	if vim.env.TERM_PROGRAM == "WezTerm" or vim.env.WEZTERM_EXECUTABLE then
		return "wezterm"
	end

	if vim.env.TERM_PROGRAM == "ghostty" or (vim.env.TERM or ""):match("ghostty") then
		return "ghostty"
	end

	if vim.env.ALACRITTY_SOCKET or vim.env.ALACRITTY_LOG or vim.env.ALACRITTY_WINDOW_ID then
		return "alacritty"
	end

	if (vim.env.TERM or ""):match("alacritty") then
		return "alacritty"
	end

	return "unknown"
end

local function get_state_file(name)
	return string.format("%s/%s_%s", vim.fn.stdpath("data"), name, M.detect_terminal())
end

function M.get_theme_file()
	return get_state_file("last_colorscheme")
end

function M.get_transparency_file()
	return get_state_file("transparency")
end

function M.get_desktop_theme_file()
	if vim.fn.has("win32") == 1 then
		return nil
	end

	return vim.fn.expand("~/.local/state/desktop-core/neovim-theme")
end

function M.get_desktop_theme_generation_file()
	return get_state_file("desktop_theme_generation")
end

local function read_first_line(path)
	if vim.fn.filereadable(path) ~= 1 then
		return nil
	end

	return vim.fn.readfile(path)[1]
end

local function write_first_line(path, value, description)
	local ok, result = pcall(vim.fn.writefile, { value }, path)
	if not ok or result == -1 then
		vim.notify("Failed to save " .. description .. " to: " .. path, vim.log.levels.ERROR)
		return false
	end

	return true
end

function M.load_transparency_preference()
	local value = read_first_line(M.get_transparency_file())
	if value == "true" then
		M.prefer_transparency = true
	elseif value == "false" then
		M.prefer_transparency = false
	end
end

function M.save_transparency_preference()
	return write_first_line(M.get_transparency_file(), tostring(M.prefer_transparency), "transparency preference")
end

function M.configure_theme(name)
	local theme = themes[name]
	if not theme or not theme.configure then
		return true
	end

	local ok, err = pcall(theme.configure, M.prefer_transparency)
	if not ok then
		return false, "Failed to configure theme " .. name .. ":\n" .. tostring(err)
	end

	return true
end

function M.apply_theme_overrides(name)
	local theme = themes[name]
	if theme and theme.after then
		theme.after()
	end
end

function M.supports_transparency(name)
	local theme = themes[name]
	return theme ~= nil and theme.configure ~= nil
end

function M.safe_colorscheme(name)
	if not name or name == "" then
		return false
	end

	local ok, err = pcall(vim.cmd.colorscheme, name)
	if not ok then
		vim.notify("Failed to load colorscheme " .. name .. ":\n" .. tostring(err), vim.log.levels.WARN)
		return false
	end

	return true
end

function M.save_current_theme(name)
	return write_first_line(M.get_theme_file(), name, "colorscheme")
end

local function read_desktop_theme()
	local path = M.get_desktop_theme_file()
	if not path or vim.fn.filereadable(path) ~= 1 then
		return nil
	end

	local desktop = {}
	for _, line in ipairs(vim.fn.readfile(path)) do
		local key, value = line:match("^([%w_]+)=(.*)$")
		if key then
			desktop[key] = value
		end
	end

	if not desktop.generation or not desktop.colorscheme or desktop.colorscheme == "" then
		return nil
	end

	return desktop
end

function M.load_desktop_theme(force)
	local desktop = read_desktop_theme()
	if not desktop then
		return false
	end
	if M.current_desktop_generation == desktop.generation then
		return false
	end

	local applied_generation = read_first_line(M.get_desktop_theme_generation_file())
	if not force and applied_generation == desktop.generation then
		M.current_desktop_generation = desktop.generation
		return false
	end

	vim.api.nvim_exec_autocmds("User", { pattern = "DesktopThemeChanging" })
	if not M.safe_colorscheme(desktop.colorscheme) then
		return false
	end

	M.current_desktop_generation = desktop.generation
	write_first_line(M.get_desktop_theme_generation_file(), desktop.generation, "desktop theme generation")
	vim.api.nvim_exec_autocmds("User", {
		pattern = "DesktopThemeChanged",
		data = { theme = desktop.theme, colorscheme = desktop.colorscheme },
	})
	return true
end

function M.watch_desktop_theme()
	local path = M.get_desktop_theme_file()
	if not path or desktop_theme_watcher then
		return
	end

	local directory = vim.fs.dirname(path)
	local filename = vim.fs.basename(path)
	desktop_theme_watcher = vim.uv.new_fs_event()
	if not desktop_theme_watcher then
		return
	end

	local ok = desktop_theme_watcher:start(directory, {}, function(error_message, changed_name)
		if error_message or changed_name ~= filename then
			return
		end
		vim.schedule(function()
			-- The desktop writes this file atomically after Ghostty has reloaded
			-- its new palette. Force every live Neovim process to consume the
			-- generation; the on-disk marker is only a startup/manual-theme aid.
			M.load_desktop_theme(true)
		end)
	end)

	if not ok then
		desktop_theme_watcher:close()
		desktop_theme_watcher = nil
		return
	end

	vim.api.nvim_create_autocmd("VimLeavePre", {
		once = true,
		callback = function()
			if desktop_theme_watcher and not desktop_theme_watcher:is_closing() then
				desktop_theme_watcher:stop()
				desktop_theme_watcher:close()
			end
			desktop_theme_watcher = nil
		end,
	})
end

function M.load_last_theme(default)
	default = default or "kanagawa-wave"
	if M.load_desktop_theme() then
		return
	end

	local saved = read_first_line(M.get_theme_file())

	if saved and saved ~= "" and M.safe_colorscheme(saved) then
		return
	end

	if saved ~= default then
		M.safe_colorscheme(default)
	end
end

function M.set_transparency(enabled)
	if M.prefer_transparency == enabled then
		return
	end

	M.prefer_transparency = enabled
	M.save_transparency_preference()

	local current = M.current_theme or vim.g.colors_name
	if not current then
		return
	end

	if M.supports_transparency(current) then
		M.safe_colorscheme(current)
	else
		vim.notify(current .. " does not have configured transparency support", vim.log.levels.INFO)
	end
end

function M.setup_autocmd()
	local group = vim.api.nvim_create_augroup("ThemeManager", { clear = true })

	vim.api.nvim_create_autocmd("ColorSchemePre", {
		group = group,
		callback = function(args)
			local ok, err = M.configure_theme(args.match)
			if not ok then
				error(err)
			end
		end,
	})

	vim.api.nvim_create_autocmd("ColorScheme", {
		group = group,
		callback = function(args)
			-- Some themes report a family name in g:colors_name even when a
			-- variant was selected, so retain the exact command/event name.
			M.current_theme = args.match
			M.apply_theme_overrides(args.match)
			M.save_current_theme(args.match)
		end,
	})
end

function M.show_terminal_info()
	local current = M.current_theme or vim.g.colors_name or "none"
	local support = current ~= "none" and tostring(M.supports_transparency(current)) or "n/a"
	local info = string.format(
		"Terminal: %s\nTheme file: %s\nCurrent theme: %s\nTransparency preferred: %s\nTheme supports transparency: %s",
		M.detect_terminal(),
		M.get_theme_file(),
		current,
		tostring(M.prefer_transparency),
		support
	)
	vim.notify(info, vim.log.levels.INFO)
end

function M.setup_usercmd()
	vim.api.nvim_create_user_command("ColorschemeInfo", M.show_terminal_info, {})
	vim.api.nvim_create_user_command("TransparencyToggle", function()
		M.set_transparency(not M.prefer_transparency)
	end, {})
	vim.api.nvim_create_user_command("TransparencyOn", function()
		M.set_transparency(true)
	end, {})
	vim.api.nvim_create_user_command("TransparencyOff", function()
		M.set_transparency(false)
	end, {})
end

function M.setup(opts)
	opts = opts or {}
	M.load_transparency_preference()
	M.setup_autocmd()
	M.setup_usercmd()
	M.load_last_theme(opts.default)
	M.watch_desktop_theme()
end

return M
