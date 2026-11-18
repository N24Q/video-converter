# Video Converter

A desktop video and audio converter for **ChromeOS (the Linux development environment, "Crostini")** and other Linux desktops, based on **FFmpeg**. It handles everyday conversions with simple presets, exposes full encoder control in an advanced mode, and treats **AVCHD camcorder recordings** (`.MTS` / `.M2TS` files and whole `PRIVATE/AVCHD/BDMV` card structures) as a first-class feature.

Built with Electron, React and TypeScript. Your source files are never modified or deleted.

## Features

- **Import:** drag and drop files or folders, or use the file/folder dialogs. Multiple files at once. Nothing starts converting until you ask.
- **Inspection:** every file is probed with FFprobe, which reports container, streams, codecs, resolution, frame rate, interlacing, rotation, audio layout, languages and chapters. File extensions are only hints.
- **Simple mode:** pick a preset and a format, then convert.
  - Best Compatibility: MP4, H.264 (CRF 21), AAC, `yuv420p`, fast start
  - High Quality, Smaller File Size (HEVC/AV1), Web Optimised (MP4 or WebM)
  - Original Quality (stream copy, no re-encoding, with a clear explanation when it isn't possible)
  - Archive Quality (FFV1 + FLAC in MKV, or ProRes HQ + PCM in MOV)
  - Audio Only (MP3, M4A, AAC, WAV, FLAC, Ogg, Opus, WMA, AIFF, AC-3, E-AC-3)
- **Advanced mode:** container, video and audio encoder, CRF/quality or ProRes/DNxHR profile, speed preset, bitrate and max bitrate, resolution (presets or custom, aspect ratio kept, portrait-aware, optional stretch), frame rate, deinterlacing, rotation, crop, pixel format, audio bitrate, sample rate and channels, per-track audio and subtitle selection, subtitle copy/convert/remove, metadata and chapters, and a small allowlist of extra FFmpeg options.
- **Stream plan:** before you convert, the app shows what will happen to every stream (re-encoded, copied, converted, or left out, with the reason). Streams are never dropped silently.
- **Queue:** real progress from FFmpeg (percentage, elapsed time, time remaining, speed), cancel, retry, retry on CPU after a hardware-encoder failure, error details, "show in folder", and persistent history. One conversion runs at a time by default; this is configurable.
- **Safe output:** each conversion writes to a hidden temporary file next to the destination. The result is checked with FFprobe and only then renamed into place. Existing files are never overwritten unless you choose to allow it. Unfinished files from a crash are cleaned up on the next start.
- **AVCHD:** finds BDMV structures anywhere inside a selected folder (any folder name, any letter case), reads the camera's playlists to get the real playback order and to group clips that the camera split automatically, and lets you convert clips individually, as a batch, or **combined into one file**.
- **Diagnostics:** app/OS/architecture, Electron/Node versions, FFmpeg/FFprobe versions and paths, available encoders/muxers/demuxers, and hardware-encoder test results.

## How format support works

At start-up the app runs `ffmpeg -encoders`, `-decoders`, `-muxers`, `-demuxers` and `-hwaccels` and caches the results. Only formats whose muxer **and** a suitable encoder exist in your FFmpeg build are offered.

A **container** (MP4, MKV, MOV, WebM…) is the file type. Inside it are **encoded streams** (H.264, HEVC, AV1, VP9, ProRes… for video; AAC, Opus, MP3, AC-3, FLAC… for audio). Not every container can hold every codec, so the app checks each combination against a compatibility table before running FFmpeg. For example, it rejects copying H.264 into WebM or PCM Blu-ray audio into MKV, and converts text subtitles to `mov_text` for MP4.

Output formats: MP4, MKV, MOV, WebM, M4V, AVI, MPEG-TS (`.ts`), M2TS, MTS, MPEG-PS (`.mpg`/`.mpeg`), VOB, MXF, WMV/ASF, FLV, OGV, 3GP, 3G2, DV, Y4M, and the audio formats listed above. Anything FFmpeg can decode can be used as input, including MPG, MPEG, MPE, MTS, M2TS, M2T, TS, VOB, MXF, MP4, M4V, MP4V, MOV, QT, MKV, AVI, WMV, ASF, WebM, FLV, OGV, OGG, 3GP, 3G2, DV and Y4M.

Hardware encoders (VAAPI, NVENC) are only offered after a short test encode succeeds on your machine. Software encoding always works.

## Technology

Electron 45 · React 19 · TypeScript 6 · Vite 8 · esbuild (main/preload bundles) · Vitest 5 · Playwright · electron-builder 26 · GitHub Actions. FFmpeg and FFprobe are used as external programs and are not bundled.

```text
electron/            main process
  main.ts            window, security settings, start-up, quit handling
  preload.ts         the only bridge to the renderer (contextBridge)
  ipc/               IPC handlers and input validation
  services/          FFmpeg discovery, probing, capabilities, catalog/presets,
                     stream planning, argument builder, runner, queue,
                     executor, AVCHD scanning/playlists, settings, history
shared/              types and IPC channel names shared by both sides
src/                 React renderer (components, pages, hooks)
tests/unit           parsers, planning, args, queue, AVCHD, naming...
tests/integration    real FFmpeg conversions
tests/e2e            Playwright tests driving the built app
scripts/             dev runner, Electron bundler, icon generator
```

## Development on Arch Linux

Requirements: Node.js 22.12 or newer (developed with Node 26 / npm 12), git, and FFmpeg.

```bash
sudo pacman -S nodejs npm ffmpeg git
git clone https://github.com/N24Q/video-converter.git
cd video-converter
npm install          # also downloads the Electron binary (postinstall)
npm run dev          # Vite dev server + Electron with hot reload
```

On npm 12, install scripts are blocked unless allowed. The repository's `allowScripts` already permits esbuild. If Electron fails to start with "Electron failed to install correctly", run `npx install-electron`.

### VS Code

Open the folder, then install the recommended extensions when prompted (ESLint, Prettier, Vitest, Playwright). A "Debug main process" launch configuration is included.

VS Code's integrated terminal sets `ELECTRON_RUN_AS_NODE=1`, which makes Electron behave like plain Node. `npm run dev`, `npm start` and the tests clear this variable automatically. If you run `npx electron .` by hand, use `env -u ELECTRON_RUN_AS_NODE npx electron .`.

### Commands

| Command                                                       | What it does                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                 | Run in development mode                                                                              |
| `npm run build`                                               | Build renderer (`dist/`) and main/preload (`dist-electron/`)                                         |
| `npm start`                                                   | Run the built app                                                                                    |
| `npm run lint` / `npm run format:check` / `npm run typecheck` | Static checks                                                                                        |
| `npm run test:unit`                                           | Unit tests (no FFmpeg needed)                                                                        |
| `npm run test:integration`                                    | Real conversions (skipped with a reason if FFmpeg or an encoder is missing)                          |
| `npm test`                                                    | Unit + integration                                                                                   |
| `npm run test:e2e`                                            | Build, then drive the app with Playwright (needs a display; use `xvfb-run -a` on a headless machine) |
| `npm run package:amd64`                                       | Build `release/VideoConverter-<version>-amd64.deb`                                                   |
| `npm run package:arm64`                                       | Build `release/VideoConverter-<version>-arm64.deb` (cross-builds from x86_64)                        |
| `npm run package`                                             | Build a `.deb` for the host architecture                                                             |

## Installing on a Chromebook

> These steps follow the standard ChromeOS Linux procedure. The packages are built and test-installed on Ubuntu runners in CI, but have **not yet been tested on a physical Chromebook**.

1. **Turn on Linux:** Settings → About ChromeOS → Developers → Linux development environment → Set up.
2. **Find your Chromebook's architecture.** Open the Terminal app and run:
   ```bash
   dpkg --print-architecture
   ```
   `amd64` means an Intel/AMD Chromebook, and `arm64` means an ARM one (e.g. MediaTek or Qualcomm). The app's Diagnostics tab shows the same thing.
3. **Download** the matching `VideoConverter-<version>-<arch>.deb` from the [Releases page](https://github.com/N24Q/video-converter/releases) into your Linux files (or move it there from Downloads with the Files app).
4. **Install** it, which also installs FFmpeg:
   ```bash
   sudo apt update
   sudo apt install ./VideoConverter-*.deb
   ```
   You can also double-click the `.deb` in the Files app and choose _Install with Linux_, though that route may not pull in FFmpeg. If the app reports FFmpeg missing, run `sudo apt install ffmpeg`.
5. **Launch** "Video Converter" from the launcher (it appears in the _Linux apps_ folder) or run `video-converter` in the Terminal.
6. **Give Linux access to your files.** In the Files app, right-click a folder (or an SD card) and choose _Share with Linux_. Shared folders appear under `/mnt/chromeos/`. Camcorder SD cards must be shared before the app can see them.

**Uninstall:** `sudo apt remove video-converter`. Settings and history stay in `~/.config/Video Converter/`; delete that folder to remove them too.

### Other Debian/Ubuntu systems

`sudo apt install ./VideoConverter-<version>-<arch>.deb` works the same way. On Arch, run `npm run build && npm start`, or install the `.deb` contents with a tool such as `debtap`. The `.deb` is aimed at Debian-based systems.

## AVCHD: importing and combining camcorder footage

1. Insert the card, share it with Linux (ChromeOS), then click **Browse folder…** and pick the card or any folder above `BDMV`, or drag the folder onto the window. Selecting the `STREAM` folder itself also works.
2. The **AVCHD recordings** panel lists the clips and explains how the order was determined:
   - **Camera playlist:** order and recording groups come from the `PLAYLIST/*.MPL` (or `.mpls`) files. Clips the camera split automatically (for example at the 2 GB FAT32 limit) are marked as the same _Recording N_. Click a recording name to select all of its parts.
   - **Camera playlist (partial):** clips missing from the playlists are listed at the end in file-number order.
   - **File number:** no readable playlist was found, so clips are sorted by number. Check this order before combining.

   You can move clips up or down to change the order manually.

3. **Convert individually:** tick clips, choose a preset or format, and click **Convert selected**. Each clip becomes its own file.
4. **Combine:** tick two or more clips and click **Combine … into one file**. They are joined in the order shown.
   - If all selected clips have identical stream parameters, they are joined with FFmpeg's concat demuxer. With the _Original Quality_ preset this is lossless and fast.
   - If they differ (resolution, frame rate, codecs, audio layout…), the panel lists the differences. Combining then requires re-encoding: each clip is scaled and padded to one size and frame rate, and audio is resampled. Clips without audio get silence so sound stays in sync. Stream copy is refused for such clips, with an explanation.
5. Interlaced footage (e.g. 1080i50/60i) is deinterlaced automatically when re-encoding. You can change this in advanced mode.

What playlist support covers: the PlayItem list (clip order, in/out times, connection conditions) of MPLS/MPL files, and a header check of CLPI/CPI clip-info files. Other camcorder metadata (GPS, per-clip recording dates in the clip info, menus) is not read or preserved. Recording dates come from the stream's own metadata when present.

## Troubleshooting

| Problem                                            | What to do                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "FFmpeg is not available"                          | `sudo apt install ffmpeg` (ChromeOS/Debian) or `sudo pacman -S ffmpeg` (Arch), then _Diagnostics → Re-check FFmpeg_. For a custom location, set it in _Settings → FFmpeg_.                                |
| A format or preset is greyed out                   | Your FFmpeg build lacks the muxer or encoder. Diagnostics lists what is available. Debian's `ffmpeg` package includes x264, x265, VP9, AV1, Opus and LAME.                                                |
| "Cannot copy … into …"                             | The container can't hold that codec without re-encoding. Use a re-encoding preset or MKV.                                                                                                                 |
| Files on an SD card or Google Drive aren't visible | Share the folder with Linux in the ChromeOS Files app.                                                                                                                                                    |
| Hardware encoder failed                            | Click _Retry with CPU encoder_. Hardware video encoding is often unavailable inside Crostini.                                                                                                             |
| Conversions are slow                               | Expected on low-power Chromebooks. Keep _Conversions at the same time_ at 1, try _Smaller File Size_ with a faster speed preset in advanced mode, or use _Original Quality_ when the container allows it. |
| "Not enough free space"                            | Free space in the output folder's drive. Copying needs roughly the source size; re-encoding needs less, but the app keeps at least 200 MB free.                                                           |
| The app won't start from a VS Code terminal        | `ELECTRON_RUN_AS_NODE` is set; use `npm start` / `npm run dev`, which clear it.                                                                                                                           |
| Logs                                               | `~/.config/Video Converter/logs/app.log` (rotated at 1 MB, 3 files). Failed jobs also show FFmpeg's last output under _Show details_.                                                                     |

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload exposes a narrow, typed API through `contextBridge`.
- Every IPC call checks that it comes from the app's own page and validates its arguments. The renderer refers to media by id, never by path, for conversions. Source paths only come from native dialogs or drag-and-drop, and output folders must have been chosen in the folder dialog.
- FFmpeg/FFprobe run via `spawn` with argument arrays and never through a shell. Extra options in advanced mode are limited to an allowlist. Inputs, outputs, `-map`, filters and anything that reads or writes files are rejected, as are values that look like paths or URLs.
- Navigation, new windows, webviews and permission requests (camera, notifications…) are blocked. A strict Content-Security-Policy is applied. Media metadata is rendered as text, never HTML.
- Source files are opened read-only by FFmpeg and are never written, renamed or deleted.

## Known limitations

- **Not yet tested on a physical Chromebook.** Development and testing used Arch Linux (x86_64). The ARM64 build is cross-compiled locally and tested on GitHub's native ARM64 runners.
- Hardware acceleration: only VAAPI and NVENC encoders are wired up, and only after a self-test. Hardware _decoding_ is not used. QSV, VideoToolbox and others are not offered.
- AVCHD: only playlist clip order/grouping and clip-info presence are read. Multi-angle and 3D (MVC) AVCHD are untested, and proprietary camcorder metadata is not preserved.
- Combining with the concat demuxer uses the first clip's stream layout. Normalised combining keeps only the first video and audio stream of each clip and drops subtitles.
- The open dialog offers common media extensions plus _All files_. Very obscure formats work if FFmpeg can read them.
- Interrupted conversions are not resumed. Their partial files are removed at the next start.
- Drag-and-drop is not covered by the automated end-to-end tests, because Playwright can't synthesise an OS-level file drop. It uses Electron's `webUtils.getPathForFile` and the same import path as the dialogs, which _is_ tested.
- Styling is deliberately plain.

## Licensing and FFmpeg redistribution

This project is MIT-licensed (see [LICENSE](LICENSE)). It **does not bundle FFmpeg**. It runs the FFmpeg installed on the system, and the `.deb` declares a dependency on the distribution's `ffmpeg` package. FFmpeg is LGPL/GPL software, and distribution builds often include GPL components such as x264 and x265. Bundling an FFmpeg binary in the package would bring GPL source-offer and licence obligations, and some codecs (e.g. `libfdk_aac`) are non-redistributable. Review those before ever bundling FFmpeg. Codec patents may also apply in some countries.
