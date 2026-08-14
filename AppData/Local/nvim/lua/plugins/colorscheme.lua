return {
	{
		"rebelot/kanagawa.nvim",
		priority = 1000,
		config = function()
			local themes = require("themes")
			themes.load_last_theme() -- can pass a fallback
			themes.setup_autocmd()
			themes.setup_usercmd()
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
	{ "https://codeberg.org/ericrulec/gruber-darker.nvim", lazy = true },
	-- { "blazkowolf/gruber-darker.nvim", lazy = true },
	{ "lunacookies/vim-colors-xcode", lazy = true },
	{ "ribru17/bamboo.nvim", lazy = true },
	{ "EdenEast/nightfox.nvim", lazy = true },
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
