import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import type { ItemDetails } from "../lib/types";

/** Poll `ipc.itemDetails(id)` while `enabled` and an item id is selected. */
export function useItemDetails(
  id: string | null | undefined,
  intervalMs = 500,
  enabled = true
): ItemDetails | null {
  const [details, setDetails] = useState<ItemDetails | null>(null);

  useEffect(() => {
    setDetails(null);
    if (!id || !enabled) return;

    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const snapshot = await ipc.itemDetails(id);
        if (alive) setDetails(snapshot);
      } catch {
        // Transient error: keep the previous snapshot
      }
      if (!alive) return;
      const delay =
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? intervalMs * 4
          : intervalMs;
      timer = window.setTimeout(() => void tick(), delay);
    };

    void tick();

    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, intervalMs, enabled]);

  return details;
}
