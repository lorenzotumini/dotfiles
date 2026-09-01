local plugins = {
	{
		"rebelot/kanagawa.nvim",
		priority = 1000,
		config = function()
			require("themes").setup({ default = "kanagawa-wave" })
		end,
	},

	{ "ellisonleao/gruvbox.nvim", lazy = true },
	{ "folke/tokyonight.nvim", lazy = true },
	{ "catppuccin/nvim", name = "catppuccin", lazy = true },
	{ "navarasu/onedark.nvim", lazy = true },
	-- { "olimorris/onedarkpro.nvim", lazy = true },
	{ "mofiqul/dracula.nvim", lazy = true },
	{ "rose-pine/neovim", name = "rose-pine", lazy = true },
	{ "scottmckendry/cyberdream.nvim", lazy = true },
	{ "Mofiqul/vscode.nvim", lazy = true },
	{ "everviolet/nvim", name = "evergarden", lazy = true },
	{ "craftzdog/solarized-osaka.nvim", lazy = true },
	{ "vague-theme/vague.nvim", lazy = true },
	{ "blazkowolf/gruber-darker.nvim", lazy = true },
	{ "lunacookies/vim-colors-xcode", lazy = true },
	{ "ribru17/bamboo.nvim", lazy = true },
	{ "EdenEast/nightfox.nvim", lazy = true },

	-- Keep every plugin-backed stock Omarchy theme declared permanently.
	-- desktop-theme-sync chooses among them at runtime; a theme switch must not
	-- change Lazy's plugin graph or make the previous theme look orphaned.
	{ "neanias/everforest-nvim", lazy = true },
	{ "kepano/flexoki-neovim", lazy = true },
	{
		"bjarneo/hackerman.nvim",
		dependencies = {
			{ "bjarneo/aether.nvim", branch = "v3", name = "aether" },
		},
		lazy = true,
	},
	{ "omacom-io/lumon.nvim", lazy = true },
	{ "tahayvr/matteblack.nvim", lazy = true },
	{ "OldJobobo/retro-82.nvim", lazy = true },
	{ "ficcdaf/ashen.nvim", lazy = true },
	-- Omarchy generates a palette-specific Aether spec for stock themes that do
	-- not ship a native Neovim theme (Last Horizon, Ethereal, and others).
	{ "bjarneo/aether.nvim", branch = "v3", name = "aether", lazy = true },
	{ 'projekt0n/github-nvim-theme', name = 'github-theme', lazy = true },
	{
		"hirokoclanger/j_blow_emacs_theme_nvim",
		lazy = true,
		build = function(plugin)
			local colors_dir = plugin.dir .. "/colors"
			vim.fn.mkdir(colors_dir, "p")
			local src = plugin.dir .. "/jblow.vim"
			local dst = colors_dir .. "/jblow.vim"
			if vim.fn.filereadable(src) == 1 then
				vim.fn.writefile(vim.fn.readfile(src), dst)
			end
		end,
		init = function(plugin)
			local colors_dir = plugin.dir .. "/colors"
			local src = plugin.dir .. "/jblow.vim"
			local dst = colors_dir .. "/jblow.vim"
			if vim.fn.filereadable(src) == 1 and vim.fn.filereadable(dst) == 0 then
				vim.fn.mkdir(colors_dir, "p")
				vim.fn.writefile(vim.fn.readfile(src), dst)
			end
		end,
	},

	{
		"catgoose/nvim-colorizer.lua",
		event = { "BufReadPre", "BufNewFile" },
		opts = { parsers = { names = { enable = false } } },
	},
}

-- Import the active theme's options after declaring the complete permanent
-- plugin set above. For native themes this merges into an existing spec; for
-- fallback themes it supplies Aether's generated palette. Consequently a
-- desktop theme switch changes configuration, never Lazy's plugin graph.
if vim.fn.has("win32") == 0 then
	local theme_spec = vim.fn.expand("~/.local/state/omarchy/current/theme/neovim.lua")
	if vim.fn.filereadable(theme_spec) == 1 then
		local ok, specs = pcall(dofile, theme_spec)
		if ok and type(specs) == "table" then
			for _, spec in ipairs(specs) do
				local repository = type(spec) == "table" and spec[1] or spec
				if repository ~= "LazyVim/LazyVim" then
					table.insert(plugins, spec)
				end
			end
		end
	end
end

return plugins
