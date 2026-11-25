import { useEffect, useState } from "react";
import { ArrowLeft, Cpu, HardDrive, MemoryStick, Terminal } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { SystemHardwareInfo } from "../../lib/types";
import { useUiStore } from "../../store/uiStore";
import { HuggingFaceTab } from "../modals/HuggingFaceTab";
import { OllamaTab } from "../modals/OllamaTab";
import { LocalModelsTab } from "./LocalModelsTab";

export function ModelHubView() {
  const modelHubTab = useUiStore((s) => s.modelHubTab);
  const setModelHubTab = useUiStore((s) => s.setModelHubTab);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const [hardware, setHardware] = useState<SystemHardwareInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void ipc
      .systemHardwareInfo()
      .then((hw) => {
        if (alive) setHardware(hw);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="flex-1 min-w-0 bg-surface rounded-xl border border-outline/80 overflow-hidden mb-2 mr-2 flex flex-col min-h-0">
      {/* Header */}
      <header className="px-6 py-4 bg-surface-container border-b border-outline flex items-center justify-between gap-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded bg-primary-badge border border-primary/40 flex items-center justify-center shrink-0">
            <Cpu size={18} className="text-on-primary-badge" aria-hidden="true" />
          </div>
          <div className="flex flex-col min-w-0">
            <h1 className="font-title text-title-lg text-on-surface">
              AI Model Hub
            </h1>
            <span className="font-body text-body-sm text-on-surface-variant truncate">
              Browse, check VRAM fit, download local LLM weights, and manage installed models
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Provider Switcher */}
          <div className="p-0.5 rounded bg-surface border border-outline flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setModelHubTab("ollama")}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-sm font-label text-label-md transition-colors duration-state-change ${
                modelHubTab === "ollama"
                  ? "bg-primary-tint border border-primary/40 text-on-surface"
                  : "border border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Terminal
                size={13}
                className={modelHubTab === "ollama" ? "text-on-primary-badge" : ""}
                aria-hidden="true"
              />
              <span>Ollama Library</span>
            </button>
            <button
              type="button"
              onClick={() => setModelHubTab("huggingface")}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-sm font-label text-label-md transition-colors duration-state-change ${
                modelHubTab === "huggingface"
                  ? "bg-primary-tint border border-primary/40 text-on-surface"
                  : "border border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Cpu
                size={13}
                className={modelHubTab === "huggingface" ? "text-on-primary-badge" : ""}
                aria-hidden="true"
              />
              <span>Hugging Face Hub</span>
            </button>
            <button
              type="button"
              onClick={() => setModelHubTab("local")}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-sm font-label text-label-md transition-colors duration-state-change ${
                modelHubTab === "local"
                  ? "bg-primary-tint border border-primary/40 text-on-surface"
                  : "border border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <HardDrive
                size={13}
                className={modelHubTab === "local" ? "text-on-primary-badge" : ""}
                aria-hidden="true"
              />
              <span>My Local Models</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveView("downloads")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back to Queue</span>
          </button>
        </div>
      </header>

      {/* Hardware Fit Strip */}
      {hardware && (
        <div className="px-6 py-2 bg-surface border-b border-outline flex items-center justify-between gap-4 text-on-surface-variant flex-wrap shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="inline-flex items-center gap-1.5 font-mono text-mono-sm text-on-surface">
              <Cpu size={12} className="text-status-connected" aria-hidden="true" />
              {hardware.gpuName && hardware.gpuVramBytes
                ? `${hardware.gpuName} (${formatBytes(hardware.gpuVramBytes)} VRAM)`
                : "No dedicated GPU VRAM detected (CPU/RAM mode)"}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-mono-sm tabular">
              <MemoryStick size={12} aria-hidden="true" />
              RAM: {formatBytes(hardware.totalRamBytes)} ({formatBytes(hardware.availableRamBytes)} free)
            </span>
          </div>
          <span className="font-mono text-mono-sm text-on-surface-variant">
            Fit checks include ~15% KV-cache overhead
          </span>
        </div>
      )}

      {/* Active Provider Browser */}
      <div className="flex-1 flex flex-col min-h-0">
        {modelHubTab === "ollama" ? (
          <OllamaTab
            fullPage
            hardware={hardware}
            initialInput=""
            onDone={() => setActiveView("downloads")}
          />
        ) : modelHubTab === "huggingface" ? (
          <HuggingFaceTab
            fullPage
            hardware={hardware}
            initialInput=""
            onDone={() => setActiveView("downloads")}
          />
        ) : (
          <LocalModelsTab hardware={hardware} />
        )}
      </div>
    </main>
  );
}
