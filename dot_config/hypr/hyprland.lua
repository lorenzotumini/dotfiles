-- Minimal, readable Hyprland 0.56+ configuration.
-- This uses Hyprland's native Lua configuration API.

local home = os.getenv("HOME")
local monitorsConfig = home .. "/.config/hypr/monitors.lua"
local monitorsFile = io.open(monitorsConfig, "r")
local monitorsLoaded = false
if monitorsFile then
    monitorsFile:close()
    monitorsLoaded = pcall(dofile, monitorsConfig)
end
if not monitorsLoaded then
    hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1.25 })
end

local terminal = "ghostty"
local fileManager = "nautilus"
local menu = "fuzzel"
local browser = "firefox"
local mainMod = "SUPER"
local desktopCore = home .. "/.config/quickshell/omarchy-core"
local desktopCoreBin = desktopCore .. "/bin"
local sessionPath = os.getenv("PATH") or "/usr/local/bin:/usr/bin"

hl.on("hyprland.start", function ()
    -- The desktop initializer starts the single supported Omarchy-derived core
    -- and reconnects its generated theme/application state.
    hl.exec_cmd(home .. "/.local/bin/desktop-shell boot")
    hl.exec_cmd("tailscale systray")
end)

hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")
hl.env("ELECTRON_OZONE_PLATFORM_HINT", "auto")
hl.env("NVD_BACKEND", "direct")
hl.env("TERMINAL", terminal)
hl.env("OMARCHY_PATH", desktopCore)
-- Keep the existing, easy-to-find screenshot location while using Omarchy's
-- native capture helper (which otherwise defaults to the top-level Pictures
-- directory).
hl.env("OMARCHY_SCREENSHOT_DIR", home .. "/Pictures/Screenshots")
if not string.find(":" .. sessionPath .. ":", ":" .. desktopCoreBin .. ":", 1, true) then
    hl.env("PATH", desktopCoreBin .. ":" .. sessionPath)
end

hl.config({
    -- Let XWayland applications render at native pixels. Applications that
    -- need scaling (currently Sioyek) opt into it themselves.
    xwayland = {
        force_zero_scaling = true,
    },
    general = {
        gaps_in = 6,
        gaps_out = 15,
        border_size = 2,
        col = {
            -- active_border = { colors = { "rgba(89b4faff)", "rgba(cba6f7ff)" }, angle = 45 },
            active_border = { colors = { "rgba(3f3664ff)" }, angle = 45 },
            inactive_border = "rgba(585b70aa)",
        },
        resize_on_border = true,
        allow_tearing = false,
        layout = "dwindle",
    },
    decoration = {
        rounding = 8,
        rounding_power = 2,
        active_opacity = 1.0,
        inactive_opacity = 1.0,
        shadow = {
            enabled = true,
            range = 4,
            render_power = 3,
            color = 0x9911111b,
        },
        blur = {
            enabled = false,
        },
    },
    animations = {
        enabled = false,
    },
    dwindle = {
        preserve_split = true,
    },
    misc = {
        force_default_wallpaper = 0,
        disable_hyprland_logo = true,
        mouse_move_enables_dpms = true,
        key_press_enables_dpms = true,
    },
    input = {
        -- Italian layout with Caps Lock/Escape swapped and programming-friendly
        -- Shift layers for à (`) and ù (~).
        kb_file = os.getenv("HOME") .. "/.config/xkb/keymap.xkb",
        follow_mouse = 1,
        sensitivity = 0,
        touchpad = {
            natural_scroll = false,
        },
    },
})

hl.curve("easeOutQuint", { type = "bezier", points = { { 0.23, 1 }, { 0.32, 1 } } })
hl.curve("almostLinear", { type = "bezier", points = { { 0.5, 0.5 }, { 0.75, 1 } } })
hl.curve("quick", { type = "bezier", points = { { 0.15, 0 }, { 0.1, 1 } } })
hl.curve("easy", { type = "spring", mass = 1, stiffness = 238.1191, dampening = 24.21279333 })

hl.animation({ leaf = "global", enabled = true, speed = 10, bezier = "default" })
hl.animation({ leaf = "border", enabled = true, speed = 5.39, bezier = "easeOutQuint" })
hl.animation({ leaf = "windows", enabled = true, speed = 4.79, spring = "easy" })
hl.animation({ leaf = "windowsIn", enabled = true, speed = 4.1, spring = "easy", style = "popin 87%" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 1.49, bezier = "default", style = "popin 87%" })
hl.animation({ leaf = "fade", enabled = true, speed = 3.03, bezier = "quick" })
hl.animation({ leaf = "layers", enabled = true, speed = 3.81, bezier = "easeOutQuint" })
hl.animation({ leaf = "workspaces", enabled = true, speed = 1.94, bezier = "almostLinear", style = "fade" })

-- Programs and session controls.
hl.bind(mainMod .. " + RETURN", hl.dsp.exec_cmd(terminal))
hl.bind(mainMod .. " + Q", hl.dsp.window.close())
hl.bind(mainMod .. " + D", hl.dsp.exec_cmd(menu))
hl.bind(mainMod .. " + E", hl.dsp.exec_cmd(fileManager))
hl.bind(mainMod .. " + B", hl.dsp.exec_cmd(browser))
hl.bind(mainMod .. " + F", hl.dsp.window.fullscreen())
hl.bind(mainMod .. " + SPACE", hl.dsp.window.float({ action = "toggle" }))
hl.bind("ALT + F4", hl.dsp.window.close())
hl.bind(mainMod .. " + CTRL + L", hl.dsp.exec_cmd("omarchy-system-lock"))
hl.bind(mainMod .. " + SHIFT + E", hl.dsp.exit())

-- The Omarchy menu is intentionally absent. Keep its native theme and
-- background selectors on the stock direct shortcuts.
hl.bind(mainMod .. " + CTRL + SPACE", hl.dsp.exec_cmd([=[bash -lc 'background=$(omarchy-theme-bg-switcher); [[ -n $background ]] && omarchy-theme-bg-set "$background"']=]))
hl.bind(mainMod .. " + CTRL + SHIFT + SPACE", hl.dsp.exec_cmd([=[bash -lc 'theme=$(omarchy-theme-switcher); [[ -n $theme ]] && omarchy-theme-set "$theme"']=]))

-- Focus using either arrows or Vim-style keys.
local directions = {
    left = "left", right = "right", up = "up", down = "down",
    H = "left", L = "right", K = "up", J = "down",
}
for key, direction in pairs(directions) do
    hl.bind(mainMod .. " + " .. key, hl.dsp.focus({ direction = direction }))
    hl.bind(mainMod .. " + SHIFT + " .. key, hl.dsp.window.swap({ direction = direction }))
end

-- Workspaces 1-10, with 0 representing workspace 10.
for i = 1, 10 do
    local key = i % 10
    hl.bind(mainMod .. " + " .. key, hl.dsp.focus({ workspace = i }))
    hl.bind(mainMod .. " + SHIFT + " .. key, hl.dsp.window.move({ workspace = i }))
end

-- Scratchpad and mouse-based moving/resizing.
hl.bind(mainMod .. " + S", hl.dsp.workspace.toggle_special("scratchpad"))
hl.bind(mainMod .. " + ALT + S", function ()
    local window = hl.get_active_window()
    local normalWorkspace = hl.get_active_workspace()
    if not window or not window.workspace or not normalWorkspace then
        return
    end

    if window.workspace.name == "special:scratchpad" then
        hl.dispatch(hl.dsp.window.move({ workspace = normalWorkspace.id }))
    else
        hl.dispatch(hl.dsp.window.move({ workspace = "special:scratchpad" }))
    end
end)
hl.bind(mainMod .. " + mouse_down", hl.dsp.focus({ workspace = "e+1" }))
hl.bind(mainMod .. " + mouse_up", hl.dsp.focus({ workspace = "e-1" }))
hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })
hl.bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), { mouse = true })

-- Audio and media keys work even while the session is locked.
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("omarchy-audio-output-volume raise"), { locked = true, repeating = true })
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("omarchy-audio-output-volume lower"), { locked = true, repeating = true })
hl.bind("XF86AudioMute", hl.dsp.exec_cmd("omarchy-audio-output-volume mute-toggle"), { locked = true })
hl.bind("XF86AudioMicMute", hl.dsp.exec_cmd("omarchy-audio-input-mute"), { locked = true })
hl.bind("XF86AudioNext", hl.dsp.exec_cmd("omarchy-shell media next"), { locked = true })
hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("omarchy-shell media playPause"), { locked = true })
hl.bind("XF86AudioPause", hl.dsp.exec_cmd("omarchy-shell media playPause"), { locked = true })
hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("omarchy-shell media previous"), { locked = true })
hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("omarchy-brightness-display +5%"), { locked = true, repeating = true })
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("omarchy-brightness-display 5%-"), { locked = true, repeating = true })
hl.bind("XF86KbdBrightnessUp", hl.dsp.exec_cmd("omarchy-brightness-keyboard up"), { locked = true, repeating = true })
hl.bind("XF86KbdBrightnessDown", hl.dsp.exec_cmd("omarchy-brightness-keyboard down"), { locked = true, repeating = true })

-- Screenshots are saved in the configured Pictures directory and copied as
-- PNG to the Wayland clipboard, so the latest capture can be pasted with
-- Ctrl+V in image-aware applications.
-- Print: full current monitor. Super+Shift+S: interactively select a region.
-- Shift+Print: pick a window/monitor rectangle (a useful third option).
hl.bind("Print", hl.dsp.exec_cmd("omarchy-capture-screenshot fullscreen slurp"))
hl.bind(mainMod .. " + SHIFT + S", hl.dsp.exec_cmd("omarchy-capture-screenshot region slurp"))
hl.bind("SHIFT + Print", hl.dsp.exec_cmd("omarchy-capture-screenshot windows slurp"))

-- Small global conveniences formerly provided by AutoHotkey/PowerToys.
hl.bind(mainMod .. " + SHIFT + C", hl.dsp.exec_cmd([[sh -c 'color=$(hyprpicker -f hex) && printf %s "$color" | wl-copy && notify-send "Color copied" "$color"']]))

-- Ignore maximize requests that conflict with tiling semantics.
hl.window_rule({
    name = "suppress-maximize-events",
    match = { class = ".*" },
    suppress_event = "maximize",
})

-- MEGAsync currently collapses this XWayland dialog to a one-pixel window on
-- Hyprland. Target only the broken modal so its tray popups retain their own
-- application-controlled size and position.
hl.window_rule({
    name = "mega-add-sync-dialog",
    match = {
        class = "^MEGAsync$",
        title = "^Add sync$",
    },
    float = true,
    size = { 900, 600 },
    center = true,
    allows_input = true,
})

-- The compact MEGA status panel paints only a 320x450 area inside an oversized
-- XWayland surface. Match the border to the painted area and anchor it below
-- the top-right bar, like a conventional tray popup.
hl.window_rule({
    name = "mega-main-panel",
    match = {
        class = "^MEGAsync$",
        title = "^MEGAsync$",
    },
    float = true,
    size = { 320, 450 },
    move = { "monitor_w-window_w-15", 45 },
    allows_input = true,
})

-- Avoid focus glitches from small XWayland helper windows.
hl.window_rule({
    name = "fix-xwayland-drags",
    match = {
        class = "^$",
        title = "^$",
        xwayland = true,
        float = true,
        fullscreen = false,
        pin = false,
    },
    no_focus = true,
})

-- Omarchy generates this small fragment from the active native theme. Loading
-- it last lets themes own the active/inactive borders without taking over the
-- rest of this Hyprland configuration.
-- Stock Kanagawa also uses Omarchy's small `o.window` helper for its terminal
-- opacity rule. Provide that one compatibility primitive without importing
-- the distribution's full Hyprland helper/config stack.
o = o or {}
o.window = o.window or function(match, rules)
    rules.match = rules.match or {}
    if type(match) == "string" then
        rules.match.class = match
    else
        for key, value in pairs(match) do
            rules.match[key] = value
        end
    end
    hl.window_rule(rules)
end

local themeHyprland = home .. "/.local/state/omarchy/current/theme/hyprland.lua"
local themeFile = io.open(themeHyprland, "r")
if themeFile then
    themeFile:close()
    dofile(themeHyprland)
end
