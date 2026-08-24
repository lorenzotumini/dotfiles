return {
	"brenton-leighton/multiple-cursors.nvim",
	version = "*",
	opts = {},
	keys = {
		{
			"<C-Up>",
			"<Cmd>MultipleCursorsAddUp<CR>",
			mode = { "n", "i", "x" },
			desc = "Add cursor and move up",
		},
		{
			"<C-Down>",
			"<Cmd>MultipleCursorsAddDown<CR>",
			mode = { "n", "i", "x" },
			desc = "Add cursor and move down",
		},
		{
			"<C-LeftMouse>",
			"<Cmd>MultipleCursorsMouseAddDelete<CR>",
			mode = { "n", "i" },
			desc = "Add or remove cursor on mouse click",
		},

		-- conflict with pane navigation
		-- {
		-- 	"<C-j>",
		-- 	"<Cmd>MultipleCursorsAddDown<CR>",
		-- 	mode = { "n", "x" },
		-- 	desc = "Add cursor and move down",
		-- },
		-- {
		-- 	"<C-k>",
		-- 	"<Cmd>MultipleCursorsAddUp<CR>",
		-- 	mode = { "n", "x" },
		-- 	desc = "Add cursor and move up",
		-- },

		{
			"<Leader>hm",
			"<Cmd>MultipleCursorsAddVisualArea<CR>",
			mode = { "x" },
			desc = "Add cursors to the lines of the visual area",
		},
		{
			"<Leader>ha",
			"<Cmd>MultipleCursorsAddMatches<CR>",
			mode = { "n", "x" },
			desc = "Add cursors to cword",
		},
		{
			"<Leader>hA",
			"<Cmd>MultipleCursorsAddMatchesV<CR>",
			mode = { "n", "x" },
			desc = "Add cursors to cword in previous area",
		},
		{
			"<Leader>hd",
			"<Cmd>MultipleCursorsAddJumpNextMatch<CR>",
			mode = { "n", "x" },
			desc = "Add cursor and jump to next cword",
		},
		{
			"<Leader>hD",
			"<Cmd>MultipleCursorsJumpNextMatch<CR>",
			mode = { "n", "x" },
			desc = "Jump to next cword",
		},
	},
}
