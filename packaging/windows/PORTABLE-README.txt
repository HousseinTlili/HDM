HDM (Houssein Download Manager) — portable edition
====================================================

1. Run hdm.exe. All settings, SQLite history, and managed tools (yt-dlp / ffmpeg) are kept in the
   "data" folder next to hdm.exe because portable.txt is present, so the folder can live on a USB drive.
2. Browser integration: HDM automatically registers prism-native-host.exe (dev.prism.host) for the
   current Windows user and writes the running hdm.exe path into data\app-path so browser extensions
   launch and communicate with HDM directly.
     - Chromium (Chrome / Edge / Brave / Opera / Vivaldi): load unpacked from extension\chromium
       (enable Developer Mode -> Load unpacked) or install the Prism companion extension from Chrome Web Store:
       https://chromewebstore.google.com/detail/prism-download-manager/mmcdeiglkbfbicdjboocmhehodogilfl
     - Firefox / Zen / Waterfox: about:debugging -> This Firefox -> Load Temporary Add-on ->
       extension\firefox\manifest.json (or install from Firefox Add-ons)
3. Open Settings -> Browser Integration inside HDM to check extension connectivity or repair registration in one click.

Requires the Microsoft Edge WebView2 runtime (preinstalled on Windows 10/11).
