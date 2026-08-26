// Hardware boundary, same shape as voice-tracker.ts and hand-tracker.ts:
// owns the browser device-enumeration API, nothing else.
import { useEffect, useState } from "react";

// The renderer enumerates its own devices — main never sees one. The list holds
// only what is plugged in right now, the way the Windows sound picker behaves,
// so an unplugged saved id renders as Default instead of erroring.
export function useMicDevices(): MediaDeviceInfo[] {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const refresh = () =>
      void md
        .enumerateDevices()
        .then((ds) => setMics(ds.filter((d) => d.kind === "audioinput")))
        .catch(() => setMics([]));
    refresh();
    md.addEventListener("devicechange", refresh);
    return () => md.removeEventListener("devicechange", refresh);
  }, []);
  return mics;
}
