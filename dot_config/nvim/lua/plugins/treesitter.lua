return {
	"nvim-treesitter/nvim-treesitter",
	branch = "main",
	lazy = false,
	build = ":TSUpdate",
	config = function()
		local env = require("utils.env")
		require("nvim-treesitter").setup({
			install_dir = vim.fn.stdpath("data") .. "/site",
		})

		local function add_custom_parsers()
			local parsers = require("nvim-treesitter.parsers")

			local toy_parser = "C:/Toy/share/toy/tree-sitter-toy"
			if env.isdir(toy_parser) then
				parsers.toy = {
					install_info = {
						path = toy_parser,
						queries = "queries/toy",
					},
				}
			end
		end

		add_custom_parsers()
		vim.api.nvim_create_autocmd("User", {
			pattern = "TSUpdate",
			callback = add_custom_parsers,
		})

		vim.treesitter.language.register("toy", "toy")

		local skip_filetypes = {
			csv = true,
		}

		vim.api.nvim_create_autocmd("FileType", {
			desc = "Enable Treesitter highlighting, indentation, and folds",
			group = vim.api.nvim_create_augroup("treesitter-start", { clear = true }),
			callback = function(args)
				local filetype = vim.bo[args.buf].filetype
				if skip_filetypes[filetype] then
					return
				end

				local ok = pcall(vim.treesitter.start, args.buf)
				if not ok then
					return
				end

				vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
				vim.wo.foldmethod = "expr"
				vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
			end,
		})
	end,
}
