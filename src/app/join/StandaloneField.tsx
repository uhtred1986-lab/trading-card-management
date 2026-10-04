"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/** Tells `/api/join` whether the page runs as the installed app, for the device's label ("iPhone · App"). */
export function StandaloneField() {
  const standalone = useSyncExternalStore(
    noSubscription,
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => false,
  );
  return <input type="hidden" name="standalone" value={standalone ? "1" : "0"} />;
}
