"use client";

// S13 Sessions: one way to resume a Jarvis conversation from anywhere.
//   Console  -> navigate to /jarvis?c=<id>; JarvisView loads it on mount.
//   Overlay  -> resumeInOverlay(id); JarvisOmnipresence opens the overlay on it.

export const RESUME_EVENT = "jarvis:open-conversation";

export interface ResumeDetail { id: string }

export function resumeInOverlay(id: string): void {
  window.dispatchEvent(new CustomEvent<ResumeDetail>(RESUME_EVENT, { detail: { id } }));
}

export function consoleResumeHref(id: string): string {
  return `/jarvis?c=${encodeURIComponent(id)}`;
}
