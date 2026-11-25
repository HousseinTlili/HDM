import { inTauri } from "./window";

export interface FileDialogFilter {
  name: string;
  extensions: string[];
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: true,
    multiple: false,
    defaultPath: defaultPath || undefined,
  });
  return typeof picked === "string" ? picked : null;
}

export async function pickFile(
  filters?: FileDialogFilter[],
  defaultPath?: string
): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: false,
    multiple: false,
    filters,
    defaultPath: defaultPath || undefined,
  });
  return typeof picked === "string" ? picked : null;
}
