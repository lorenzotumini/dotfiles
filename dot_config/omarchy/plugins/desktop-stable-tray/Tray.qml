import QtQuick
import "../../../quickshell/omarchy-core/shell/plugins/bar/widgets" as StockWidgets
import qs.Commons

// Preserve the complete upstream tray while fixing two interactions that only
// show up when several drawer icons share one bar slot:
//
// 1. Opening a tray menu moves the pointer into a separate popup window. The
//    stock hover drawer interprets that as leaving the tray and retracts the
//    icon that owns the still-open menu.
// 2. The bar's open-panel marker describes a whole module slot, so for a tray
//    it appears under the slot midpoint rather than under the clicked icon.
//    A sub-pixel extent rounds to zero and disables that misleading marker for
//    this module only; static widgets keep their normal aligned marker.
StockWidgets.Tray {
  id: stableTray

  readonly property real openPanelIndicatorWidth: 0.001
  readonly property real openPanelIndicatorHeight: 0.001
  readonly property int preferredTrayMenuWidth: Style.space(320)

  // The upstream tray menu uses a fixed 232-rem card. Tailscale has several
  // longer action labels, so widen only that smaller PopupCard while leaving
  // the separate tray-management card alone. Keeping this lookup here avoids
  // modifying the pinned vendor snapshot.
  function widenTrayMenu() {
    var candidate = null
    for (var i = 0; i < stableTray.data.length; i++) {
      var object = stableTray.data[i]
      if (!object || !("owner" in object) || object.owner !== stableTray || !("contentWidth" in object)) continue
      if (!candidate || object.contentWidth < candidate.contentWidth) candidate = object
    }
    if (candidate) candidate.contentWidth = preferredTrayMenuWidth
  }

  Component.onCompleted: Qt.callLater(widenTrayMenu)

  onExpandedChanged: {
    if (!expanded && (trayMenuOpen || managePopupOpen)) expanded = true
  }

  // Our keep-open rule above intentionally defeats the stock hover collapse
  // while a popup owns the pointer. Once outside-click dismissal closes the
  // popup there is no new hover transition, so close the drawer explicitly.
  onTrayMenuOpenChanged: {
    if (!trayMenuOpen && !managePopupOpen) expanded = false
  }

  onManagePopupOpenChanged: {
    if (!trayMenuOpen && !managePopupOpen) expanded = false
  }
}
