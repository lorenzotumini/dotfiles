if vim.g.neovide then
	-- vim.o.guifont = "Source Code Pro:h14"
	-- vim.o.guifont = "Iosevka Nerd Font:h15"
	vim.o.guifont = "JetBrainsMono Nerd Font:h14"

	vim.g.neovide_padding_top = 0
	vim.g.neovide_padding_bottom = 0
	vim.g.neovide_padding_right = 0
	vim.g.neovide_padding_left = 0

	local normal = vim.api.nvim_get_hl(0, { name = "Normal" })
	if normal.bg then
		vim.g.neovide_title_background_color = string.format("%x", normal.bg)
	end

	vim.g.neovide_hide_mouse_when_typing = true
	vim.g.neovide_fullscreen = false

	vim.g.neovide_cursor_animation_length = 0
	vim.g.neovide_cursor_short_animation_length = 0.04
	vim.g.neovide_cursor_trail_size = 0
end
