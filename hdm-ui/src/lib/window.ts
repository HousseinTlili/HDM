// Native Tauri window control wrappers with safe browser-preview fallbacks.

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function currentWindow() {
  if (!inTauri) return null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function showWindow(): Promise<void> {
  const win = await currentWindow();
  if (!win) return;
  await win.show();
  await win.setFocus();
}

export async function minimizeWindow(): Promise<void> {
  const win = await currentWindow();
  if (win) await win.minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  const win = await currentWindow();
  if (win) await win.toggleMaximize();
}

export async function isWindowMaximized(): Promise<boolean> {
  const win = await currentWindow();
  return win ? win.isMaximized() : false;
}

export async function closeWindow(): Promise<void> {
  const win = await currentWindow();
  if (win) await win.close();
}

export async function startDragging(): Promise<void> {
  const win = await currentWindow();
  if (win) await win.startDragging();
}

export async function onWindowResized(cb: () => void): Promise<() => void> {
  const win = await currentWindow();
  if (!win) return () => {};
  return win.onResized(cb);
}
