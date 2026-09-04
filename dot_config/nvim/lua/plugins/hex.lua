return {
	"RaafatTurki/hex.nvim",
	event = "VeryLazy",
	config = function()
		local image_extensions = {
			png = true,
			jpg = true,
			jpeg = true,
			gif = true,
			webp = true,
			avif = true,
		}
		local is_image_file = function()
			return image_extensions[vim.fn.expand("%:e"):lower()] == true
		end

		require("hex").setup({
			-- image.nvim displays these files directly. Letting hex.nvim filter them
			-- through xxd races its input pipe and raises E5677 when opened by Neo-tree.
			is_file_binary_pre_read = function()
				if is_image_file() or vim.bo.filetype ~= "" then
					return false
				end
				if vim.bo.binary then
					return true
				end
				local extension = vim.fn.expand("%:e"):lower()
				return vim.tbl_contains({ "out", "bin", "exe", "dll" }, extension)
			end,
			is_file_binary_post_read = function()
				if is_image_file() then
					return false
				end
				local encoding = vim.bo.fileencoding ~= "" and vim.bo.fileencoding or vim.o.encoding
				return encoding ~= "utf-8"
			end,
		})

		-- Safely override internal function to avoid mini.pairs conflict
		local ok, utils = pcall(require, "hex.utils")
		if ok and utils and utils.drop_undo_history then
			utils.drop_undo_history = function()
				local undolevels = vim.o.undolevels
				vim.o.undolevels = -1

				pcall(function()
					-- Avoid insert mode entirely
					vim.cmd([[noautocmd call append(0, '')]])
					vim.cmd([[noautocmd 1delete _]])
				end)

				vim.o.undolevels = undolevels
			end
		else
			vim.notify("[hex.nvim] drop_undo_history not found; plugin API may have changed", vim.log.levels.WARN)
		end

		-- Highlight definitions
		local function set_xxd_highlights()
			vim.api.nvim_set_hl(0, "xxdNull", { fg = "#5c6370" })
			vim.api.nvim_set_hl(0, "xxdPrintable", { fg = "#98c379" })
			vim.api.nvim_set_hl(0, "xxdHigh", { fg = "#e06c75" })
			vim.api.nvim_set_hl(0, "xxdControl", { fg = "#e5c07b" })
		end

		-- Augroup to prevent duplication
		local group = vim.api.nvim_create_augroup("HexXxdHighlight", { clear = true })

		vim.api.nvim_create_autocmd("FileType", {
			group = group,
			pattern = "xxd",
			callback = function()
				-- Clear existing matches to avoid stacking
				vim.fn.clearmatches()

				vim.fn.matchadd("xxdNull", [[\v(^|\s)\zs00\ze(\s|$)]])
				vim.fn.matchadd("xxdPrintable", [[\v(^|\s)\zs[2-6][0-9a-fA-F]\ze(\s|$)|(^|\s)\zs7[0-9a-eA-E]\ze(\s|$)]])
				vim.fn.matchadd("xxdHigh", [[\v(^|\s)\zs[89a-fA-F][0-9a-fA-F]\ze(\s|$)]])
				vim.fn.matchadd("xxdControl", [[\v(^|\s)\zs0[1-9a-fA-F]\ze(\s|$)|(^|\s)\zs1[0-9a-fA-F]\ze(\s|$)]])

				set_xxd_highlights()
			end,
		})

		vim.api.nvim_create_autocmd("ColorScheme", {
			group = group,
			callback = set_xxd_highlights,
		})
	end,
}
