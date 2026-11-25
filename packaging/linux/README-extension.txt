HDM (Houssein Download Manager) browser extension
=================================================

  Chrome / Edge / Brave / Opera / Vivaldi / Helium / Chromium
    Load the unpacked extension folder shown in HDM -> Settings -> Browser Integration
    (Developer Mode -> "Load unpacked" -> select extension/chromium), OR install from the Chrome Web Store:
    https://chromewebstore.google.com/detail/prism-download-manager/mmcdeiglkbfbicdjboocmhehodogilfl

  Firefox / Zen / Waterfox
    about:debugging#/runtime/this-firefox -> "Load Temporary Add-on" -> manifest.json
    inside the `firefox` folder shown in HDM -> Settings -> Browser Integration:

      deb / rpm   /usr/lib/HDM/extension
      AppImage    ~/.local/share/prism/extension (HDM copies it out of the temporary AppImage mount)

HDM automatically registers its native messaging host (dev.prism.host) and records the running `hdm` binary path.
Open HDM -> Settings -> Browser Integration to check connection status or repair registration in one click.
