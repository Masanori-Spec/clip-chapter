# Verified offline release

The standalone `dist/clip-chapter.html` was tested at commit
`dab5ce89ad39e89a04fb6445eb23c531ae72df91`. Its SHA-256 is
`e2981d06f6b1721d07d93f76fe9953837d535ccc7118e5b19f883848bc2402ec`
(325301 bytes). Documentation/evidence closeout does not change this HTML.

## Actual browser output, actual native consumer

The [browser/native run37452696942](https://github.com/Masanori-Spec/clip-chapter/actions/runs/37452696942)
and [native-only run37452696866](https://github.com/Masanori-Spec/clip-chapter/actions/runs/37452696866)
both passed. 38 core tests and 29 browser checks passed with no page errors or
HTTP(S) requests. Chromium 154 ran with its sandbox requested and the actual
main-process command retained, without no-sandbox or disable-setuid-sandbox.

The browser opened offline, imported a freshly official-GUI-authored MLT and
actual ffprobe JSON, required explicit occurrence/source confirmation, and
performed a real keyboard-triggered MLT download. Those downloaded bytes, not a
prototype-generated replacement, were consumed by official pinned Shotcut 26.9.27.
The output SHA-256 for that run was
`2a7b106974b0e3726f488d84d4b1fd0a58566fcfe04f3ba74a7a43abadc6f4e7`.

The native Markers panel displayed Baseline 30, Chapter A 300, Chapter B 366,
Chapter C 450 and Last included 479, with start=end for every row. Real mouse
clicks sought the Project playhead to each frame. Native Save As and a fresh
process reopen repeated all five checks: ten actual clicks in total.
The exact Chapter B 367-only negative was observed and rejected. Independent
Python checked literal frames, all non-marker patch bytes and all existing
Baseline keys/colors/properties.

## Interface coverage

- Keyboard file chooser, skip link, explicit selection and actual download
- Correct mapping of the other occurrence to 30/90/156/240/269/270
- Source-identity and CSV-zero-origin confirmations
- ffprobe/CSV errors, nonzero origin, source filename mismatch, proxy/retime,
  DTD/external-entity and malformed XML rejection, and input size bounds
- Inert chapter text; no markup execution
- Delayed file reads, clear/new-sample interruption, changed-occurrence export
  cancellation, byte-deterministic repeated exports and clean offline reopening
- Japanese/English desktop and 320/390px viewport layouts, including real
  horizontal scrolling to the complete numeric rounding column
- Readable one-page Japanese/English printed reviews containing every included
  point, excluded chapter and preserved baseline marker

The empty-file test dispatches an empty change event. It does not claim to test
an operating-system picker cancellation. Mobile checks use Chromium viewports,
not physical devices or a cross-browser compatibility matrix.

## Byte-preservation boundary

ClipChapter's exported marker patch preserves every non-marker byte. A later
Shotcut Save/Save As can normalize metadata. Marker values, clip trims and
resource references were checked across that native save; whole-file or
outside-marker byte identity across Shotcut's save is not claimed.

The selected input must still be a supported normal-speed flat occurrence.
This is a bounded point-marker tool, not a general MLT editor or complete-project
packager. The sample and evidence MLTs have synthetic media references; video
files and official vendor binaries are not included in the public source.

See [evidence/provenance.json](evidence/provenance.json) for exact artifact IDs,
digests and byte-identical evidence copies. The original synthetic fixtures and
code have no reuse license grant; only legitimate bundled dependency notices
are licensed by their respective authors.
