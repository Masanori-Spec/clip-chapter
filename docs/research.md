# Primary research and boundaries

Checked 2026-10-06. The difference is a bounded existing-clip-aware workflow, not a new algorithm or patent claim.

## Demand and nearby alternatives

- [Shotcut forum: import chapter markers from MP4](https://forum.shotcut.org/t/import-chapter-markers-from-mp4-files/51448): 2026 reports describe manual chapter entry and the difficulty of timing chapters against multiple or repositioned clips
- [Shotcut forum: CSV marker import](https://forum.shotcut.org/t/import-markers-from-csv-file-and-lock-per-track-per-color-code/43146): asks about source-time chapter data for multiple videos
- [marker-munger.py](https://github.com/OldBaldGeek/OBS-old-bald-scripts/blob/main/marker-munger.py) supports CSV and manual offsets; its inspected code does not resolve the selected timeline occurrence and trim
- [OBS Chapter Bridge](https://tidyrivet.com/products/obs-chapter-bridge-for-shotcut/) is a close alternative whose public stated scope excludes trims, timeline offsets and multiple clips
- [shotcut-mcp](https://github.com/matrodrigs/shotcut-mcp) is a broader editing/marker alternative. A dedicated selected-occurrence chapter importer was not found in the reviewed documentation; no execution comparison is claimed

## Pinned native semantics

- [MarkersModel v26.9.27](https://github.com/mltframework/shotcut/blob/v26.9.27/src/models/markersmodel.cpp): nested `shotcut:markers` properties on the timeline producer, integer child keys, text/start/end/color fields, clock serialization and frame parsing. Point markers have equal start/end
- [MarkersDock v26.9.27](https://github.com/mltframework/shotcut/blob/v26.9.27/src/docks/markersdock.cpp): the real QTreeView has Name/Start/End columns; mouse release on a row emits seekRequested. Keyboard selection alone is insufficient seek evidence
- [MainWindow seek connection](https://github.com/mltframework/shotcut/blob/v26.9.27/src/mainwindow.cpp): marker seek switches to Project and seeks the actual player
- [Player controls](https://github.com/mltframework/shotcut/blob/v26.9.27/src/player.cpp): Current position TimeSpinBox and Source/Project tabs
- [Official keyboard shortcuts](https://www.shotcut.org/howtos/keyboard-shortcuts/): GUI authoring/control route
- [MLT playlist semantics](https://www.mltframework.org/docs/mltxml/#playlists): multiple occurrences, producer-relative in/out and timeline concatenation
- [Shotcut annotations](https://www.shotcut.org/notes/mltxml-annotations/): application metadata; native-generated XML is the fixture authority when descriptive notation is ambiguous
- [Normal producer UI label](https://github.com/mltframework/shotcut/blob/v26.9.27/src/util.cpp#L717-L732): `shotcut:producer=avformat` is not a retime signal
- [Proxy metadata](https://github.com/mltframework/shotcut/blob/v26.9.27/src/proxymanager.cpp): proxy/original-resource flags; disableProxy is not evidence of proxy use
- [Time Remap](https://github.com/mltframework/shotcut/blob/v26.9.27/src/qml/filters/time_remap/ui.qml): link-based timing changes are outside scope

Official consumer: [Shotcut v26.9.27 release](https://github.com/mltframework/shotcut/releases/tag/v26.9.27), exact `shotcut-linux-x86_64-26.9.27.txz`, 153,652,280 bytes, SHA-256 `849da6bbd24737f9edd07ba185b46982f2fb330981c05e1752809e85bcbb7e7b`. The fetcher matches that exact asset even if newer assets are present under the same release tag.

Only original synthetic video is generated for testing. The product does not convert or re-encode user media.

## Hosted native accessibility finding

The official Linux GUI visibly created a 480-frame project and a point marker at
frame 30, but its Markers QScrollArea omitted the rendered table from the ordinary
AT-SPI child tree. This is consistent with Qt's scroll-area child exposure:
https://github.com/qt/qtbase/blob/v6.8.3/src/widgets/accessible/complexwidgets.cpp#L505-L580

The gate floats and enlarges the actual dock. It reads native table cells when a
real focus event exposes that table; otherwise it OCRs the rendered table's
headers and every name/start/end row, preserving the screenshots and TSV. Row
coordinates come from that actual native evidence. Real mouse clicks must still
seek the separately read Project playhead to the literal frame oracle. A precise
one-frame shifted negative and fresh-process save/reopen remain mandatory.
Native compatibility is still pending until the complete hosted gate succeeds.
