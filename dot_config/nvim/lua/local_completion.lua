local M = {}
local service = "nvim-local-llama.service"
local generation = 0
local ready = false
local attached = {}
local keys = { "<M-l>", "<M-w>", "<M-e>", "<M-]>", "<M-[>", "<C-]>", "<M-f>" }

-- Upstream disable/profile_changed cancel jobs but leave the FIM retry timer
-- alive. Inspect only lambda timers that explicitly call llama#fim; leave
-- other plugins' timers alone. Vim funcrefs cannot be inspected through Lua.
vim.cmd([[
function! NvimLocalLlamaCancelTimers() abort
    for l:timer in timer_info()
        let l:name = matchstr(string(l:timer.callback), '<lambda>\d\+')
        if !empty(l:name) && stridx(execute('function ' . l:name), 'llama#fim(') >= 0
            call timer_stop(l:timer.id)
        endif
    endfor
endfunction
]])

local function suspend()
	vim.fn.NvimLocalLlamaCancelTimers()
	vim.fn["llama#profile_changed"]()
	-- With enable_at_startup=false, a dashboard can be suspended before the
	-- first enable. Upstream disable assumes its augroup already exists.
	vim.api.nvim_create_augroup("llama", { clear = false })
	vim.fn["llama#disable"]()
end

local function eligible()
	return vim.bo.buftype == "" and vim.bo.buflisted and vim.bo.modifiable
end

function M.accept(kind)
	if ready and vim.g.copilot_mode == "local" and eligible() and vim.fn["llama#is_fim_hint_shown"]() then
		local token = generation
		local bufnr = vim.api.nvim_get_current_buf()
		local winid = vim.api.nvim_get_current_win()
		local changedtick = vim.api.nvim_buf_get_changedtick(bufnr)
		local cursor = vim.api.nvim_win_get_cursor(winid)
		-- Blink's Tab callback is an expr mapping and runs under textlock.
		-- Consume the key now, then edit only after expression evaluation ends.
		vim.schedule(function()
			if
				ready
				and token == generation
				and vim.g.copilot_mode == "local"
				and vim.api.nvim_get_current_buf() == bufnr
				and vim.api.nvim_get_current_win() == winid
				and vim.api.nvim_buf_get_changedtick(bufnr) == changedtick
				and vim.deep_equal(vim.api.nvim_win_get_cursor(winid), cursor)
				and eligible()
				and vim.fn["llama#is_fim_hint_shown"]()
			then
				vim.fn["llama#fim_accept"](kind or "full")
			end
		end)
		return true
	end
end

local function attach()
	if not ready or vim.g.copilot_mode ~= "local" then
		return
	end
	if not eligible() then
		suspend()
		return
	end
	vim.fn["llama#enable"]()
	local bufnr = vim.api.nvim_get_current_buf()
	attached[bufnr] = true
	local function map(key, callback, desc)
		vim.keymap.set("i", key, callback, { buffer = bufnr, desc = desc })
	end
	for key, kind in pairs({ ["<M-l>"] = "full", ["<M-w>"] = "word", ["<M-e>"] = "line" }) do
		map(key, function()
			M.accept(kind)
		end, "Accept local completion " .. kind)
	end
	map("<M-f>", function()
		vim.fn["llama#fim_inline"](false, false)
	end, "Request local completion")
	map("<C-]>", function()
		vim.fn.NvimLocalLlamaCancelTimers()
		vim.fn["llama#profile_changed"]()
		vim.fn["llama#fim_hide"]()
	end, "Dismiss local completion")
	map("<M-]>", function()
		vim.fn["llama#fim_cycle"](1)
	end, "Next local completion")
	map("<M-[>", function()
		vim.fn["llama#fim_cycle"](-1)
	end, "Previous local completion")
end

function M.disable()
	generation = generation + 1
	ready = false
	if vim.fn.exists("*llama#disable") == 1 then
		-- Cancel in-flight jobs as well as hiding already rendered suggestions.
		suspend()
		local ns = vim.api.nvim_create_namespace("vt_fim")
		for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
			if vim.api.nvim_buf_is_loaded(bufnr) then
				vim.api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
			end
		end
	end
	for bufnr in pairs(attached) do
		if vim.api.nvim_buf_is_valid(bufnr) then
			for _, key in ipairs(keys) do
				pcall(vim.keymap.del, "i", key, { buffer = bufnr })
			end
		end
	end
	attached = {}
end

function M.available()
	if vim.fn.has("linux") ~= 1 or vim.fn.executable("systemctl") ~= 1 then
		vim.notify("Managed local completions currently require Linux and systemd", vim.log.levels.ERROR)
		return false
	end
	if vim.fn.executable("curl") ~= 1 then
		vim.notify("Local completions require curl", vim.log.levels.ERROR)
		return false
	end
	return true
end

function M.enable(on_error)
	M.disable()
	local token = generation
	require("lazy").load({ plugins = { "llama.vim" } })
	if vim.fn.exists("*llama#enable") ~= 1 then
		vim.notify("llama.vim is unavailable; install it with :Lazy sync", vim.log.levels.ERROR)
		vim.schedule(on_error)
		return
	end
	local function current()
		return token == generation and vim.g.copilot_mode == "local"
	end
	local function fail(message)
		if current() then
			vim.notify(message, vim.log.levels.ERROR)
			on_error()
		end
	end
	local deadline = vim.uv.hrtime() + 60 * 1e9
	local function probe()
		if not current() then
			return
		end
		vim.system(
			{ "curl", "--silent", "--fail", "--max-time", "2", "http://127.0.0.1:8012/health" },
			{},
			function(result)
				vim.schedule(function()
					if not current() then
						return
					end
					if result.code == 0 then
						ready = true
						attach()
						vim.notify("Local completions ready (Qwen2.5-Coder 3B)")
					elseif vim.uv.hrtime() < deadline then
						vim.defer_fn(probe, 500)
					else
						fail("Local completion server timed out; see journalctl --user -u " .. service)
					end
				end)
			end
		)
	end
	vim.system({ "systemctl", "--user", "start", service }, { text = true }, function(result)
		vim.schedule(function()
			if not current() then
				return
			end
			if result.code ~= 0 then
				fail(
					"Could not start local completions: "
						.. vim.trim(result.stderr or "")
						.. "; see journalctl --user -u "
						.. service
				)
			else
				probe()
			end
		end)
	end)
end

function M.stop()
	vim.system({ "systemctl", "--user", "stop", service }, { text = true }, function(result)
		vim.schedule(function()
			vim.notify(
				result.code == 0 and "Local completion server stopped" or vim.trim(result.stderr),
				result.code == 0 and vim.log.levels.INFO or vim.log.levels.ERROR
			)
		end)
	end)
end

local group = vim.api.nvim_create_augroup("LocalCompletion", { clear = true })
vim.api.nvim_create_autocmd({ "BufEnter", "InsertEnter" }, { group = group, callback = attach })

return M
