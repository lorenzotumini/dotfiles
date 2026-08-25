#Requires AutoHotkey v2.0
#SingleInstance Force

; Programs and windows.
#b::
{
    if WinExist("ahk_class MozillaWindowClass")
        WinActivate
    else
        Run("firefox.exe")
}

#Enter::Run("wt")
#q::WinClose("A")
#m::WinMaximize("A")
#+m::WinRestore("A")
