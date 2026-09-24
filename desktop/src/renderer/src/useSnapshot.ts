import { useEffect, useState } from "react";
import type { Snapshot } from "../../shared/api";

export function useSnapshot(): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    window.taskApp.getSnapshot().then(setSnap);
    return window.taskApp.onSnapshot(setSnap);
  }, []);
  return snap;
}
