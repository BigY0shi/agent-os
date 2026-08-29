"use client";

import { useEffect } from "react";

/**
 * SPEC-C C5 — client-side page-context registry. Pages register a lightweight
 * descriptor of what the user currently sees; the Jarvis overlay reads it at
 * SEND time and ships it per-request as `pageContext` (rendered server-side as
 * an <active_page> prompt block, NEVER persisted — upstream screenContext
 * privacy/staleness rule).
 *
 * Two layers:
 *   · baseline — JarvisOmnipresence auto-fills {route, title} on every
 *     navigation, so EVERY page has at least that much context;
 *   · custom — a page that knows more registers a richer descriptor via
 *     setPageContext / the one-line useJarvisPageContext hook. A custom
 *     descriptor wins only while its route matches the current baseline route
 *     (stale descriptors from a previous page never leak).
 */

export interface PageContextDescriptor {
  route: string;
  title?: string;
  summary?: string;
  selection?: string;
}

interface Store {
  baseline: PageContextDescriptor | null;
  custom: PageContextDescriptor | null;
}

// Module-level store (client bundle singleton — the overlay + pages share it).
const store: Store = { baseline: null, custom: null };

/** Baseline auto-fill — called by JarvisOmnipresence on navigation. */
export function setBaselinePageContext(desc: PageContextDescriptor | null): void {
  store.baseline = desc;
  // A route change invalidates any custom descriptor left by the previous page.
  if (store.custom && desc && store.custom.route !== desc.route) store.custom = null;
}

/** Rich per-page registration (C3.7 pilot pages). */
export function setPageContext(desc: PageContextDescriptor | null): void {
  store.custom = desc;
}

export function clearPageContext(): void {
  store.custom = null;
}

/** What the overlay ships with an ask — custom (when fresh) over baseline. */
export function getEffectivePageContext(): PageContextDescriptor | null {
  const { baseline, custom } = store;
  if (custom && (!baseline || custom.route === baseline.route)) return custom;
  return baseline;
}

/**
 * One-line page wiring: `useJarvisPageContext({ route: "/tasks", title: "Tasks",
 * summary })` — registers on render, refreshes when the summary changes,
 * clears on unmount.
 */
export function useJarvisPageContext(desc: PageContextDescriptor | null): void {
  const key = desc ? `${desc.route}|${desc.title ?? ""}|${desc.summary ?? ""}|${desc.selection ?? ""}` : "";
  useEffect(() => {
    setPageContext(desc);
    return () => clearPageContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
