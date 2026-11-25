import { create } from "zustand";
import type {
  CaptureInfo,
  Category,
  CoreEvent,
  DownloadItem,
  Progress,
  Queue,
  Settings,
  ToolsProgress,
} from "../lib/types";
import { computeAverageSpeedBps } from "../lib/format";
import { ipc } from "../lib/ipc";

const SPARKLINE_POINTS = 60;
const MAX_FALLBACK_SAMPLES = 30;

interface SessionSpeedTracker {
  startedAtMs: number;
  startBytes: number;
  prevDownloaded: number;
  speedSamples: number[];
}

const sessionSpeedTrackers = new Map<string, SessionSpeedTracker>();

interface DownloadsState {
  ready: boolean;
  version: string;
  dataDir: string;
  itemsById: Record<string, DownloadItem>;
  itemOrder: string[];
  progressById: Record<string, Progress>;
  avgSpeedById: Record<string, number>;
  capturesById: Record<string, CaptureInfo>;
  categories: Category[];
  queues: Queue[];
  settings: Settings | null;
  globalSpeedHistory: number[];
  currentDownloadSpeed: number;
  toolsProgress: ToolsProgress | null;
  init: () => Promise<void>;
  applyCoreEvent: (event: CoreEvent) => void;
  removeCapture: (id: string) => void;
  clearToolsProgress: () => void;
}

export const useDownloadsStore = create<DownloadsState>((set) => ({
  ready: false,
  version: "0.1.0",
  dataDir: "",
  itemsById: {},
  itemOrder: [],
  progressById: {},
  avgSpeedById: {},
  capturesById: {},
  categories: [],
  queues: [],
  settings: null,
  globalSpeedHistory: Array(SPARKLINE_POINTS).fill(0),
  currentDownloadSpeed: 0,
  toolsProgress: null,

  init: async () => {
    const boot = await ipc.bootstrap();
    const itemsById: Record<string, DownloadItem> = {};
    const itemOrder: string[] = [];
    for (const item of boot.items) {
      itemsById[item.id] = item;
      itemOrder.push(item.id);
    }
    const capturesById: Record<string, CaptureInfo> = {};
    for (const cap of boot.captures ?? []) {
      capturesById[cap.id] = cap;
    }
    set({
      ready: true,
      version: boot.version,
      dataDir: boot.dataDir,
      itemsById,
      itemOrder,
      capturesById,
      categories: boot.categories,
      queues: boot.queues,
      settings: boot.settings,
    });
  },

  removeCapture: (id) =>
    set((state) => {
      if (!(id in state.capturesById)) return state;
      const capturesById = { ...state.capturesById };
      delete capturesById[id];
      return { capturesById };
    }),

  clearToolsProgress: () => set({ toolsProgress: null }),

  applyCoreEvent: (event) => {
    switch (event.type) {
      case "itemsAdded": {
        set((state) => {
          const itemsById = { ...state.itemsById };
          const itemOrder = [...state.itemOrder];
          for (const item of event.payload) {
            if (!itemsById[item.id]) itemOrder.push(item.id);
            itemsById[item.id] = item;
          }
          return { itemsById, itemOrder };
        });
        break;
      }
      case "itemUpdated": {
        const item = event.payload;
        set((state) => {
          const itemsById = { ...state.itemsById, [item.id]: item };
          const itemOrder = state.itemOrder.includes(item.id)
            ? state.itemOrder
            : [...state.itemOrder, item.id];
          const progressById = { ...state.progressById };
          const avgSpeedById = { ...state.avgSpeedById };
          if (
            item.status !== "downloading" &&
            item.status !== "connecting" &&
            item.status !== "retrying" &&
            item.status !== "processing"
          ) {
            delete progressById[item.id];
            delete avgSpeedById[item.id];
            sessionSpeedTrackers.delete(item.id);
          }
          const remainingSpeed = Object.values(progressById).reduce(
            (sum, p) => sum + p.speed,
            0
          );
          const globalSpeedHistory =
            remainingSpeed === 0 && state.currentDownloadSpeed > 0
              ? [...state.globalSpeedHistory.slice(1), 0]
              : state.globalSpeedHistory;
          return {
            itemsById,
            itemOrder,
            progressById,
            avgSpeedById,
            globalSpeedHistory,
            currentDownloadSpeed: remainingSpeed,
          };
        });
        break;
      }
      case "itemsRemoved": {
        const removed = new Set(event.payload);
        set((state) => {
          const itemsById = { ...state.itemsById };
          const progressById = { ...state.progressById };
          const avgSpeedById = { ...state.avgSpeedById };
          for (const id of removed) {
            delete itemsById[id];
            delete progressById[id];
            delete avgSpeedById[id];
            sessionSpeedTrackers.delete(id);
          }
          const remainingSpeed = Object.values(progressById).reduce(
            (sum, p) => sum + p.speed,
            0
          );
          const globalSpeedHistory =
            remainingSpeed === 0 && state.currentDownloadSpeed > 0
              ? [...state.globalSpeedHistory.slice(1), 0]
              : state.globalSpeedHistory;
          return {
            itemsById,
            progressById,
            avgSpeedById,
            itemOrder: state.itemOrder.filter((id) => !removed.has(id)),
            globalSpeedHistory,
            currentDownloadSpeed: remainingSpeed,
          };
        });
        break;
      }
      case "progress": {
        const now = Date.now();
        set((state) => {
          const progressById = { ...state.progressById };
          const avgSpeedById = { ...state.avgSpeedById };
          const itemsById = { ...state.itemsById };
          let totalSpeed = 0;
          for (const p of event.payload) {
            progressById[p.id] = p;
            totalSpeed += p.speed;

            let tracker = sessionSpeedTrackers.get(p.id);
            const tickDelta = tracker ? p.downloaded - tracker.prevDownloaded : 0;
            const isRecheckJump = Boolean(
              tracker && tickDelta > Math.max(25 * 1024 * 1024, p.speed * 8)
            );
            const stillIdle = Boolean(
              tracker && tracker.speedSamples.length === 0 && p.speed === 0
            );
            if (
              !tracker ||
              p.downloaded < tracker.startBytes ||
              isRecheckJump ||
              stillIdle
            ) {
              tracker = {
                startedAtMs: now,
                startBytes: p.downloaded,
                prevDownloaded: p.downloaded,
                speedSamples: p.speed > 0 ? [p.speed] : [],
              };
              sessionSpeedTrackers.set(p.id, tracker);
            } else {
              tracker.prevDownloaded = p.downloaded;
              if (
                p.speed > 0 &&
                tracker.speedSamples.length < MAX_FALLBACK_SAMPLES
              ) {
                tracker.speedSamples.push(p.speed);
              }
            }
            avgSpeedById[p.id] = computeAverageSpeedBps(
              tracker.startBytes,
              p.downloaded,
              now - tracker.startedAtMs,
              tracker.speedSamples
            );

            const existing = itemsById[p.id];
            if (existing) {
              itemsById[p.id] = {
                ...existing,
                downloaded: p.downloaded,
                size: p.size ?? existing.size,
                status: p.status,
              };
            }
          }
          const globalSpeedHistory = [
            ...state.globalSpeedHistory.slice(1),
            totalSpeed,
          ];
          return {
            progressById,
            avgSpeedById,
            itemsById,
            globalSpeedHistory,
            currentDownloadSpeed: totalSpeed,
          };
        });
        break;
      }
      case "completed":
      case "failed": {
        const item = event.payload;
        set((state) => {
          const progressById = { ...state.progressById };
          const avgSpeedById = { ...state.avgSpeedById };
          delete progressById[item.id];
          delete avgSpeedById[item.id];
          sessionSpeedTrackers.delete(item.id);
          const remainingSpeed = Object.values(progressById).reduce(
            (sum, p) => sum + p.speed,
            0
          );
          return {
            itemsById: { ...state.itemsById, [item.id]: item },
            progressById,
            avgSpeedById,
            currentDownloadSpeed: remainingSpeed,
          };
        });
        break;
      }
      case "queuesChanged":
        set({ queues: event.payload });
        break;
      case "categoriesChanged":
        set({ categories: event.payload });
        break;
      case "settingsChanged":
        set({ settings: event.payload });
        break;
      case "captureRequested":
      case "captureUpdated": {
        const cap = event.payload;
        set((state) => ({
          capturesById: { ...state.capturesById, [cap.id]: cap },
        }));
        break;
      }
      case "toolsProgress":
        set({ toolsProgress: event.payload });
        break;
      default:
        break;
    }
  },
}));
