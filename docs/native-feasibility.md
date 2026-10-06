# Native feasibility evidence

- Official Shotcut26.9.27 Linux archive, exact filename, size153652280 and
  SHA256849da6bbd24737f9edd07ba185b46982f2fb330981c05e1752809e85bcbb7e7b
- [Accepted hosted run37446224097](https://github.com/Masanori-Spec/clip-chapter/actions/runs/37446224097)
- Tested commit13311f8e241e854adea889275276195bae739593
- Artifact11404265414 SHA2562004f7f7d52457fc9c4c9b2971c8d208634d8ff292d1f6d44391f4d95128fe26
-38 core tests and an independently implemented Python byte/frame oracle

The actual official GUI authored a synthetic30fps project with the same media
in two occurrences. The second has source90–269 inclusive at timeline300.
Baseline30 existed before the patch. Chapters90/156/240/269 become points
300/366/450/479. Chapters30 and270 are excluded.

The native Markers panel displayed all five literal names/start/end values.
A real mouse click on every row moved the Project playhead to its exact expected
frame. Native Save As, close and fresh-process reopen repeated all five row and
mouse-seek checks. An intentionally shifted Chapter B at367, with every other
row unchanged, was visibly observed and rejected.

The Linux native dock omits its table from ordinary AT-SPI child traversal.
The harness uses real rendered row pixels to focus that actual table; Qt's focus
event exposes the real native table/cells. The accepted run read every complete
marker table from those AT-SPI cells, not from project XML or generated labels.
Raw screenshots and OCR discovery evidence are retained in the hosted artifact.

ClipChapter's patch leaves every non-marker byte and all existing marker
keys/colors/properties unchanged. Shotcut's subsequent native save normalizes
some metadata, including colorTransfer and skipConvert. Only marker values,
clip trims and resource references are claimed preserved across that native save.

This is the core native-feasibility checkpoint. A later browser interface and
its actual downloaded MLT require a new browser/native gate; these prototype
results alone do not establish that browser output works.
