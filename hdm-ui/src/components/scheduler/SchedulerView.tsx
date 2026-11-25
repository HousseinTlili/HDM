import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Moon,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import { formatSpeed } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { PostAction, Queue } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

const WEEKDAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 7, label: "Sun" },
];

function makeDefaultQueue(name: string, nightPreset: boolean, position: number): Queue {
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36).slice(-4)}`;
  return {
    id,
    name,
    maxConcurrent: nightPreset ? 2 : 3,
    speedLimit: 0,
    position,
    builtin: false,
    running: false,
    schedule: {
      enabled: nightPreset,
      startTime: nightPreset ? "01:00" : "00:00",
      stopTime: nightPreset ? "07:00" : null,
      days: nightPreset ? [1, 2, 3, 4, 5, 6, 7] : [],
      onceDate: null,
      retryFailed: true,
      onComplete: nightPreset ? { type: "sleep" } : { type: "none" },
      wake: nightPreset,
    },
  };
}

export function SchedulerView() {
  const queues = useDownloadsStore((s) => s.queues);
  const itemsById = useDownloadsStore((s) => s.itemsById);
  const itemOrder = useDownloadsStore((s) => s.itemOrder);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const pushToast = useUiStore((s) => s.pushToast);

  const [selectedId, setSelectedId] = useState<string>(
    () => queues[0]?.id ?? "main"
  );
  const [nextRuns, setNextRuns] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  const selectedQueue = useMemo(
    () => queues.find((q) => q.id === selectedId) ?? queues[0] ?? null,
    [queues, selectedId]
  );

  const [draft, setDraft] = useState<Queue | null>(() =>
    selectedQueue ? structuredClone(selectedQueue) : null
  );

  useEffect(() => {
    if (selectedQueue) {
      setDraft(structuredClone(selectedQueue));
    }
  }, [selectedQueue]);

  const refreshNextRuns = () => {
    void ipc
      .nextScheduleRuns()
      .then((pairs) => {
        const map: Record<string, string | null> = {};
        for (const [id, next] of pairs) map[id] = next;
        setNextRuns(map);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refreshNextRuns();
  }, [queues]);

  const queueCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const id of itemOrder) {
      const it = itemsById[id];
      if (!it || it.trashed || !it.queueId) continue;
      map[it.queueId] = (map[it.queueId] ?? 0) + 1;
    }
    return map;
  }, [itemsById, itemOrder]);

  const handleCreateQueue = async (nightPreset: boolean) => {
    const q = makeDefaultQueue(
      nightPreset ? "Night Queue" : "Custom Queue",
      nightPreset,
      queues.length
    );
    try {
      await ipc.upsertQueue(q);
      setSelectedId(q.id);
      setDraft(structuredClone(q));
      refreshNextRuns();
      pushToast(
        "success",
        nightPreset
          ? "Created Night Queue (01:00–07:00, Sleep on finish)"
          : "Created new queue"
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await ipc.upsertQueue(draft);
      refreshNextRuns();
      pushToast("success", `Saved schedule for ${draft.name}`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (q: Queue) => {
    if (q.builtin) return;
    try {
      await ipc.deleteQueue(q.id);
      setSelectedId("main");
      refreshNextRuns();
      pushToast("info", `Deleted queue ${q.name}`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const toggleRun = async (q: Queue) => {
    try {
      if (q.running) await ipc.stopQueue(q.id);
      else await ipc.startQueue(q.id);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const toggleDay = (day: number) => {
    if (!draft) return;
    const cur = draft.schedule.days;
    const next = cur.includes(day)
      ? cur.filter((d) => d !== day)
      : [...cur, day].sort((a, b) => a - b);
    setDraft({
      ...draft,
      schedule: { ...draft.schedule, days: next },
    });
  };

  const setPostActionType = (type: PostAction["type"]) => {
    if (!draft) return;
    const onComplete: PostAction =
      type === "command"
        ? {
            type: "command",
            value:
              draft.schedule.onComplete.type === "command"
                ? draft.schedule.onComplete.value
                : "",
          }
        : { type };
    setDraft({
      ...draft,
      schedule: { ...draft.schedule, onComplete },
    });
  };

  return (
    <main className="flex-1 min-w-0 bg-surface rounded-xl border border-outline/80 overflow-hidden mb-2 mr-2 flex flex-col min-h-0">
      {/* Header */}
      <header className="px-6 py-4 bg-surface-container border-b border-outline flex items-center justify-between gap-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-primary-badge border border-primary/40 flex items-center justify-center shrink-0">
            <CalendarClock
              size={18}
              className="text-on-primary-badge"
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-col">
            <h1 className="font-title text-title-lg text-on-surface">
              Queues &amp; Scheduler
            </h1>
            <span className="font-body text-body-sm text-on-surface-variant">
              Schedule overnight downloads, bandwidth limits, and automatic post-completion power actions
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCreateQueue(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-primary-tint border border-primary/40 font-label text-label-md text-on-primary-badge hover:bg-primary/20"
          >
            <Moon size={13} aria-hidden="true" />
            <span>+ Night Queue</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCreateQueue(false)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40"
          >
            <Plus size={13} aria-hidden="true" />
            <span>New Queue</span>
          </button>
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

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Queue List Column */}
        <div className="w-64 shrink-0 border-r border-outline bg-surface-container/40 p-3 flex flex-col gap-2 overflow-y-auto">
          <span className="px-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
            Queues ({queues.length})
          </span>
          {queues.map((q) => {
            const active = selectedQueue?.id === q.id;
            const count = queueCounts[q.id] ?? 0;
            const nextRun = nextRuns[q.id];
            return (
              <div
                key={q.id}
                onClick={() => setSelectedId(q.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedId(q.id);
                }}
                className={`p-3 rounded-md border cursor-pointer flex flex-col gap-1.5 transition-colors duration-state-change ${
                  active
                    ? "bg-primary-tint border-primary text-on-surface"
                    : "bg-surface border-outline hover:bg-surface-container-high text-on-surface-variant"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        q.running ? "bg-status-connected" : "bg-on-surface-variant/40"
                      }`}
                    />
                    <span className="font-label text-label-md text-on-surface truncate">
                      {q.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleRun(q);
                    }}
                    title={q.running ? "Stop queue" : "Start queue"}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-sm bg-surface-container border border-outline text-on-surface hover:border-primary/50 shrink-0"
                  >
                    {q.running ? <Square size={10} /> : <Play size={10} />}
                  </button>
                </div>
                <div className="flex items-center justify-between font-mono text-mono-sm tabular text-on-surface-variant">
                  <span>{count} items · {q.maxConcurrent}x</span>
                  <span>
                    {q.schedule.enabled ? `${q.schedule.startTime ?? "On"}` : "Manual"}
                  </span>
                </div>
                {nextRun && (
                  <span className="font-mono text-[11px] text-status-connected truncate">
                    Next: {nextRun}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Queue Editor */}
        {draft ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 max-w-3xl">
              {/* General Queue Settings */}
              <div className="rounded-md bg-surface-container border border-outline p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-title text-title-md text-on-surface">
                    Queue Configuration
                  </h2>
                  {!draft.builtin && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(draft)}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-primary-badge hover:border-primary/50"
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      <span>Delete Queue</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-12 gap-4">
                  <label className="col-span-6 flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      Queue Name
                    </span>
                    <input
                      type="text"
                      value={draft.name}
                      disabled={draft.builtin}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface disabled:opacity-60 focus:outline-none focus:border-primary"
                    />
                  </label>
                  <label className="col-span-3 flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      Max Concurrent
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={draft.maxConcurrent}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          maxConcurrent: Math.max(1, Math.min(16, Number(e.target.value) || 1)),
                        })
                      }
                      className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
                    />
                  </label>
                  <label className="col-span-3 flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      Speed Cap (MB/s, 0=Max)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={
                        draft.speedLimit > 0
                          ? Number((draft.speedLimit / (1024 * 1024)).toFixed(2))
                          : 0
                      }
                      onChange={(e) => {
                        const mb = Math.max(0, Number(e.target.value) || 0);
                        setDraft({
                          ...draft,
                          speedLimit: Math.round(mb * 1024 * 1024),
                        });
                      }}
                      className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
                    />
                  </label>
                </div>
                {draft.speedLimit > 0 && (
                  <span className="font-mono text-mono-sm text-on-surface-variant">
                    Effective queue cap: {formatSpeed(draft.speedLimit)}
                  </span>
                )}
              </div>

              {/* Schedule Window */}
              <div className="rounded-md bg-surface-container border border-outline p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-title text-title-md text-on-surface">
                    Automatic Schedule
                  </h2>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.schedule.enabled}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          schedule: { ...draft.schedule, enabled: e.target.checked },
                        })
                      }
                      className="accent-[#E11D2E]"
                    />
                    <span className="font-label text-label-md text-on-surface">
                      Enable Schedule
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-12 gap-4">
                  <label className="col-span-4 flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      Start Time (24h)
                    </span>
                    <input
                      type="time"
                      value={draft.schedule.startTime ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          schedule: {
                            ...draft.schedule,
                            startTime: e.target.value || null,
                          },
                        })
                      }
                      className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                    />
                  </label>
                  <label className="col-span-4 flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      Stop Time (Optional)
                    </span>
                    <input
                      type="time"
                      value={draft.schedule.stopTime ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          schedule: {
                            ...draft.schedule,
                            stopTime: e.target.value || null,
                          },
                        })
                      }
                      className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                    />
                  </label>
                  <label className="col-span-4 flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      One-Time Date (Optional)
                    </span>
                    <input
                      type="date"
                      value={draft.schedule.onceDate ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          schedule: {
                            ...draft.schedule,
                            onceDate: e.target.value || null,
                          },
                        })
                      }
                      className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                    />
                  </label>
                </div>

                {/* Days of Week */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-label text-label-sm text-on-surface-variant">
                    Days of Week (leave all unchecked for every day)
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {WEEKDAYS.map((d) => {
                      const active = draft.schedule.days.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleDay(d.id)}
                          className={`h-7 px-2.5 rounded-sm border font-mono text-mono-sm transition-colors duration-state-change ${
                            active
                              ? "bg-primary-tint border-primary text-on-primary-badge"
                              : "bg-surface border-outline text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-5 flex-wrap pt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.schedule.retryFailed}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          schedule: { ...draft.schedule, retryFailed: e.target.checked },
                        })
                      }
                      className="accent-[#E11D2E]"
                    />
                    <span className="font-body text-body-sm text-on-surface-variant">
                      Retry failed items when queue starts
                    </span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.schedule.wake}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          schedule: { ...draft.schedule, wake: e.target.checked },
                        })
                      }
                      className="accent-[#E11D2E]"
                    />
                    <span className="font-body text-body-sm text-on-surface-variant">
                      Wake PC from sleep at start time
                    </span>
                  </label>
                </div>
              </div>

              {/* Post-Download Automation */}
              <div className="rounded-md bg-surface-container border border-outline p-4 flex flex-col gap-3">
                <h2 className="font-title text-title-md text-on-surface">
                  When Queue Finishes
                </h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <select
                    aria-label="Action when queue completes"
                    value={draft.schedule.onComplete.type}
                    onChange={(e) =>
                      setPostActionType(e.target.value as PostAction["type"])
                    }
                    className="h-8 px-3 rounded bg-surface border border-outline font-label text-label-md text-on-surface focus:outline-none focus:border-primary"
                  >
                    <option value="none">Do Nothing</option>
                    <option value="sound">Play Completion Sound</option>
                    <option value="lock">Lock Screen</option>
                    <option value="sleep">Sleep PC</option>
                    <option value="hibernate">Hibernate PC</option>
                    <option value="shutdown">Shut Down PC</option>
                    <option value="exit">Exit HDM</option>
                    <option value="command">Run Custom Command</option>
                  </select>

                  {draft.schedule.onComplete.type === "command" && (
                    <input
                      type="text"
                      value={draft.schedule.onComplete.value}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          schedule: {
                            ...draft.schedule,
                            onComplete: { type: "command", value: e.target.value },
                          },
                        })
                      }
                      placeholder="powershell -File notify.ps1"
                      className="flex-1 min-w-[220px] h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                    />
                  )}
                </div>
                <span className="font-body text-body-sm text-on-surface-variant">
                  Power actions (Sleep, Hibernate, Shutdown) show a countdown banner with a Cancel button before executing.
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-outline bg-surface-container flex items-center justify-between gap-3 shrink-0">
              <span className="font-mono text-mono-sm text-on-surface-variant">
                {nextRuns[draft.id]
                  ? `Next scheduled run: ${nextRuns[draft.id]}`
                  : "Assign downloads to this queue via Right-Click → Assign to Queue or New Download."}
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-50"
              >
                <Save size={14} aria-hidden="true" />
                <span>{saving ? "Saving…" : "Save Queue Schedule"}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-on-surface-variant font-body text-body-sm">
            Select or create a queue to configure its schedule.
          </div>
        )}
      </div>
    </main>
  );
}
