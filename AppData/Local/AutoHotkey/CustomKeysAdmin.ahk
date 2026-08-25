#Requires AutoHotkey v2.0
#SingleInstance Force

; This script runs through the elevated Task Scheduler entry so these remaps
; also work in administrator windows.
CapsLock::Esc
Esc::CapsLock

; Convenient programming symbols on the Italian keyboard.
<+sc02B::SendText("~")
<+sc028::SendText("``")
