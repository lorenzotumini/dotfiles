return {
	{
		"CRAG666/code_runner.nvim",
		event = "VeryLazy",
		-- dependencies = {
		-- 	"CRAG666/betterTerm.nvim", -- for better_term mode
		-- },
		config = function()
			local env = require("utils.env")
			local filetype = {
				lua = "cd $dir && lua54 $fileName", -- by default uses nvim api
				-- lua = 'pwsh -NoProfile -Command "lua54 \"$file\""',
				python = env.is_windows and "cd $dir && python -u $fileName" or "cd $dir && python3 -u $fileName",
				-- python = 'pwsh -NoProfile -Command "python "$file""',
				go = "cd $dir && go run $fileName",
				odin = "cd $dir && odin run $dir",
				clojure = "cd $dir && clj -M $fileName",
				toy = "cd $dir && toy $dir",
				cuda = "cd $dir && nvcc $fileName -o $fileNameWithoutExt && $fileNameWithoutExt",
				haskell = "cd $dir && runghc $fileName",
				cpp = "cd $dir && g++ -std=c++23 $fileName -o $fileNameWithoutExt && $fileNameWithoutExt",
				icon = "cd $dir && icont $fileName && $fileNameWithoutExt",
				rust = "cd $dir && rustc $fileName && $fileNameWithoutExt",
			}

			if env.is_windows and env.readable("C:/iverilog/bin/simulate.ps1") then
				filetype.verilog =
					'pwsh -NoProfile -ExecutionPolicy Bypass -File "C:/iverilog/bin/simulate.ps1" "$file"'
			elseif env.executable("iverilog") and env.executable("vvp") then
				filetype.verilog = "cd $dir && iverilog -o sim.out $fileName && vvp sim.out"
			end

			require("code_runner").setup({
				mode = "term", -- term, tab, float, toggle, vimux, better_term
				root_markers = {},
				term = {
					position = "below",
					-- "bot" goes over center.lua,
					-- "below is aligned to current buffer
				},
				float = { border = BORDER },
				filetype = filetype,
			})
			vim.keymap.set("n", "<leader><CR>", "<cmd>RunCode<CR>", { desc = "Run code" })
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "crunner",
				callback = function()
					vim.wo.number = true
					vim.wo.relativenumber = true
					vim.wo.signcolumn = "yes"
				end,
			})
		end,
	},
	{
		"ej-shafran/compile-mode.nvim",
		version = "^5.0.0",
		branch = "latest",
		event = "VeryLazy", -- gives snacks input time to load
		dependencies = {
			"nvim-lua/plenary.nvim",
			-- { "m00qek/baleia.nvim", tag = "v1.3.0" },
		},
		config = function()
			vim.g.compile_mode = {
				input_word_completion = true,
				default_command = "",
				baleia_setup = false,
				-- replace special characters (e.g. `%`) to behave more like `:!`
				bang_expansion = false,
				-- auto_jump_to_first_error = false,
			}
			vim.keymap.set("n", "<leader>c", "<cmd>below Compile<CR>", { desc = "Compile Mode" })
			-- vim.api.nvim_create_autocmd("FileType", {
			-- 	pattern = "compilation",
			-- 	callback = function()
			-- 		vim.wo.number = false
			-- 		vim.wo.signcolumn = "no"
			-- 	end,
			-- })
		end,
	},
}
