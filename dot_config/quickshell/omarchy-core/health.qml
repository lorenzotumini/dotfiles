import QtQuick
import Quickshell
import qs.Commons as Commons
import qs.Ui as Ui

// An isolated process loads the real palette and UI kit, without desktop
// plugins, compositor windows, or changes to the user's theme files.
ShellRoot {
  Item {
    Ui.Button { id: button; text: "Palette probe" }
    Ui.WidgetButton { id: widget; text: "Bar probe" }
  }

  Timer {
    interval: 400
    running: true
    onTriggered: {
      try {
        Commons.Color.loadColors('foreground = "#abcdef"\nbackground = "#123456"\naccent = "#fedcba"\n')
        Commons.Color.loadShell('[bar]\ntext = "#aabbcc"\n[popups]\ntext = "#ddeeff"\n')
        finish.start()
      } catch (error) {
        console.error("DESKTOP_HEALTH_FAIL " + error)
        Qt.quit()
      }
    }
  }

  Timer {
    id: finish
    interval: 100
    onTriggered: {
      if (String(Commons.Color.foreground) !== "#abcdef" ||
          String(Commons.Color.bar.text) !== "#aabbcc" ||
          String(Commons.Color.popups.text) !== "#ddeeff" ||
          String(button.foreground) !== "#abcdef" ||
          String(widget.foreground) !== "#abcdef") {
        console.error("DESKTOP_HEALTH_FAIL palette or widget bindings did not update")
      } else {
        console.log("DESKTOP_HEALTH_PASS")
      }
      Qt.quit()
    }
  }
}
