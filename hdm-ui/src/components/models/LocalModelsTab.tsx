import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { formatBytes } from "../../lib/format";
import { assessModelFit, fitBadgeClasses } from "../../lib/hardware";
import { ipc } from "../../lib/ipc";
import type {
  LocalGgufFile,
  OllamaLocalStatus,
  SystemHardwareInfo,
} from "../../lib/types";
import { useUiStore } from "../../store/uiStore";

interface LocalModelsTabProps {
  hardware: SystemHardwareInfo | null;
}

function defaultImportName(fileName: string): string {
  return (
    fileName
      .replace(/\.gguf$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "hdm-model"
  );
}

export function LocalModelsTab({ hardware }: LocalModelsTabProps) {
  const pushToast = useUiStore((s) => s.pushToast);

  const [ollamaStatus, setOllamaStatus] = useState<OllamaLocalStatus | null>(
    null
  );
  const [ggufFiles, setGgufFiles] = useState<LocalGgufFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [status, files] = await Promise.all([
        ipc.ollamaLocalStatus().catch(() => null),
        ipc.listLocalGgufModels().catch(() => []),
      ]);
      setOllamaStatus(status);
      setGgufFiles(files);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const totalOllamaBytes = useMemo(
    () => (ollamaStatus?.models ?? []).reduce((sum, m) => sum + m.size, 0),
    [ollamaStatus]
  );
  const totalGgufBytes = useMemo(
    () => ggufFiles.reduce((sum, f) => sum + f.size, 0),
    [ggufFiles]
  );

  const handleCopyRun = async (name: string) => {
    try {
      await ipc.clipboardWrite(`ollama run ${name}`);
      pushToast("success", `Copied: ollama run ${name}`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteOllama = async (name: string) => {
    setBusyKey(`ollama:${name}`);
    try {
      const msg = await ipc.ollamaDeleteLocalModel(name);
      pushToast("success", msg);
      setConfirmDeleteKey(null);
      await refresh();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleImportGguf = async (file: LocalGgufFile) => {
    const modelRef = defaultImportName(file.name);
    setBusyKey(`import:${file.path}`);
    try {
      const msg = await ipc.ollamaImportGguf(modelRef, file.path);
      pushToast("success", msg);
      await refresh();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteGguf = async (file: LocalGgufFile) => {
    setBusyKey(`gguf:${file.path}`);
    try {
      await ipc.deleteLocalGguf(file.path);
      pushToast("success", `Deleted ${file.name}`);
      setConfirmDeleteKey(null);
      await refresh();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 gap-6">
      {/* Top Disk Summary */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="px-3 py-2 rounded-md bg-surface-container border border-outline flex items-center gap-2.5">
            <Terminal size={15} className="text-on-primary-badge" aria-hidden="true" />
            <div className="flex flex-col">
              <span className="font-label text-label-sm text-on-surface-variant">
                Local Ollama Store
              </span>
              <span className="font-mono text-mono-md tabular text-on-surface">
                {ollamaStatus?.running
                  ? `${ollamaStatus.models.length} models · ${formatBytes(totalOllamaBytes)}`
                  : "Ollama Offline"}
              </span>
            </div>
          </div>

          <div className="px-3 py-2 rounded-md bg-surface-container border border-outline flex items-center gap-2.5">
            <HardDrive size={15} className="text-on-surface-variant" aria-hidden="true" />
            <div className="flex flex-col">
              <span className="font-label text-label-sm text-on-surface-variant">
                Downloaded GGUF Files
              </span>
              <span className="font-mono text-mono-md tabular text-on-surface">
                {ggufFiles.length} files · {formatBytes(totalGgufBytes)}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40 disabled:opacity-50"
        >
          <RefreshCw
            size={13}
            className={loading ? "animate-spin" : ""}
            aria-hidden="true"
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Section 1: Installed Local Ollama Models */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="font-title text-title-md text-on-surface">
            Installed in Local Ollama
          </h2>
          {ollamaStatus?.modelsDir && (
            <button
              type="button"
              onClick={() => void ipc.openPath(ollamaStatus.modelsDir!)}
              className="font-mono text-mono-sm text-on-surface-variant hover:text-on-surface hover:underline"
            >
              {ollamaStatus.modelsDir}
            </button>
          )}
        </div>

        {!ollamaStatus?.running ? (
          <div className="rounded-md bg-surface-container border border-outline p-4 font-body text-body-sm text-on-surface-variant">
            Local Ollama daemon was not detected on{" "}
            <span className="font-mono text-on-surface">http://127.0.0.1:11434</span>.
            Start Ollama if you want to manage or import models directly into it.
          </div>
        ) : ollamaStatus.models.length === 0 ? (
          <div className="rounded-md bg-surface-container border border-outline p-4 font-body text-body-sm text-on-surface-variant">
            Ollama is running, with 0 models installed yet.
          </div>
        ) : (
          <div className="rounded-md bg-surface-container border border-outline divide-y divide-outline-subtle">
            {ollamaStatus.models.map((m) => {
              const fit = assessModelFit(m.size, hardware);
              const key = `ollama:${m.name}`;
              const confirming = confirmDeleteKey === key;
              return (
                <div
                  key={m.name}
                  className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-mono-md text-on-surface font-medium">
                        {m.name}
                      </span>
                      {m.parameterSize && (
                        <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface border border-outline text-on-surface-variant">
                          {m.parameterSize}
                        </span>
                      )}
                      {m.quantization && (
                        <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface border border-outline text-on-surface-variant">
                          {m.quantization}
                        </span>
                      )}
                      {fit && (
                        <span
                          title={fit.detail}
                          className={`font-mono text-mono-sm px-1.5 py-0.5 rounded-sm ${fitBadgeClasses(fit.tone)}`}
                        >
                          {fit.label}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                      {formatBytes(m.size)}
                      {m.family ? ` · ${m.family}` : ""}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyRun(m.name)}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
                    >
                      <Copy size={12} aria-hidden="true" />
                      <span>Copy Run</span>
                    </button>
                    {confirming ? (
                      <button
                        type="button"
                        disabled={busyKey === key}
                        onClick={() => void handleDeleteOllama(m.name)}
                        className="h-7 px-2.5 rounded bg-primary text-on-primary font-label text-label-sm disabled:opacity-50"
                      >
                        {busyKey === key ? "Deleting…" : "Confirm Remove"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteKey(key)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface-variant hover:text-on-primary-badge hover:border-primary/40"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Downloaded GGUF Files on Disk */}
      <section className="flex flex-col gap-2.5">
        <h2 className="font-title text-title-md text-on-surface">
          Downloaded GGUF Files on Disk
        </h2>

        {ggufFiles.length === 0 ? (
          <div className="rounded-md bg-surface-container border border-outline p-4 font-body text-body-sm text-on-surface-variant">
            No <span className="font-mono text-on-surface">.gguf</span> model files found in your HDM Models or Downloads folders yet.
          </div>
        ) : (
          <div className="rounded-md bg-surface-container border border-outline divide-y divide-outline-subtle">
            {ggufFiles.map((file) => {
              const fit = assessModelFit(file.size, hardware);
              const delKey = `gguf:${file.path}`;
              const importKey = `import:${file.path}`;
              const confirming = confirmDeleteKey === delKey;
              return (
                <div
                  key={file.path}
                  className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-mono-md text-on-surface truncate">
                        {file.name}
                      </span>
                      <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface border border-outline text-on-surface-variant uppercase">
                        {file.source}
                      </span>
                      {fit && (
                        <span
                          title={fit.detail}
                          className={`font-mono text-mono-sm px-1.5 py-0.5 rounded-sm ${fitBadgeClasses(fit.tone)}`}
                        >
                          {fit.label}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
                      {formatBytes(file.size)} · {file.dir}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void ipc.revealPath(file.path)}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
                    >
                      <FolderOpen size={12} aria-hidden="true" />
                      <span>Folder</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === importKey}
                      onClick={() => void handleImportGguf(file)}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-primary-tint border border-primary/40 font-label text-label-sm text-on-primary-badge hover:bg-primary/20 disabled:opacity-50"
                    >
                      <Terminal size={12} aria-hidden="true" />
                      <span>
                        {busyKey === importKey ? "Importing…" : "Import to Ollama"}
                      </span>
                    </button>
                    {confirming ? (
                      <button
                        type="button"
                        disabled={busyKey === delKey}
                        onClick={() => void handleDeleteGguf(file)}
                        className="h-7 px-2.5 rounded bg-primary text-on-primary font-label text-label-sm disabled:opacity-50"
                      >
                        {busyKey === delKey ? "Deleting…" : "Confirm Delete"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteKey(delKey)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface-variant hover:text-on-primary-badge hover:border-primary/40"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
