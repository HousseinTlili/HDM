<p align="center">
  <img src="app/src-tauri/icons/hdm-source.png" width="120" alt="HDM Dragon Emblem">
</p>

<h1 align="center">HDM — Houssein Download Manager</h1>

<p align="center">
  <b>Stealth Obsidian & Crimson Edition</b><br>
  A fast, local-first multi-connection desktop download manager built with Rust, Tauri 2, React 19, and a bundled C++ BitTorrent engine.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-E11D2E?style=flat-square"></a>
  <img alt="Stack" src="https://img.shields.io/badge/Rust%20%2B%20Tauri%202%20%2B%20React%2019-16161C?style=flat-square">
  <img alt="Platforms" src="https://img.shields.io/badge/Windows%20·%20macOS%20·%20Linux-555?style=flat-square">
</p>

---

**HDM (Houssein Download Manager)** is a custom desktop download manager designed for high-speed multi-connection transfers, AI model downloads, media grabbing, and BitTorrent swarms — all inside a seamless dark **Stealth Obsidian & Crimson** interface.

Zero ads, zero accounts, zero telemetry.

## Features

- **Multi-Connection HTTP(S) / FTP Acceleration**
  - Splits files into up to **32 parallel segments** (`16` default connections, `64 MiB` adaptive chunks, HTTP/2 multiplexing, `128 MiB` write buffer) with crash-safe resume and remote ZIP file preview/extraction.
- **High-Speed BitTorrent Engine (`aria2c` C++ + `librqbit` fallback)**
  - Bundled C++ `aria2c` backend with **MSE/PE protocol encryption**, pure TCP pipelining, **64 MiB disk cache**, **DHT + PEX + LPD**, top-20 public trackers, and **outbound-only firewall safety** (zero router ports opened).
  - Includes **Force Recheck**, **Sequential Download (Head & Tail First)**, **Per-Torrent DL/UL Speed Caps**, and **Extra Trackers / Re-announce** in Settings.
- **AI Model Hub (Ollama + Hugging Face)**
  - Browse **Ollama Library** and **Hugging Face Hub**, check **VRAM / RAM hardware fit** automatically, download GGUF weights, inspect/manage local models, and import GGUF files directly into Ollama.
- **Selective Malware Guard (Advisory-Only)**
  - Checks URLs and completed executables/scripts using **local stealer/ransomware/dropper heuristics**, **MalwareBazaar (abuse.ch)** SHA-256 lookups, and optional **VirusTotal** integration — filtering out benign `HackTool` / `Crack` / `Keygen` labels and leaving the final **Keep** or **Delete** decision to you.
- **Video & Audio (`yt-dlp` + `ffmpeg`)**
  - Grab video up to 8K/HDR or extract audio (`MP3`, `M4A`, `Opus`, `FLAC`, `WAV`) with subtitles, chapters, and SponsorBlock support.
- **Queues, Night Scheduler & Browser Integration**
  - Multi-queue scheduler with Night Queue presets, post-download power actions (`Sleep`, `Hibernate`, `Shutdown`), site/batch grabber, clipboard monitor, and Chromium/Firefox native messaging extension.
- **Stable Average-Speed ETA & Real-Time Telemetry**
  - Session-average ETA calculation resistant to instantaneous speed spikes and disk recheck jumps, plus a 32-segment chunk map and SHA-256 verification.

## Build From Source

### Prerequisites
- **Rust** (`1.88+`)
- **Node.js** (`20+`) & **npm**

### Frontend Tests & Build
```bash
npm --prefix hdm-ui install
npm --prefix hdm-ui run test
npm --prefix hdm-ui run build
```

### Desktop App & Installers (Windows)
```bash
npm --prefix app install
npm --prefix app run tauri:build
```

Outputs are generated in:
- `target/release/hdm.exe`
- `target/release/bundle/nsis/HDM_0.1.0_x64-setup.exe`
- `target/release/bundle/msi/HDM_0.1.0_x64_en-US.msi`

To build the Windows portable `.zip` package:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\make-portable.ps1
```

## License & Attribution

HDM is released under the [MIT License](LICENSE). Its core Rust download engine builds upon the MIT-licensed [Prism Download Manager](https://github.com/FortoGraphy/prism-download-manager) crates (`prism-engine`, `prism-core`, `prism-video`, `prism-native-host`) and bundles [aria2](https://aria2.github.io/).
