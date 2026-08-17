-- plugins dedicated to specific languages
return {
	-- alternative https://liquidz.github.io/vim-iced/
	{
		"Olical/conjure",
		ft = { "clojure", "edn" },
		keys = {
			{ "<leader>oo", ":Lazy load conjure<cr>", desc = "Load conjure" },
			{ "<leader>oe", "<cmd>ConjureEval<cr>", desc = "Eval form" },
			{ "<leader>of", "<cmd>ConjureEvalFile<cr>", desc = "Eval file" },
			{ "<leader>ow", "<cmd>ConjureEvalWord<cr>", desc = "Eval word" },
			{ "<leader>or", "<cmd>ConjureEvalReplaceForm<cr>", desc = "Eval and replace" },
			{ "<leader>oe", "<cmd>ConjureEvalMotion<cr>", mode = "v", desc = "Eval selection" },
			-- log
			-- { "<leader>ol", "<cmd>ConjureLogCloseVisible<cr>", "Close log windows" },
			-- { "<leader>oj", "<cmd>ConjureLogJumpToLatest<cr>", "Jump to latest log entry" },
		},
		init = function()
			vim.g["conjure#log#hud#anchor"] = "SW"
			vim.g["conjure#log#hud#max_lines"] = 10
			vim.g["conjure#log#hud#ignore_sole_whitespace"] = true
			vim.g["conjure#extract#tree_sitter#enabled"] = true
			-- disable conjure defaults
			vim.g["conjure#mapping#prefix"] = "<localleader>"
			vim.g["conjure#mapping#doc_word"] = false
			vim.g["conjure#mapping#log_split"] = false
			vim.g["conjure#mapping#log_vsplit"] = false
			vim.g["conjure#mapping#log_tab"] = false
			vim.g["conjure#mapping#log_buf"] = false
			vim.g["conjure#mapping#log_toggle"] = false
			vim.g["conjure#mapping#eval_current_form"] = false
			vim.g["conjure#mapping#eval_root_form"] = false
			vim.g["conjure#mapping#eval_buf"] = false
			vim.g["conjure#mapping#eval_visual"] = false
		end,
		config = function()
			local buffer = require("conjure.buffer")
			local original_upsert = buffer["upsert-hidden"]
			-- remove sponsor name
			buffer["upsert-hidden"] = function(name, cb)
				return original_upsert(name, function(buf)
					cb(buf)
					vim.schedule(function()
						if vim.api.nvim_buf_is_valid(buf) then
							local first = vim.api.nvim_buf_get_lines(buf, 0, 1, false)[1]

							if first and first:find("Sponsored by @", 1, true) then
								vim.api.nvim_buf_set_lines(buf, 0, 1, false, { "" })
							end
						end
					end)
				end)
			end
			-- clojure-specific mappings
			vim.api.nvim_create_autocmd("FileType", {
				pattern = { "clojure", "edn" },
				callback = function(ev)
					local map = function(lhs, rhs, desc)
						vim.keymap.set("n", lhs, rhs, {
							buffer = ev.buf,
							desc = desc,
						})
					end
					-- namespace refresh
					map("<leader>on", "<cmd>ConjureCljRefreshChanged<cr>", "Refresh changed namespaces")
					map("<leader>oN", "<cmd>ConjureCljRefreshAll<cr>", "Refresh all namespaces")
					-- tests
					-- map("<leader>ot", "<cmd>ConjureCljRunCurrentTest<cr>", "Run test under cursor")
					-- map("<leader>oT", "<cmd>ConjureCljRunCurrentNsTests<cr>", "Run tests in current ns")
					-- docs / navigation
					map("<leader>od", "<cmd>ConjureDefWord<cr>", "Go to definition")
					map("<leader>os", "<cmd>ConjureCljViewSource<cr>", "View source")
					-- connection
					-- map("<leader>oc", "<cmd>ConjureCljConnectPortFile<cr>", "Connect via port file")
					-- map("<leader>oq", "<cmd>ConjureCljDisconnect<cr>", "Disconnect")
				end,
			})
		end,
	},
	{
		"gpanders/nvim-parinfer",
		ft = { "clojure", "edn" },
		config = function()
			vim.api.nvim_create_autocmd("FileType", {
				pattern = { "clojure", "edn" },
				callback = function()
					vim.b.minipairs_disable = true
					vim.b.minisurround_disable = true
				end,
				desc = "Disable mini.pairs and mini.surround for Lisps",
			})
		end,
	},
}
