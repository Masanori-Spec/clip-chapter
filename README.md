# ClipChapter

Native-first feasibility gate for putting source chapter points at the correct position of one selected Shotcut timeline clip occurrence.

**Status: core tests pass. Official GUI authoring/marker/playhead/save-reopen verification is pending. No product UI exists yet.**

## Narrow contract

Inputs are a saved Shotcut XML MLT project plus ffprobe chapter JSON, or an explicit `source_seconds,title` CSV with a zero-source-origin declaration. The user selects a specific normal-speed, flat clip occurrence, even when the same source appears more than once.

The mapping is:

`timeline frame = occurrence start + source chapter position − selected clip in`

Only points within the source trim are eligible. Times are calculated as exact rational numbers and quantized to the nearest project frame, with half-up ties. A result that would quantize outside the selected clip is excluded. A receipt records included/excluded points and exact quantization deltas. Existing point markers with identical text/frame are not duplicated.

The output is an adjacent-save MLT copy. Only the timeline's `shotcut:markers` property region is patched; every other source byte, existing marker, clip occurrence and media reference is preserved. No media is read or transcoded by the product core, and this is not a later-move-following or marker-lock feature.

Unsupported selected clips include retime/reverse, nested/transition clips, proxy or alternate-resource/conversion metadata, nonzero source time origin, remote media and ambiguous timing. Only plain avformat/avformat-novalidate producers are eligible. A normal `shotcut:producer=avformat` label is allowed; it is not a speed flag. ffprobe format/stream zero-origin evidence is required, and a supplied media filename must match the selected resource's basename. Filename matching does not prove source-content identity.

Limits: 8 MiB input/output MLT, 4 MiB chapter input, 10,000 chapter points, 50,000 XML elements, XML depth 96 and one billion frame positions. Output element limits are checked before returning a patched file. UTF-8 only; DTDs, namespaces, invalid XML characters and processing instructions are rejected. Alternate service attributes, attribute-valued or nested/mixed property forms, cropped playlist origins and timing changes on selected ancestry are unsupported. Marker names are bounded single-line text.

## Local core checks

```sh
npm ci --ignore-scripts
npm test
```

This runs only the original JavaScript core tests. The native application is neither downloaded nor executed locally. The original synthetic fixture media generator uses the installed ffmpeg CLI; it never opens user media.

## Mandatory hosted GUI gate

The official pinned Shotcut 26.9.27 Linux txz is downloaded into the temporary GitHub Actions runner. Primary release metadata, exact filename, size and SHA-256 are checked before extraction/execution. No vendor binary enters this repository or its uploaded artifacts.

The gate must:

1. Use official Shotcut GUI controls to author and save two occurrences of an original 30fps, zero-origin synthetic source: first in/out 0–299, then 90–269, so the second starts at timeline frame 300
2. Add and name an existing point marker `Baseline` at frame 30 through the GUI
3. Apply the marker-only patch to that native-authored MLT, targeting the second occurrence
4. Independently verify literal mappings 90→300, 156→366, 240→450 and 269→479; source 30 and 270 are excluded
5. Compare every non-marker byte using independent Python Expat byte spans, and check preserved baseline/occurrences with ElementTree
6. Open the patched MLT in official Shotcut and read the actual Markers QTreeView: five names, starts and ends
7. Perform actual row mouse clicks, then require the Project tab and independent Current position control to show each expected frame
8. Native-save to a fresh copy, close the process, reopen and repeat marker/seek checks
9. Open a one-frame-shifted marker negative control and require the GUI row oracle to reject it

A video render or exit code zero is never accepted as marker proof. This gate uses Xvfb, standard distro GUI-test tools and Shotcut's normal accessibility interface. It does not modify security settings or inject code into the application.

## Research and licensing

See [primary research and boundaries](docs/research.md). No original-code or fixture reuse license has been selected or granted. The XML parser is installed as a normal dependency under its existing license; vendor application source/binaries are not redistributed.
