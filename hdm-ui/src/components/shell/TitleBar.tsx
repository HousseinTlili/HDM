import { useEffect, useRef, useState } from "react";
import { Link2, Minus, PanelRight, Settings, Square, Copy, X } from "lucide-react";
import hdmLogo from "../../assets/hdm-logo.png";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "../../lib/window";

export function TitleBar() {
  const version = useDownloadsStore((s) => s.version);
  const activeView = useUiStore((s) => s.activeView);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const quickPasteUrl = useUiStore((s) => s.quickPasteUrl);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const toggleInspector = useUiStore((s) => s.toggleInspector);
  const setQuickPasteUrl = useUiStore((s) => s.setQuickPasteUrl);
  const setPendingIntent = useUiStore((s) => s.setPendingIntent);

  const [maximized, setMaximized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    const sync = async () => {
      const m = await isWindowMaximized();
      if (alive) setMaximized(m);
    };
    void sync();
    void onWindowResized(() => void sync()).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const submitUrl = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setQuickPasteUrl(trimmed);
    setPendingIntent({ kind: "new", url: trimmed });
  };

  return (
    <header
      data-tauri-drag-region
      className="h-9 min-h-[36px] w-full bg-surface-container px-3 flex items-center justify-between gap-4 shrink-0 select-none"
    >
      {/* Left: Dragon Brand Mark + App Name */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2.5 min-w-[200px]"
      >
        <div
          data-tauri-drag-region
          className="w-6 h-6 rounded-sm bg-surface-container-high border border-outline overflow-hidden flex items-center justify-center shrink-0"
        >
          <img
            src={hdmLogo}
            alt="HDM Dragon Emblem"
            className="w-5 h-5 object-contain pointer-events-none"
            draggable={false}
          />
        </div>
        <span
          data-tauri-drag-region
          className="font-title text-title-sm text-on-surface tracking-tight"
        >
          HDM
        </span>
        <span
          data-tauri-drag-region
          className="font-mono text-mono-sm text-on-surface-variant px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-outline tabular"
        >
          v{version}
        </span>
      </div>

      {/* Center: Quick-paste URL / Command Input */}
      <form
        className="flex-1 max-w-xl flex items-center justify-center"
        onSubmit={(e) => {
          e.preventDefault();
          submitUrl(quickPasteUrl);
        }}
      >
        <label className="relative flex items-center w-full">
          <Link2
            size={14}
            className="text-on-surface-variant absolute left-2.5 pointer-events-none"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={quickPasteUrl}
            onChange={(e) => setQuickPasteUrl(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").trim();
              if (pasted) {
                e.preventDefault();
                submitUrl(pasted);
              }
            }}
            placeholder="Paste URL, Magnet, YouTube, or Hugging Face link..."
            aria-label="Paste URL, Magnet, YouTube, or Hugging Face link"
            className="w-full h-6 pl-8 pr-16 rounded bg-surface border border-outline text-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary transition-colors duration-state-change ease-state-change"
          />
          <kbd className="absolute right-1.5 px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-outline font-mono text-mono-sm text-on-surface-variant leading-none pointer-events-none">
            Ctrl+V
          </kbd>
        </label>
      </form>

      {/* Right: Shell & Window Controls */}
      <div className="flex items-center gap-1 min-w-[140px] justify-end">
        <button
          type="button"
          onClick={() =>
            setActiveView(activeView === "settings" ? "downloads" : "settings")
          }
          aria-label="Engine Settings"
          title="Engine Settings"
          aria-pressed={activeView === "settings"}
          className={
            activeView === "settings"
              ? "inline-flex items-center justify-center w-7 h-6 rounded-sm bg-primary-tint text-on-primary-badge border border-primary/40 transition-colors duration-state-change ease-state-change"
              : "inline-flex items-center justify-center w-7 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-state-change ease-state-change"
          }
        >
          <Settings size={14} aria-hidden="true" />
        </button>

        {activeView === "downloads" && (
          <button
            type="button"
            onClick={toggleInspector}
            aria-label="Toggle Inspector Drawer"
            title="Toggle Inspector Drawer"
            aria-pressed={inspectorOpen}
            className={
              inspectorOpen
                ? "inline-flex items-center justify-center w-7 h-6 rounded-sm text-on-surface bg-surface-container-high transition-colors duration-state-change ease-state-change"
                : "inline-flex items-center justify-center w-7 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-state-change ease-state-change"
            }
          >
            <PanelRight size={14} aria-hidden="true" />
          </button>
        )}

        <div className="w-px h-3.5 bg-outline mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => void minimizeWindow()}
          aria-label="Minimize window"
          title="Minimize"
          className="inline-flex items-center justify-center w-7 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-state-change ease-state-change"
        >
          <Minus size={14} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => void toggleMaximizeWindow()}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
          className="inline-flex items-center justify-center w-7 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-state-change ease-state-change"
        >
          {maximized ? (
            <Copy size={12} aria-hidden="true" />
          ) : (
            <Square size={12} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() => void closeWindow()}
          aria-label="Close window"
          title="Close to tray"
          className="inline-flex items-center justify-center w-7 h-6 rounded-sm text-on-surface-variant hover:text-on-primary hover:bg-primary transition-colors duration-state-change ease-state-change"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
