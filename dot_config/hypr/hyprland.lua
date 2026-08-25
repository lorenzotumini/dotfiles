-- Minimal, readable Hyprland 0.56+ configuration.
-- This uses Hyprland's native Lua configuration API.

hl.monitor({
    output = "",
    mode = "preferred",
    position = "auto",
    scale = "1.25",
})

local terminal = "ghostty"
local fileManager = "nautilus"
local menu = "fuzzel"
local browser = "firefox"
local mainMod = "SUPER"

hl.on("hyprland.start", function ()
    -- Keep GTK preferences and Blueman's non-visual pairing agent aligned
    -- with this minimal desktop. Waybar provides the Bluetooth icon.
    hl.exec_cmd([[gsettings set org.gnome.desktop.interface color-scheme prefer-dark]])
    hl.exec_cmd([[gsettings set org.gnome.desktop.interface gtk-theme Adwaita-dark]])
    hl.exec_cmd([[gsettings set org.blueman.general plugin-list "['!StatusNotifierItem']"]])
    hl.exec_cmd("hyprpaper")
    hl.exec_cmd("waybar")
    hl.exec_cmd("mako")
    hl.exec_cmd("hypridle")
    hl.exec_cmd("tailscale systray")
    hl.exec_cmd("/usr/lib/hyprpolkitagent/hyprpolkitagent")
end)

hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")
-- Force the dark Adwaita variant for standalone GTK 3/4 utilities such as
-- Blueman and nm-connection-editor.  The matching gsettings preference remains
-- in place for libadwaita applications.
hl.env("GTK_THEME", "Adwaita:dark")
hl.env("ELECTRON_OZONE_PLATFORM_HINT", "auto")
hl.env("NVD_BACKEND", "direct")
hl.env("TERMINAL", terminal)

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
            active_border = { colors = { "rgba(89b4faff)", "rgba(cba6f7ff)" }, angle = 45 },
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
hl.bind(mainMod .. " + F", hl.dsp.exec_cmd(menu))
hl.bind(mainMod .. " + E", hl.dsp.exec_cmd(fileManager))
hl.bind(mainMod .. " + B", hl.dsp.exec_cmd(browser))
hl.bind(mainMod .. " + M", hl.dsp.window.fullscreen())
hl.bind(mainMod .. " + SPACE", hl.dsp.window.float({ action = "toggle" }))
hl.bind("ALT + F4", hl.dsp.window.close())
hl.bind(mainMod .. " + CTRL + L", hl.dsp.exec_cmd("hyprlock"))
hl.bind(mainMod .. " + SHIFT + E", hl.dsp.exit())

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
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+"), { locked = true, repeating = true })
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"), { locked = true, repeating = true })
hl.bind("XF86AudioMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"), { locked = true })
hl.bind("XF86AudioMicMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"), { locked = true })
hl.bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"), { locked = true })
hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPause", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"), { locked = true })

-- Screenshots are written to ~/Pictures/Screenshots.
hl.bind("Print", hl.dsp.exec_cmd([[sh -c 'mkdir -p "$HOME/Pictures/Screenshots"; file="$HOME/Pictures/Screenshots/$(date +%Y%m%d-%H%M%S).png"; grim -g "$(slurp)" "$file" && notify-send "Screenshot saved" "$file"']]))
hl.bind(mainMod .. " + SHIFT + S", hl.dsp.exec_cmd([[sh -c 'mkdir -p "$HOME/Pictures/Screenshots"; file="$HOME/Pictures/Screenshots/$(date +%Y%m%d-%H%M%S).png"; grim -g "$(slurp)" "$file" && notify-send "Screenshot saved" "$file"']]))
hl.bind("SHIFT + Print", hl.dsp.exec_cmd([[sh -c 'mkdir -p "$HOME/Pictures/Screenshots"; file="$HOME/Pictures/Screenshots/$(date +%Y%m%d-%H%M%S).png"; grim "$file" && notify-send "Screenshot saved" "$file"']]))

-- Small global conveniences formerly provided by AutoHotkey/PowerToys.
hl.bind(mainMod .. " + SHIFT + C", hl.dsp.exec_cmd([[sh -c 'color=$(hyprpicker -f hex) && printf %s "$color" | wl-copy && notify-send "Color copied" "$color"']]))

-- Ignore maximize requests that conflict with tiling semantics.
hl.window_rule({
    name = "suppress-maximize-events",
    match = { class = ".*" },
    suppress_event = "maximize",
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
