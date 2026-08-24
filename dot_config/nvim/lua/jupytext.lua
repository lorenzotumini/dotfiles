local M = {}

local enabled = false
local formats = "ipynb,py:hydrogen,md:markdown"
local pairing_jobs = {}
local sync_jobs = {}
local is_windows = vim.fn.has("win32") == 1

local function normalized_path(path)
	local normalized = vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
	return normalized, is_windows and normalized:lower() or normalized
end

local function command_error(action, file, result)
	local detail = vim.trim(result.stderr or "")
	if detail == "" then
		detail = "exit code " .. result.code
	end
	vim.notify(string.format("Jupytext %s failed for %s:\n%s", action, file, detail), vim.log.levels.ERROR)
end

local function run(args, callback)
	local command = { "jupytext" }
	vim.list_extend(command, args)
	local ok, job = pcall(vim.system, command, { text = true }, vim.schedule_wrap(callback))
	return ok and job or nil, ok and nil or tostring(job)
end

local function setup_pairing(args)
	if not enabled then
		return
	end

	local notebook, notebook_key = normalized_path(args.match or args.file)
	if pairing_jobs[notebook_key] then
		return
	end

	local base = vim.fn.fnamemodify(notebook, ":r")
	local pyfile = base .. ".py"
	local mdfile = base .. ".md"
	local _, pyfile_key = normalized_path(pyfile)
	local _, mdfile_key = normalized_path(mdfile)
	local origin_win = vim.api.nvim_get_current_win()
	if vim.api.nvim_win_get_buf(origin_win) ~= args.buf then
		origin_win = vim.fn.bufwinid(args.buf)
	end
	pairing_jobs[notebook_key] = true

	local function finish()
		pairing_jobs[notebook_key] = nil
		if not enabled then
			return
		end
		if vim.fn.filereadable(pyfile) == 0 then
			vim.notify("Jupytext did not create " .. pyfile, vim.log.levels.ERROR)
			return
		end
		if origin_win == -1 or not vim.api.nvim_win_is_valid(origin_win) or not vim.api.nvim_buf_is_valid(args.buf) then
			return
		end
		if vim.api.nvim_win_get_buf(origin_win) ~= args.buf then
			return
		end

		local ok, err = pcall(vim.api.nvim_win_call, origin_win, function()
			vim.api.nvim_cmd({ cmd = "edit", args = { pyfile } }, {})
		end)
		if not ok then
			vim.notify("Failed to open Jupytext file: " .. tostring(err), vim.log.levels.ERROR)
		end
	end

	local function run_pairing(command, action, on_success)
		local job, err = run(command, function(result)
			if not enabled then
				pairing_jobs[notebook_key] = nil
				return
			end
			if result.code ~= 0 then
				pairing_jobs[notebook_key] = nil
				command_error(action, notebook, result)
				return
			end
			on_success()
		end)
		if not job then
			pairing_jobs[notebook_key] = nil
			vim.notify("Failed to start Jupytext: " .. err, vim.log.levels.ERROR)
		end
	end

	local function set_formats()
		run_pairing({ "--set-formats", formats, notebook }, "pairing", finish)
	end

	local inspect_job, inspect_err = run({ "--paired-paths", notebook }, function(result)
		local inspect_stderr = vim.trim(result.stderr or "")
		-- Jupytext 1.19 returns 1 after successfully printing paired paths.
		if (result.code ~= 0 and result.code ~= 1) or inspect_stderr ~= "" then
			pairing_jobs[notebook_key] = nil
			command_error("pair inspection", notebook, result)
			return
		end
		if not enabled then
			pairing_jobs[notebook_key] = nil
			return
		end

		local paired = {}
		for path in (result.stdout or ""):gmatch("[^\r\n]+") do
			local _, key = normalized_path(path)
			paired[key] = true
		end

		local py_is_paired = paired[pyfile_key] == true
		local md_is_paired = paired[mdfile_key] == true
		local py_exists = vim.fn.filereadable(pyfile) ~= 0
		local md_exists = vim.fn.filereadable(mdfile) ~= 0

		if (py_exists and not py_is_paired) or (md_exists and not md_is_paired) then
			pairing_jobs[notebook_key] = nil
			vim.notify(
				"Jupytext pairing skipped: a same-named .py or .md file exists but is not paired with " .. notebook,
				vim.log.levels.ERROR
			)
			return
		end

		if py_is_paired and md_is_paired then
			if py_exists and md_exists then
				finish()
			else
				run_pairing({ "--sync", notebook }, "sync", finish)
			end
		elseif py_is_paired or md_is_paired then
			-- Preserve the newest representation before adding the missing format.
			run_pairing({ "--sync", notebook }, "sync", set_formats)
		else
			set_formats()
		end
	end)
	if not inspect_job then
		pairing_jobs[notebook_key] = nil
		vim.notify("Failed to start Jupytext: " .. inspect_err, vim.log.levels.ERROR)
	end
end

local function start_sync(file, notebook_key)
	local state = { pending = nil }
	sync_jobs[notebook_key] = state

	local job, err = run({ "--sync", file }, function(result)
		if result.code ~= 0 then
			command_error("sync", file, result)
		end

		local pending = state.pending
		sync_jobs[notebook_key] = nil
		if enabled and pending then
			start_sync(pending, notebook_key)
		end
	end)
	if not job then
		sync_jobs[notebook_key] = nil
		vim.notify("Failed to start Jupytext: " .. err, vim.log.levels.ERROR)
	end
end

local function sync(args)
	if not enabled then
		return
	end

	local file = normalized_path(args.match or args.file)
	local ext = vim.fn.fnamemodify(file, ":e"):lower()
	local notebook, notebook_key = normalized_path(vim.fn.fnamemodify(file, ":r") .. ".ipynb")
	if ext ~= "ipynb" and vim.fn.filereadable(notebook) == 0 then
		return
	end

	if sync_jobs[notebook_key] then
		sync_jobs[notebook_key].pending = file
		return
	end
	start_sync(file, notebook_key)
end

local function enable()
	if enabled then
		return
	end
	if vim.fn.executable("jupytext") == 0 then
		vim.notify("Jupytext sync: 'jupytext' was not found in PATH", vim.log.levels.ERROR)
		return
	end

	enabled = true
	vim.notify("Jupytext sync enabled", vim.log.levels.INFO)

	local current_file = vim.api.nvim_buf_get_name(0)
	if current_file:lower():match("%.ipynb$") then
		setup_pairing({ buf = vim.api.nvim_get_current_buf(), match = current_file })
	end
end

local function disable()
	if not enabled then
		return
	end
	enabled = false
	for _, state in pairs(sync_jobs) do
		state.pending = nil
	end
	vim.notify("Jupytext sync disabled", vim.log.levels.INFO)
end

function M.setup()
	local group = vim.api.nvim_create_augroup("jupytext-sync", { clear = true })
	vim.api.nvim_create_autocmd("BufReadPost", {
		desc = "Setup Jupytext and open paired Python file when enabled",
		group = group,
		pattern = "*.ipynb",
		callback = setup_pairing,
	})
	vim.api.nvim_create_autocmd("BufWritePost", {
		desc = "Sync Jupytext notebooks on save when enabled",
		group = group,
		pattern = { "*.py", "*.md", "*.ipynb" },
		callback = sync,
	})

	vim.api.nvim_create_user_command("JupytextSyncEnable", enable, {
		desc = "Enable automatic Jupytext notebook syncing",
	})
	vim.api.nvim_create_user_command("JupytextSyncDisable", disable, {
		desc = "Disable automatic Jupytext notebook syncing",
	})
	vim.api.nvim_create_user_command("JupytextSyncToggle", function()
		if enabled then
			disable()
		else
			enable()
		end
	end, { desc = "Toggle automatic Jupytext notebook syncing" })
	vim.api.nvim_create_user_command("JupytextSyncStatus", function()
		vim.notify("Jupytext sync is " .. (enabled and "enabled" or "disabled"), vim.log.levels.INFO)
	end, { desc = "Show Jupytext notebook syncing status" })
end

return M
