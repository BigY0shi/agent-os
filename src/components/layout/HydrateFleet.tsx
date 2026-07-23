"use client";

import { useEffect } from "react";
import { useFleet } from "@/lib/store";

/**
 * Mounted once at the root layout. Fetches /api/config and populates the
 * Zustand fleet store with the user's configured agents (local + remote).
 */
export function HydrateFleet() {
  const hydrate = useFleet((s) => s.hydrateFromConfig);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}
