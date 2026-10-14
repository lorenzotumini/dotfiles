-- Run from the source root with a real llama.vim checkout:
-- XDG_STATE_HOME=/tmp/nvim-completion-test NVIM_LLAMA_TEST_PLUGIN=/tmp/nvim-local-llama-plugin \
--   nvim --headless -u NONE -i NONE -l tests/test_nvim_local_completion.lua
local root = vim.fn.getcwd()
package.path = root .. "/dot_config/nvim/lua/?.lua;" .. package.path
vim.opt.rtp:prepend(root .. "/dot_config/nvim")
vim.opt.rtp:prepend(assert(vim.env.NVIM_LLAMA_TEST_PLUGIN))
vim.fn.mkdir(vim.fn.stdpath("state"), "p")
vim.fn.writefile({ "off" }, vim.fn.stdpath("state") .. "/copilot-mode")

local requests = {}
vim.system = function(command, _, callback)
	requests[#requests + 1] = { command = command, callback = callback }
end
vim.notify = function() end
local cloud_attaches = 0
local cloud_detaches = 0
local nes_clears = 0
package.loaded["copilot.client"] = {
	is_disabled = function()
		return false
	end,
	buf_attach = function()
		cloud_attaches = cloud_attaches + 1
	end,
	buf_detach_if_attached = function()
		cloud_detaches = cloud_detaches + 1
	end,
}
package.loaded["copilot-lsp.nes"] = {
	clear = function()
		nes_clears = nes_clears + 1
	end,
}
package.loaded["blink.cmp"] = { hide = function() end }
package.loaded["lazy"] = {
	load = function(args)
		if vim.tbl_contains(args.plugins, "llama.vim") and vim.fn.exists("*llama#enable") == 0 then
			dofile(root .. "/dot_config/nvim/lua/plugins/llama.lua").init()
			vim.cmd("runtime plugin/llama.vim")
		end
	end,
}
local spec = dofile(root .. "/dot_config/nvim/lua/plugins/copilot.lua")[2]
spec.init()

local function reply(code)
	local request = assert(table.remove(requests, 1), "expected asynchronous request")
	request.callback({ code = code or 0, stdout = '{"status":"ok"}', stderr = "test failure" })
	local done = false
	vim.schedule(function()
		done = true
	end)
	assert(vim.wait(200, function()
		return done
	end))
	return request.command
end
local function local_maps(bufnr)
	return vim.tbl_filter(function(map)
		return map.desc == "Accept local completion full"
	end, vim.api.nvim_buf_get_keymap(bufnr, "i"))
end
local function activate()
	vim.cmd("CompletionMode local")
	assert(vim.g.copilot_mode == "local")
	assert(reply()[1] == "systemctl")
	assert(reply()[1] == "curl")
	assert(#local_maps(0) == 1)
	assert(not spec.opts.should_attach(0))
end

vim.cmd("CompletionMode ghost")
assert(cloud_attaches == 1)

-- Restored local mode can become ready while a startup dashboard/scratch
-- buffer is current, before llama#enable has ever created its augroup.
local startup_file = vim.api.nvim_get_current_buf()
local startup_scratch = vim.api.nvim_create_buf(false, true)
vim.api.nvim_set_current_buf(startup_scratch)
vim.cmd("CompletionMode local")
reply()
assert(vim.fn.exists("#llama") == 0, "fixture must exercise disable before first enable")
vim.v.errmsg = ""
reply()
assert(vim.v.errmsg == "", "startup suspension must not fail: " .. vim.v.errmsg)
assert(#local_maps(startup_scratch) == 0)
vim.api.nvim_exec_autocmds("BufEnter", { buffer = startup_scratch })
vim.api.nvim_set_current_buf(startup_file)
assert(#local_maps(startup_file) == 1, "completion must attach when entering a code buffer")
vim.cmd("CompletionMode off")

activate()
assert(cloud_detaches > 0 and nes_clears > 0)
assert(vim.fn["llama#is_fim_hint_shown"]() == false)
-- Accept with no suggestion must be harmless, including upstream Vim booleans.
local_maps(0)[1].callback()

-- Blink owns Tab: menu acceptance has priority, then ghost acceptance, then
-- ordinary Tab. A visible local hint consumes Tab; absent hints do not.
local tab_actions = dofile(root .. "/dot_config/nvim/lua/plugins/completion.lua").opts.keymap["<Tab>"]
assert(tab_actions[1] == "accept" and tab_actions[3] == "fallback")
local tab_ghost = tab_actions[2]
assert(tab_ghost() == nil)
local original_hint = vim.fn["llama#is_fim_hint_shown"]
local original_accept = vim.fn["llama#fim_accept"]
local accepted_kind
local write_on_accept = false
vim.fn["llama#is_fim_hint_shown"] = function()
	return true
end
vim.fn["llama#fim_accept"] = function(kind)
	accepted_kind = kind
	if write_on_accept then
		vim.fn.setline(1, "accepted local suggestion")
	end
end
assert(tab_ghost() == true and accepted_kind == nil, "acceptance must be deferred outside textlock")
assert(vim.wait(200, function()
	return accepted_kind == "full"
end))

-- Exercise an actual Insert-mode expr mapping, just like Blink's Tab. Calling
-- the callback directly does not reproduce Neovim's textlock restriction.
local config = vim.g.llama_config
config.auto_fim = false
vim.g.llama_config = config
vim.fn["llama#setup_autocmds"]()
write_on_accept = true
vim.keymap.set("i", "<Tab>", function()
	return tab_ghost() and "" or "\t"
end, { buffer = 0, expr = true })
vim.v.errmsg = ""
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("i<Tab><Esc>", true, false, true), "xt", false)
assert(
	vim.wait(200, function()
		return vim.api.nvim_get_current_line() == "accepted local suggestion"
	end),
	"expr Tab must accept without editing under textlock"
)
assert(vim.v.errmsg == "", vim.v.errmsg)
vim.keymap.del("i", "<Tab>", { buffer = 0 })
vim.bo.modified = false

-- A queued acceptance must not act at a new cursor location.
write_on_accept = false
accepted_kind = nil
assert(tab_ghost() == true)
local cursor = vim.api.nvim_win_get_cursor(0)
vim.api.nvim_win_set_cursor(0, { cursor[1], cursor[2] + 1 })
local deferred_done = false
vim.schedule(function()
	deferred_done = true
end)
assert(vim.wait(200, function()
	return deferred_done
end))
assert(accepted_kind == nil, "cursor movement must cancel deferred acceptance")
vim.fn["llama#is_fim_hint_shown"] = original_hint
vim.fn["llama#fim_accept"] = original_accept

local first = vim.api.nvim_get_current_buf()
local second = vim.api.nvim_create_buf(true, false)
vim.api.nvim_set_current_buf(second)
assert(#local_maps(second) == 1)
vim.cmd("let g:fim_timer = timer_start(10000, {-> llama#fim(-1, -1, v:true, [], v:false)})")
vim.cmd("let g:other_timer = timer_start(10000, {-> 1})")
vim.cmd("CompletionMode blink")
assert(#local_maps(first) == 0 and #local_maps(second) == 0)
assert(spec.opts.should_attach(second))
assert(tab_ghost() == nil, "local Tab handler must be inactive in Copilot menu mode")
assert(#vim.fn.timer_info(vim.g.fim_timer) == 0, "upstream debounce timer must be cancelled")
assert(#vim.fn.timer_info(vim.g.other_timer) == 1, "other plugins' timers must be left alone")
vim.fn.timer_stop(vim.g.other_timer)

local cloud_accepted = false
package.loaded["copilot.suggestion"] = {
	is_visible = function()
		return true
	end,
	accept = function()
		cloud_accepted = true
	end,
	dismiss = function() end,
}
vim.cmd("CompletionMode ghost")
assert(tab_ghost() == true and cloud_accepted, "Copilot ghost Tab acceptance must still work")

activate()
vim.cmd("enew")
assert(#local_maps(0) == 1, "maps must be restored when enew reuses a buffer")
vim.cmd("CompletionMode off")

-- A late health result cannot enable local suggestions after switching off.
vim.cmd("CompletionMode local")
reply()
vim.cmd("CompletionMode off")
reply()
assert(#local_maps(0) == 0)
assert(vim.g.copilot_mode == "off")

-- A failed start must reset both the active mode and its persisted value.
vim.cmd("CompletionMode local")
reply(1)
assert(vim.g.copilot_mode == "off")
assert(vim.fn.readfile(vim.fn.stdpath("state") .. "/copilot-mode")[1] == "off")

activate()
vim.cmd("LocalLlamaStop")
assert(vim.g.copilot_mode == "off" and #local_maps(0) == 0)
assert(reply()[3] == "stop")
print("Local completion integration: mode switching, buffer maps, cancellation, startup failure, and stop passed")
vim.cmd("qa!")
