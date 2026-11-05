"use client";

import { useEffect } from "react";

// Keeps `--app-height` in sync with the *visual* viewport (visualViewport),
// not the layout viewport. On mobile the soft keyboard shrinks the visual
// viewport but leaves the layout viewport (and `height: 100%`) unchanged —
// so without this the bottom of the app (terminal bar, quick-key row) and the
// terminal's cursor line end up hidden behind the keyboard. Pinning #app to
// visualViewport.height shrinks the whole app when the keyboard opens, keeping
// the input line and quick keys visible above it. Desktop is a no-op: the
// visual viewport already equals the window.
export default function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
  return null;
}
