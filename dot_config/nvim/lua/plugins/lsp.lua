return {
	{
		"williamboman/mason.nvim",
		event = "VeryLazy",
		config = function()
			require("mason").setup({
				ui = {
					border = BORDER,
					backdrop = 100,
				},
			})
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		event = "VeryLazy",
		opts = {
			-- this is not needed to use an lsp, once installed manually form Mason it works automatically
			-- this is useful when importing this config to a new computer to install lsp automatically
			ensure_installed = {
				"clangd", -- C server
				"lua_ls", -- Lua server
				"stylua", -- Lua format
				"ts_ls", -- JS server
				"tinymist", -- Typst server
				"ty", -- Py server
				"ruff", -- Py lint, format
				-- "pyright", -- Py server
				-- "black", -- Py format
				"gopls", -- Go server
				"ols", -- Odin server
				"clojure_lsp", -- Clojure server
			},
		},
	},
	{
		"neovim/nvim-lspconfig",
		event = "VeryLazy",
		dependencies = {
			"saghen/blink.cmp",
		},
		config = function()
			local env = require("utils.env")

			vim.lsp.log.set_level("off")
			vim.lsp.config("clangd", {
				cmd = {
					"clangd",
					"--background-index",
					-- "--compile-commands-dir=" .. vim.fn.getcwd(),
				},
			})
			vim.lsp.config("powershell_es", {
				settings = {
					powershell = {
						codeFormatting = {
							openBraceOnSameLine = true, -- google style
						},
					},
				},
			})

			local toy_lsp = "C:/Toy/bin/toy-lsp.exe"
			if env.readable(toy_lsp) or env.executable("toy-lsp") then
				vim.lsp.config("toyls", {
					cmd = env.executable("toy-lsp") and { "toy-lsp" } or { toy_lsp },
					filetypes = { "toy" },
					root_markers = { ".git", "README.md" },
				})
				vim.lsp.enable("toyls")
			end

			local verible_ls = env.command_path("verible-verilog-ls")
			if verible_ls then
				vim.lsp.config("verible", {
					cmd = {
						verible_ls,
						-- linting
						"--rules_config=" .. env.config_path("lua", "plugins", ".verible_lint"),
						-- formatting
						"--column_limit=80",
						"--indentation_spaces=4",
						"--wrap_spaces=4",
						"--try_wrap_long_lines=true",
					},
				})
			end

			vim.diagnostic.config({
				virtual_text = true,
				signs = true,
				underline = true,
				update_in_insert = false,
				severity_sort = true,
			})

			vim.keymap.set("n", "<leader>lk", function()
				vim.lsp.buf.hover({ border = BORDER })
			end, { desc = "LSP Hover" })
			vim.keymap.set("n", "<leader>ld", vim.lsp.buf.definition, { desc = "LSP Go to definition" })
			-- vim.keymap.set("n", "<leader>lr", vim.lsp.buf.references, { desc = "LSP References" })
			vim.keymap.set("n", "<leader>la", vim.lsp.buf.code_action, { desc = "LSP Code actions" })
			vim.keymap.set("n", "<leader>ln", vim.lsp.buf.rename, { desc = "LSP Rename" })
			vim.keymap.set("n", "<leader>ll", function()
				if vim.diagnostic.is_enabled() then
					vim.diagnostic.enable(false)
					print("Diagnostics disabled")
				else
					vim.diagnostic.enable(true)
					print("Diagnostics enabled")
				end
			end, { desc = "LSP Toggle" })
			vim.keymap.set("n", "<leader>lt", "<cmd>InspectTree<CR>", { desc = "LSP Treesitter" })
			vim.keymap.set("n", "<leader>li", function()
				vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
			end, { desc = "LSP Inlay hints" })
		end,
	},
	{
		"nvimtools/none-ls.nvim",
		event = "VeryLazy",
		config = function()
			local env = require("utils.env")
			local null_ls = require("null-ls")

			-- https://github.com/nvimtools/none-ls.nvim/tree/main/lua/null-ls/builtins
			local sources = {
				null_ls.builtins.formatting.stylua,
				null_ls.builtins.formatting.clang_format,
				null_ls.builtins.formatting.prettier,
				null_ls.builtins.formatting.asmfmt,
				-- null_ls.builtins.formatting.black,

				-- null_ls.builtins.diagnostics.cppcheck.with({
				-- 	extra_args = function(params)
				-- 		return {
				-- 			params.bufname,
				-- 			"--suppress=normalCheckLevelMaxBranches",
				-- 			"--inline-suppr",
				-- 			"--template=gcc",
				-- 		}
				-- 	end,
				-- }),
			}

			if env.executable("emacs") then
				table.insert(
					sources,
					null_ls.builtins.formatting.emacs_vhdl_mode.with({
						args = {
							"-batch",
							"-Q",
							"--insert",
							"$FILENAME",
							"-l",
							env.config_path("lua", "plugins", ".emacs_vhdl_format.el"),
						},
					})
				)
			end

			null_ls.setup({
				border = BORDER,
				sources = sources,
			})
			vim.keymap.set("n", "<leader>f", vim.lsp.buf.format, { desc = "Format file" })
		end,
	},
}
