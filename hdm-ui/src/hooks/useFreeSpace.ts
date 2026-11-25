import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";

/** Fetch available free bytes for a target directory path. */
export function useFreeSpace(path: string | null | undefined): number | null {
  const [freeBytes, setFreeBytes] = useState<number | null>(null);

  useEffect(() => {
    const trimmed = path?.trim();
    if (!trimmed) {
      setFreeBytes(null);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(() => {
      void ipc
        .freeSpace(trimmed)
        .then((bytes) => {
          if (alive) setFreeBytes(bytes);
        })
        .catch(() => {
          if (alive) setFreeBytes(null);
        });
    }, 120);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [path]);

  return freeBytes;
}
