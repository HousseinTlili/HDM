import { create } from "zustand";
import type {
  AppView,
  HdmIntent,
  PostAction,
  SecurityScanReport,
  SettingsSection,
  Sha256Verification,
  SidebarFilter,
  SortKey,
  ToastMessage,
} from "../lib/types";

interface ContextMenuState {
  id: string;
  x: number;
  y: number;
}

interface DeleteConfirmState {
  ids: string[];
  defaultDeleteFiles: boolean;
}

interface UiState {
  activeView: AppView;
  activeFilter: SidebarFilter;
  modelHubTab: "ollama" | "huggingface" | "local";
  settingsSection: SettingsSection;
  postActionPending: { action: PostAction; seconds: number } | null;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  selectedId: string | null;
  quickPasteUrl: string;
  pendingIntent: HdmIntent | null;
  searchQuery: string;
  sortBy: SortKey;
  contextMenu: ContextMenuState | null;
  deleteConfirm: DeleteConfirmState | null;
  verifiedById: Record<string, Sha256Verification>;
  verifyingIds: Record<string, boolean>;
  securityById: Record<string, SecurityScanReport>;
  scanningIds: Record<string, boolean>;
  dismissedSecurityIds: Record<string, boolean>;
  toasts: ToastMessage[];
  setActiveView: (view: AppView) => void;
  setActiveFilter: (filter: SidebarFilter) => void;
  setModelHubTab: (tab: "ollama" | "huggingface" | "local") => void;
  setSettingsSection: (section: SettingsSection) => void;
  setPostActionPending: (pending: { action: PostAction; seconds: number } | null) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  setInspectorOpen: (open: boolean) => void;
  setSelectedId: (id: string | null) => void;
  setQuickPasteUrl: (url: string) => void;
  setPendingIntent: (intent: HdmIntent | null) => void;
  setSearchQuery: (q: string) => void;
  setSortBy: (sort: SortKey) => void;
  openContextMenu: (id: string, x: number, y: number) => void;
  closeContextMenu: () => void;
  openDeleteConfirm: (ids: string[], defaultDeleteFiles: boolean) => void;
  closeDeleteConfirm: () => void;
  setVerification: (id: string, v: Sha256Verification) => void;
  setVerifying: (id: string, busy: boolean) => void;
  setSecurityReport: (id: string, report: SecurityScanReport) => void;
  setScanning: (id: string, busy: boolean) => void;
  dismissSecurityWarning: (id: string) => void;
  pushToast: (kind: ToastMessage["kind"], text: string) => void;
  dismissToast: (id: string) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  activeView: "downloads",
  activeFilter: "all",
  modelHubTab: "ollama",
  settingsSection: "engine",
  postActionPending: null,
  sidebarCollapsed: false,
  inspectorOpen: true,
  selectedId: null,
  quickPasteUrl: "",
  pendingIntent: null,
  searchQuery: "",
  sortBy: "speed",
  contextMenu: null,
  deleteConfirm: null,
  verifiedById: {},
  verifyingIds: {},
  securityById: {},
  scanningIds: {},
  dismissedSecurityIds: {},
  toasts: [],

  setActiveView: (activeView) => set({ activeView, contextMenu: null }),
  setActiveFilter: (activeFilter) =>
    set({ activeFilter, activeView: "downloads", contextMenu: null }),
  setModelHubTab: (modelHubTab) => set({ modelHubTab }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setPostActionPending: (postActionPending) => set({ postActionPending }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setQuickPasteUrl: (quickPasteUrl) => set({ quickPasteUrl }),
  setPendingIntent: (pendingIntent) => set({ pendingIntent }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSortBy: (sortBy) => set({ sortBy }),
  openContextMenu: (id, x, y) => set({ contextMenu: { id, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),
  openDeleteConfirm: (ids, defaultDeleteFiles) =>
    set({ deleteConfirm: { ids, defaultDeleteFiles }, contextMenu: null }),
  closeDeleteConfirm: () => set({ deleteConfirm: null }),
  setVerification: (id, v) =>
    set((s) => ({ verifiedById: { ...s.verifiedById, [id]: v } })),
  setVerifying: (id, busy) =>
    set((s) => {
      const next = { ...s.verifyingIds };
      if (busy) next[id] = true;
      else delete next[id];
      return { verifyingIds: next };
    }),
  setSecurityReport: (id, report) =>
    set((s) => {
      const dismissed = { ...s.dismissedSecurityIds };
      delete dismissed[id];
      return {
        securityById: { ...s.securityById, [id]: report },
        dismissedSecurityIds: dismissed,
      };
    }),
  setScanning: (id, busy) =>
    set((s) => {
      const next = { ...s.scanningIds };
      if (busy) next[id] = true;
      else delete next[id];
      return { scanningIds: next };
    }),
  dismissSecurityWarning: (id) =>
    set((s) => ({
      dismissedSecurityIds: { ...s.dismissedSecurityIds, [id]: true },
    })),
  pushToast: (kind, text) => {
    const id = `toast-${++toastSeq}`;
    set((s) => ({
      toasts: [...s.toasts.slice(-2), { id, kind, text }],
    }));
    setTimeout(() => {
      useUiStore.getState().dismissToast(id);
    }, 3500);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
