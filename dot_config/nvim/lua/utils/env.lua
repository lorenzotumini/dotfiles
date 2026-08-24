local M = {}

M.is_windows = vim.fn.has("win32") == 1 or vim.fn.has("win64") == 1
M.is_linux = vim.fn.has("linux") == 1
M.is_wsl = vim.fn.has("wsl") == 1
M.is_macos = vim.fn.has("mac") == 1 or vim.fn.has("macunix") == 1

function M.executable(cmd)
	return vim.fn.executable(cmd) == 1
end

function M.readable(path)
	return vim.fn.filereadable(path) == 1
end

function M.isdir(path)
	return vim.fn.isdirectory(path) == 1
end

function M.config_path(...)
	return vim.fs.joinpath(vim.fn.stdpath("config"), ...)
end

function M.data_path(...)
	return vim.fs.joinpath(vim.fn.stdpath("data"), ...)
end

function M.mason_bin(...)
	return M.data_path("mason", "bin", ...)
end

function M.command_path(cmd)
	if M.executable(cmd) then
		return cmd
	end

	local candidates = { M.mason_bin(cmd) }
	if M.is_windows then
		vim.list_extend(candidates, {
			M.mason_bin(cmd .. ".cmd"),
			M.mason_bin(cmd .. ".exe"),
			M.mason_bin(cmd .. ".bat"),
		})
	end

	for _, candidate in ipairs(candidates) do
		if M.executable(candidate) then
			return candidate
		end
	end
end

function M.first_executable(candidates)
	for _, candidate in ipairs(candidates) do
		if candidate and M.executable(candidate) then
			return candidate
		end
	end
end

function M.default_shell()
	if M.is_windows and M.executable("pwsh") then
		local profile = M.config_path("pwsh_nvim_profile.ps1")
		if M.readable(profile) then
			return "pwsh -NoLogo -NoProfile -NoExit -File " .. vim.fn.shellescape(profile)
		end
		return "pwsh -NoLogo -NoProfile"
	end
	if not M.is_windows and vim.env.SHELL and vim.env.SHELL ~= "" then
		return vim.env.SHELL
	end
	if M.is_windows and M.executable("powershell.exe") then
		return "powershell.exe -NoLogo -NoProfile"
	end
	if M.is_windows then
		return "cmd.exe"
	end
	return "sh"
end

return M
