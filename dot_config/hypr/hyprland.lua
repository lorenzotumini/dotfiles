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
    -- Launch MegaSync through UWSM after the Quickshell tray host is ready.
    -- Its XDG autostart entry is disabled for Hyprland below because this
    -- session does not activate xdg-desktop-autostart.target.
    hl.exec_cmd("sleep 3 && uwsm-app -- gtk-launch megasync.desktop")
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

-- Keep the presets ready for later, while the master switch above disables
-- animations for the current session.
hl.animation({ leaf = "global", enabled = true, speed = 10, bezier = "default" })
hl.animation({ leaf = "border", enabled = true, speed = 5.39, bezier = "easeOutQuint" })
hl.animation({ leaf = "windows", enabled = true, speed = 4.79, spring = "easy" })
hl.animation({ leaf = "windowsIn", enabled = true, speed = 4.1, spring = "easy", style = "popin 87%" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 1.49, bezier = "default", style = "popin 87%" })
hl.animation({ leaf = "fade", enabled = true, speed = 3.03, bezier = "quick" })
hl.animation({ leaf = "layers", enabled = true, speed = 3.81, bezier = "easeOutQuint" })
hl.animation({ leaf = "workspaces", enabled = true, speed = 1.94, bezier = "almostLinear", style = "fade" })

local function bind(keys, dispatcher, description, options)
    local opts = options or {}
    opts.description = description
    hl.bind(keys, dispatcher, opts)
end

-- Programs and session controls.
bind(mainMod .. " + RETURN", hl.dsp.exec_cmd(terminal), "Terminal")
bind(mainMod .. " + Q", hl.dsp.window.close(), "Close window")
bind(mainMod .. " + D", hl.dsp.exec_cmd(menu), "Application launcher")
bind(mainMod .. " + E", hl.dsp.exec_cmd(fileManager), "File manager")
bind(mainMod .. " + B", hl.dsp.exec_cmd(browser), "Browser")
bind(mainMod .. " + F", hl.dsp.window.fullscreen(), "Fullscreen")
bind(mainMod .. " + SPACE", hl.dsp.window.float({ action = "toggle" }), "Toggle floating")
bind("ALT + F4", hl.dsp.window.close(), "Close window")
bind(mainMod .. " + CTRL + L", hl.dsp.exec_cmd("omarchy-system-lock"), "Lock screen")

-- A small standalone cheatsheet is available even though the Omarchy menu is
-- intentionally not part of the desktop-core runtime.
bind(mainMod .. " + CTRL + K", hl.dsp.exec_cmd(home .. "/.local/bin/hyprland-keybindings"), "Show keybindings")
bind(mainMod .. " + SHIFT + SPACE", hl.dsp.exec_cmd("omarchy-toggle-bar"), "Toggle top bar")
bind(mainMod .. " + CTRL + N", hl.dsp.exec_cmd("omarchy-toggle-nightlight"), "Toggle nightlight")
bind(mainMod .. " + CTRL + I", hl.dsp.exec_cmd("omarchy-shell idle toggle"), "Toggle idle locking")
bind(mainMod .. " + CTRL + A", hl.dsp.exec_cmd("omarchy-shell shell toggle omarchy.audio"), "Audio panel")
bind(mainMod .. " + CTRL + B", hl.dsp.exec_cmd("omarchy-shell shell toggle omarchy.bluetooth"), "Bluetooth panel")
bind(mainMod .. " + CTRL + D", hl.dsp.exec_cmd("omarchy-shell shell toggle omarchy.monitor"), "Display panel")
bind(mainMod .. " + CTRL + ALT + D", hl.dsp.exec_cmd("omarchy-shell shell toggle omarchy.clock"), "Calendar panel")
bind(mainMod .. " + CTRL + W", hl.dsp.exec_cmd("omarchy-shell shell toggle omarchy.network"), "Network panel")
bind(mainMod .. " + CTRL + P", hl.dsp.exec_cmd("omarchy-shell shell toggle omarchy.power"), "Power panel")
bind(mainMod .. " + CTRL + T", hl.dsp.exec_cmd("omarchy-launch-tui btop"), "System activity")
bind(mainMod .. " + CTRL + Z", function()
    local zoom = hl.get_config("cursor.zoom_factor") or 1
    hl.config({ cursor = { zoom_factor = zoom + 1 } })
end, "Increase cursor zoom")
bind(mainMod .. " + CTRL + ALT + Z", function()
    hl.config({ cursor = { zoom_factor = 1 } })
end, "Reset cursor zoom")

-- The Omarchy menu is intentionally absent. Keep its native theme and
-- background selectors on the stock direct shortcuts.
bind(mainMod .. " + CTRL + SPACE", hl.dsp.exec_cmd([=[bash -lc 'background=$(omarchy-theme-bg-switcher); [[ -n $background ]] && omarchy-theme-bg-set "$background"']=]), "Background switcher")
bind(mainMod .. " + CTRL + SHIFT + SPACE", hl.dsp.exec_cmd([=[bash -lc 'theme=$(omarchy-theme-switcher); [[ -n $theme ]] && omarchy-theme-set "$theme"']=]), "Theme switcher")

-- Focus using either arrows or Vim-style keys.
local directions = {
    left = "left", right = "right", up = "up", down = "down",
    H = "left", L = "right", K = "up", J = "down",
}
for key, direction in pairs(directions) do
    bind(mainMod .. " + " .. key, hl.dsp.focus({ direction = direction }), "Focus " .. direction)
    bind(mainMod .. " + SHIFT + " .. key, hl.dsp.window.swap({ direction = direction }), "Swap window " .. direction)
end

-- J is already the Vim-style down key, so use Ctrl+J for split orientation.
bind(mainMod .. " + CTRL + J", hl.dsp.layout("togglesplit"), "Toggle split orientation")
bind(mainMod .. " + P", hl.dsp.window.pseudo(), "Toggle pseudo window")
bind(mainMod .. " + ALT + F", hl.dsp.window.fullscreen({ mode = "maximized" }), "Full width")
bind(mainMod .. " + CTRL + F", hl.dsp.exec_cmd(home .. "/.local/bin/hyprland-tiled-fullscreen-toggle"), "Tiled fullscreen")
bind(mainMod .. " + ALT + L", hl.dsp.exec_cmd(home .. "/.local/bin/hyprland-workspace-layout-toggle"), "Toggle workspace layout")
bind(mainMod .. " + SLASH", hl.dsp.exec_cmd("omarchy-hyprland-monitor-scaling up"), "Increase monitor scaling")
bind(mainMod .. " + ALT + SLASH", hl.dsp.exec_cmd("omarchy-hyprland-monitor-scaling down"), "Decrease monitor scaling")

-- Cycle workspaces and windows without reaching for the mouse.
bind(mainMod .. " + TAB", hl.dsp.focus({ workspace = "e+1" }), "Next workspace")
bind(mainMod .. " + SHIFT + TAB", hl.dsp.focus({ workspace = "e-1" }), "Previous workspace")
bind(mainMod .. " + CTRL + TAB", hl.dsp.focus({ workspace = "previous" }), "Previous workspace used")
bind("ALT + TAB", hl.dsp.window.cycle_next(), "Next window")
bind("ALT + SHIFT + TAB", hl.dsp.window.cycle_next({ next = false }), "Previous window")
bind("CTRL + ALT + TAB", hl.dsp.focus({ monitor = "+1" }), "Next monitor")
bind("CTRL + ALT + SHIFT + TAB", hl.dsp.focus({ monitor = "-1" }), "Previous monitor")

-- Workspaces 1-10, with 0 representing workspace 10.
for i = 1, 10 do
    local key = i % 10
    bind(mainMod .. " + " .. key, hl.dsp.focus({ workspace = i }), "Switch to workspace " .. i)
    bind(mainMod .. " + SHIFT + " .. key, hl.dsp.window.move({ workspace = i }), "Move window to workspace " .. i)
    bind(mainMod .. " + SHIFT + ALT + " .. key, hl.dsp.window.move({ workspace = i, follow = false }), "Move silently to workspace " .. i)
end

-- Move the current workspace between monitors.
for key, direction in pairs({ LEFT = "left", RIGHT = "right", UP = "up", DOWN = "down" }) do
    bind(mainMod .. " + SHIFT + ALT + " .. key, hl.dsp.workspace.move({ monitor = direction:sub(1, 1) }), "Move workspace " .. direction .. " monitor")
end

-- Resize tiled windows with the physical -/= keys. Using keycodes keeps this
-- useful with the custom Italian XKB map as well as US layouts.
bind(mainMod .. " + code:20", hl.dsp.window.resize({ x = -100, y = 0, relative = true }), "Expand window left")
bind(mainMod .. " + code:21", hl.dsp.window.resize({ x = 100, y = 0, relative = true }), "Shrink window left")
bind(mainMod .. " + SHIFT + code:20", hl.dsp.window.resize({ x = 0, y = -100, relative = true }), "Shrink window upward")
bind(mainMod .. " + SHIFT + code:21", hl.dsp.window.resize({ x = 0, y = 100, relative = true }), "Expand window downward")
bind(mainMod .. " + ALT + code:20", hl.dsp.window.resize({ x = -25, y = 0, relative = true }), "Expand window left slightly")
bind(mainMod .. " + ALT + code:21", hl.dsp.window.resize({ x = 25, y = 0, relative = true }), "Shrink window left slightly")
bind(mainMod .. " + SHIFT + ALT + code:20", hl.dsp.window.resize({ x = 0, y = -25, relative = true }), "Shrink window upward slightly")
bind(mainMod .. " + SHIFT + ALT + code:21", hl.dsp.window.resize({ x = 0, y = 25, relative = true }), "Expand window downward slightly")

-- Grouping is optional, but useful for temporarily stacking related windows.
bind(mainMod .. " + G", hl.dsp.group.toggle(), "Toggle window grouping")
bind(mainMod .. " + ALT + G", hl.dsp.window.move({ out_of_group = true }), "Move window out of group")
bind(mainMod .. " + ALT + LEFT", hl.dsp.window.move({ into_group = "l" }), "Group with window on left")
bind(mainMod .. " + ALT + RIGHT", hl.dsp.window.move({ into_group = "r" }), "Group with window on right")
bind(mainMod .. " + ALT + UP", hl.dsp.window.move({ into_group = "u" }), "Group with window above")
bind(mainMod .. " + ALT + DOWN", hl.dsp.window.move({ into_group = "d" }), "Group with window below")
bind(mainMod .. " + ALT + TAB", hl.dsp.group.next(), "Next window in group")
bind(mainMod .. " + ALT + SHIFT + TAB", hl.dsp.group.prev(), "Previous window in group")

-- Scratchpad and mouse-based moving/resizing.
bind(mainMod .. " + S", hl.dsp.workspace.toggle_special("scratchpad"), "Toggle scratchpad")
bind(mainMod .. " + ALT + S", hl.dsp.window.move({
    workspace = "special:scratchpad",
    follow = false,
}), "Send window to scratchpad")
bind(mainMod .. " + mouse_down", hl.dsp.focus({ workspace = "e+1" }), "Next workspace")
bind(mainMod .. " + mouse_up", hl.dsp.focus({ workspace = "e-1" }), "Previous workspace")
bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), "Move window", { mouse = true })
bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), "Resize window", { mouse = true })

-- Audio and media keys work even while the session is locked.
bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("omarchy-audio-output-volume raise"), "Raise volume", { locked = true, repeating = true })
bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("omarchy-audio-output-volume lower"), "Lower volume", { locked = true, repeating = true })
bind("XF86AudioMute", hl.dsp.exec_cmd("omarchy-audio-output-volume mute-toggle"), "Mute output", { locked = true })
bind("XF86AudioMicMute", hl.dsp.exec_cmd("omarchy-audio-input-mute"), "Mute microphone", { locked = true })
bind("XF86AudioNext", hl.dsp.exec_cmd("omarchy-shell media next"), "Next track", { locked = true })
bind("XF86AudioPlay", hl.dsp.exec_cmd("omarchy-shell media playPause"), "Play/pause", { locked = true })
bind("XF86AudioPause", hl.dsp.exec_cmd("omarchy-shell media playPause"), "Play/pause", { locked = true })
bind("XF86AudioPrev", hl.dsp.exec_cmd("omarchy-shell media previous"), "Previous track", { locked = true })
bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("omarchy-brightness-display +5%"), "Increase display brightness", { locked = true, repeating = true })
bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("omarchy-brightness-display 5%-"), "Decrease display brightness", { locked = true, repeating = true })
bind("XF86KbdBrightnessUp", hl.dsp.exec_cmd("omarchy-brightness-keyboard up"), "Increase keyboard brightness", { locked = true, repeating = true })
bind("XF86KbdBrightnessDown", hl.dsp.exec_cmd("omarchy-brightness-keyboard down"), "Decrease keyboard brightness", { locked = true, repeating = true })

-- Screenshots are saved in the configured Pictures directory and copied as
-- PNG to the Wayland clipboard, so the latest capture can be pasted with
-- Ctrl+V in image-aware applications.
-- Print: full current monitor. Super+Shift+S: interactively select a region.
-- Shift+Print: pick a window/monitor rectangle (a useful third option).
bind("Print", hl.dsp.exec_cmd("omarchy-capture-screenshot fullscreen slurp"), "Capture fullscreen")
bind(mainMod .. " + SHIFT + S", hl.dsp.exec_cmd("omarchy-capture-screenshot region slurp"), "Capture selected region")
bind("SHIFT + Print", hl.dsp.exec_cmd("omarchy-capture-screenshot windows slurp"), "Capture window or monitor")

-- Small global conveniences formerly provided by AutoHotkey/PowerToys.
bind(mainMod .. " + SHIFT + C", hl.dsp.exec_cmd([[sh -c 'color=$(hyprpicker -f hex) && printf %s "$color" | wl-copy && notify-send "Color copied" "$color"']]), "Pick color to clipboard")

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
-- XWayland surface. Match the border to the painted area and place it near the
-- cursor. Keep the original 15px side margin and reserve 45px at both vertical
-- edges so the panel clears the bar whether it is at the top or bottom.
hl.window_rule({
    name = "mega-main-panel",
    match = {
        class = "^MEGAsync$",
        title = "^MEGAsync$",
    },
    float = true,
    size = { 320, 450 },
    move = {
        "15+((monitor_w-window_w-30)*(cursor_x/monitor_w))",
        "45+((monitor_h-window_h-90)*(cursor_y/monitor_h))",
    },
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
