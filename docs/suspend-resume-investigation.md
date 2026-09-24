# Suspend / monitor-standby investigation

Reviewed 2026-09-24. Recovery is verified; the original crash is not fixed.

## Verified reproduction (2026-09-20, Europe/Rome)

Saved capture: `~/.local/state/desktop-suspend-debug/20260920-221020-sOg86Q/`.
Keep this exact directory reference: the `latest` symlink changes on each capture.

- 22:11:51: Quickshell reports a secure lock; system enters deep (S3) suspend.
- 22:17:43: NVIDIA logs two `PDB_PROP_GPU_IN_PM_CODEPATH` assertions at
  `mem_mapper.c:49`. Their causal relationship to the later failure is unknown.
- 22:17:44: system completes resume.
- 22:17:46: sysfs reports `card2-HDMI-A-2` disconnected; Qt reports no outputs.
- 22:17:48: sysfs reports the HDMI output connected again. Quickshell PID 1306
  receives `wl_display#1: error 0: invalid object 102`, then exits with status 255.
- 22:17:51: replacement Quickshell PID 8791 reports `lock-stranded: recovering`,
  followed by `secure=true` at 22:17:51.837.
- 22:18:07: PAM reports successful authentication; the replacement unlocks.

The user saw the emergency screen briefly and then authenticated normally,
without running recovery commands. The captured failure-to-secure interval was
approximately 3.25 seconds. The computer remained responsive, including TTYs.

`misc.allow_session_lock_restore = true` is the persistent, deployed workaround.
It permits a replacement locker, not automatic clearing of the session lock.
The existing systemd service restarts the shell after a failure. No intentional
crash or authentication-bypass test was performed.

The recorder ended cleanly at 22:24:22. On 2026-09-24, the recorder was inactive,
`debug:disable_logs` was true, and lockscreen restoration remained enabled.

## Environment of captured failure

- Display: Samsung ViewFinity S5 / S34CG50, HDMI on RTX 3070 Ti; 3440x1440,
  approximately 60 Hz, VRR off, SDR.
- Second installed GPU: RTX 5060 Ti. Earlier failures also occurred with the
  display connected to that GPU. DRM card numbers are dynamic.
- Hyprland 0.56.2-3 (`efb50993780079460b0cbed1363e2166a2de1d9f`),
  Aquamarine 0.15.1-1, Quickshell 0.3.1-1.
- Qt base 6.11.2-3, Qt Wayland 6.11.2-1; kernel 7.2.6-arch2-1;
  NVIDIA 615.71.09 open modules.
- NVIDIA: `UseKernelSuspendNotifiers=1`, `PreserveVideoMemoryAllocations=2`,
  `TemporaryFilePath=/var/tmp`. The legacy NVIDIA sleep scripts are no-ops
  with the absent `/proc/driver/nvidia/suspend` interface on this setup.

## Conclusions and remaining uncertainty

The evidence establishes display disappearance/reappearance followed by a fatal
Wayland error in the desktop shell and its lockscreen. It does not identify the
Wayland interface associated with object 102, or prove whether the original
fault lies in Hyprland, Qt/Quickshell, or the driver transition. Object IDs are
connection-local and cannot identify an interface on their own.

The compositor log capture contains Aquamarine output but lacks the expected
compositor protocol diagnostics and timestamps. Do not treat it as a complete
protocol trace. Raw `WAYLAND_DEBUG` was deliberately not enabled because it can
include keyboard input. Any further protocol tracing must avoid collecting
authentication input and other sensitive events.

Related upstream reports are leads, not confirmed diagnoses:

- <https://github.com/hyprwm/Hyprland/discussions/15403>: display replug causes
  invalid-object errors. Its referenced PR 15351 predates this installed
  Hyprland version; installed headers already contain the defunct-output
  retention structures. Do not propose blindly reapplying that patch.
- <https://github.com/quickshell-mirror/quickshell/issues/1123>: same shell and
  compositor versions, but a different trigger (concurrent screencopy).
- <https://github.com/NVIDIA/open-gpu-kernel-modules/issues/1306>: includes the
  same NVIDIA assertion, but has additional Xid errors/hangs not established
  in this reproduction.

## Standby-only result (2026-09-24, Europe/Rome)

Saved capture: `~/.local/state/desktop-suspend-debug/20260924-105145-2EUZXF/`.
The user followed the Lock-only test below and saw no emergency screen.
The logs nevertheless establish a second failure followed by quick recovery:

- 10:51:56.483: Quickshell PID 1329 reports `secure=true`.
- 10:52:16, 10:52:46, and 10:53:16: monitor snapshots show `dpmsStatus=false`.
- 10:53:40.741 and 10:53:42.363: Qt reports no outputs.
- 10:53:42.593: `wl_display#1: error 0: invalid object 104`; fatal Wayland error
  follows. Aquamarine logs HDMI-A-2 disconnecting and reconnecting.
- 10:53:43.214: replacement PID 11201 reports `lock-stranded: recovering`.
- 10:53:43.705: the replacement reports `secure=true`, approximately 1.11 seconds
  after the original protocol error.
- 10:53:53.208: successful authentication/unlock. `NRestarts` changed from 0 to 1.
- 10:54:01: recording ends cleanly.

The 2-second sysfs poll did not catch this connector transition, but the
Aquamarine and Qt event logs did. Do not interpret an unchanged connectors.log
as proof of no hotplug event. Likewise, no visible emergency screen does not
prove the shell survived.

Conclusion: full-system suspend is not necessary. The standby/wake and output
recreation path is sufficient to reproduce the shell failure on this machine.
NVIDIA system-suspend preservation settings cannot by themselves explain both
tests; a display-driver hotplug issue is still possible. Keep recovery enabled.
The next deeper diagnostic should identify the Wayland interface behind the
invalid object, rather than repeat the already-reproduced suspend test or
change unrelated refresh-rate, GPU-selection, or suspend settings.

## Controlled standby-only test procedure (completed above)

Leave GPU selection, refresh rate, VRR, driver parameters, and recovery unchanged.
To distinguish full-system suspend from display standby alone:

1. Run `desktop-suspend-debug start` from the graphical session.
2. Choose **Lock**, not Suspend. Let the display reach actual standby, then wait
   another 30 seconds without touching the keyboard or mouse.
3. Wake the display, authenticate, and run `desktop-suspend-debug stop`.
4. Compare connector transitions, any fatal Wayland error, and shell PID changes
   against the suspend capture. A single passing trial does not exclude a race.

No test or suspend should be triggered remotely without warning the user.
If automatic recovery fails, log into a TTY, stop the recorder, and use
`desktop-shell restart`. Do not automatically clear the crashed lockscreen.
