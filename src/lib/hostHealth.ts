// Host and local-service health (S15 Control Room; shared with S18 System pulse and
// S27 Health, _design/jarvis-v3-plan.md). Every number is measured on this machine at
// request time. Anything the platform cannot measure honestly is reported as
// unavailable, never as zero: Windows has no load average, so os.loadavg() returns
// [0, 0, 0] there and would read as an idle machine.

import os from "node:os";
import { statfsSync } from "node:fs";
import path from "node:path";
import { readSettings } from "@/lib/settings";

export interface CpuSample { percent: number; perCore: number[]; cores: number; model: string }
export interface DiskUsage { mount: string; totalBytes: number; freeBytes: number; usedPercent: number }
export interface HostSnapshot {
  hostname: string;
  platform: string;
  release: string;
  uptimeSec: number;
  cpu: CpuSample;
  memory: { totalBytes: number; freeBytes: number; usedPercent: number };
  disks: DiskUsage[];
  /** null where the platform has no load average (Windows). */
  loadavg: [number, number, number] | null;
  sampledAt: string;
}

export type ServiceState = "ok" | "down" | "not-configured";
export interface ServiceHealth { id: string; name: string; url: string | null; state: ServiceState; ms: number | null; detail: string; optional?: boolean }
export interface Check { id: string; label: string; ok: boolean; detail: string }

const cpuTimes = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));

/** CPU use over a short window, from the difference of two os.cpus() samples. */
export async function sampleCpu(windowMs = 400): Promise<CpuSample> {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, windowMs));
  const b = cpuTimes();
  const perCore = b.map((t, i) => {
    const total = t.total - (a[i]?.total ?? 0);
    const idle = t.idle - (a[i]?.idle ?? 0);
    return total > 0 ? Math.round(((total - idle) / total) * 1000) / 10 : 0;
  });
  const percent = perCore.length ? Math.round((perCore.reduce((x, y) => x + y, 0) / perCore.length) * 10) / 10 : 0;
  return { percent, perCore, cores: perCore.length, model: os.cpus()[0]?.model?.trim() ?? "unknown" };
}

function diskFor(p: string): DiskUsage | null {
  try {
    const root = path.parse(path.resolve(p)).root || p;
    const s = statfsSync(root);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    if (!total) return null;
    return { mount: root, totalBytes: total, freeBytes: free, usedPercent: Math.round(((total - free) / total) * 1000) / 10 };
  } catch {
    return null;
  }
}

export async function hostSnapshot(): Promise<HostSnapshot> {
  const cpu = await sampleCpu();
  const total = os.totalmem();
  const free = os.freemem();
  const mounts = [...new Set([os.homedir(), process.cwd()].map((p) => path.parse(path.resolve(p)).root))];
  const la = os.loadavg() as [number, number, number];
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.arch()}`,
    release: os.release(),
    uptimeSec: Math.round(os.uptime()),
    cpu,
    memory: { totalBytes: total, freeBytes: free, usedPercent: Math.round(((total - free) / total) * 1000) / 10 },
    disks: mounts.map(diskFor).filter((d): d is DiskUsage => d !== null),
    loadavg: process.platform === "win32" ? null : la,
    sampledAt: new Date().toISOString(),
  };
}

async function probe(url: string, timeoutMs = 1500): Promise<{ ok: boolean; ms: number; detail: string }> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const ms = Date.now() - t0;
    return { ok: r.ok, ms, detail: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}` };
  } catch (e) {
    const msg = (e as Error)?.name === "TimeoutError" ? `no answer in ${timeoutMs} ms` : ((e as Error)?.message ?? String(e));
    return { ok: false, ms: Date.now() - t0, detail: msg.includes("fetch failed") ? "not listening" : msg };
  }
}

/** Only loopback URLs are probed; a configured remote URL is reported, not called. */
function loopback(u: string): boolean {
  try { return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(u).hostname); } catch { return false; }
}

export async function serviceHealth(): Promise<ServiceHealth[]> {
  const s = readSettings() as ReturnType<typeof readSettings> & { stt?: { parakeetUrl?: string }; voicebox?: { url?: string } };
  const lmBase = (s.memory as { openaiCompatUrl?: string } | undefined)?.openaiCompatUrl?.replace(/\/+$/, "") || "";
  const parakeet = (s.stt?.parakeetUrl || "http://127.0.0.1:8881").replace(/\/+$/, "");
  const voicebox = (s.voicebox?.url || "http://127.0.0.1:17493").replace(/\/+$/, "");
  const defs: Array<{ id: string; name: string; url: string | null; optional?: boolean }> = [
    { id: "kokoro", name: "Kokoro (reply voice)", url: "http://127.0.0.1:8880/health" },
    { id: "parakeet", name: "Parakeet (dictation)", url: `${parakeet}/health` },
    { id: "ollama", name: "Ollama (embeddings, local models)", url: "http://127.0.0.1:11434/api/version" },
    { id: "lmstudio", name: "LM Studio (Bonsai)", url: lmBase ? `${lmBase}/models` : null, optional: true },
    { id: "voicebox", name: "Voicebox (retired default, still selectable)", url: `${voicebox}/health`, optional: true },
  ];
  return Promise.all(defs.map(async (d): Promise<ServiceHealth> => {
    if (!d.url) return { ...d, state: "not-configured", ms: null, detail: "no URL set" };
    if (!loopback(d.url)) return { ...d, state: "not-configured", ms: null, detail: "not a local address; not probed" };
    const r = await probe(d.url);
    return { ...d, state: r.ok ? "ok" : "down", ms: r.ms, detail: r.detail };
  }));
}

/** Plain-words checks. Optional services never fail the board. */
export function checksFrom(host: HostSnapshot, services: ServiceHealth[]): Check[] {
  const checks: Check[] = [];
  for (const d of host.disks) {
    const freePct = 100 - d.usedPercent;
    checks.push({ id: `disk:${d.mount}`, label: `Disk space on ${d.mount}`, ok: freePct >= 10, detail: `${(d.freeBytes / 1e9).toFixed(1)} GB free (${freePct.toFixed(1)}%)` });
  }
  const memFree = 100 - host.memory.usedPercent;
  checks.push({ id: "memory", label: "Memory headroom", ok: memFree >= 10, detail: `${(host.memory.freeBytes / 1e9).toFixed(1)} GB free (${memFree.toFixed(1)}%)` });
  checks.push({ id: "cpu", label: "Processor load", ok: host.cpu.percent < 90, detail: `${host.cpu.percent}% across ${host.cpu.cores} cores (one ${400} ms sample)` });
  for (const s of services) {
    if (s.optional || s.state === "not-configured") continue;
    checks.push({ id: `svc:${s.id}`, label: s.name, ok: s.state === "ok", detail: s.state === "ok" ? `answering in ${s.ms} ms` : s.detail });
  }
  return checks;
}

export async function healthReport(): Promise<{ host: HostSnapshot; services: ServiceHealth[]; checks: Check[]; clear: number; total: number; status: "optimal" | "strain" | "needs-a-look" }> {
  const [host, services] = await Promise.all([hostSnapshot(), serviceHealth()]);
  const checks = checksFrom(host, services);
  const clear = checks.filter((c) => c.ok).length;
  const failing = checks.length - clear;
  const status = failing === 0 ? "optimal" : failing <= 1 ? "strain" : "needs-a-look";
  return { host, services, checks, clear, total: checks.length, status };
}
