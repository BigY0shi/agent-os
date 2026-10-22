// S27 Health: a short in-memory history of the machine, sampled every 5 s ONLY while
// someone is watching (it starts on the first read and stops two minutes after the
// last one), so an idle dashboard costs nothing. Up to 120 samples (10 minutes).
//
// Each series gets a SHAPE word computed from its samples, never chosen for effect:
//   flat    the whole range is under 2 points (or under 1% of the peak for network)
//   spiky   mostly calm, with a few samples far above the rest
//   bursty  it jumps around often
//   steady  it moves, but smoothly
// Network is bytes per second from the OS counters (Windows: `netstat -e`; Linux:
// /proc/net/dev); where no counter is readable the series is null, shown as unknown.

import os from "node:os";
import { readFileSync, statfsSync, existsSync } from "node:fs";
import path from "node:path";

export interface HostSample { at: number; cpu: number; mem: number; disk: number | null; netBps: number | null }
export type Shape = "flat" | "spiky" | "bursty" | "steady" | "unknown";

const MAX = 120;
const INTERVAL = 5000;
const IDLE_STOP = 120_000;

interface SamplerState { samples: HostSample[]; timer: ReturnType<typeof setInterval> | null; lastRead: number; prevCpu: { idle: number; total: number } | null; prevNet: { at: number; bytes: number } | null }
const g = globalThis as unknown as { __agentosHostSampler?: SamplerState };
const state = (): SamplerState => (g.__agentosHostSampler ??= { samples: [], timer: null, lastRead: 0, prevCpu: null, prevNet: null });

function cpuTotals() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { idle += c.times.idle; total += Object.values(c.times).reduce((a, b) => a + b, 0); }
  return { idle, total };
}

function diskUsedPct(): number | null {
  try {
    const root = path.parse(path.resolve(os.homedir())).root;
    const s = statfsSync(root);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return total ? Math.round(((total - free) / total) * 1000) / 10 : null;
  } catch { return null; }
}

/** Total bytes moved (in + out) since boot, or null when no counter is readable. */
export async function netBytes(): Promise<number | null> {
  try {
    if (process.platform === "win32") {
      const { execFile } = await import("node:child_process");
      const out = await new Promise<string>((res, rej) => execFile("netstat", ["-e"], { timeout: 4000, windowsHide: true }, (e, so) => (e ? rej(e) : res(String(so)))));
      return parseNetstatE(out);
    }
    if (existsSync("/proc/net/dev")) {
      let sum = 0;
      for (const line of readFileSync("/proc/net/dev", "utf8").split("\n").slice(2)) {
        const [name, rest] = line.split(":"); if (!rest || name.trim() === "lo") continue;
        const f = rest.trim().split(/\s+/).map(Number); sum += (f[0] || 0) + (f[8] || 0);
      }
      return sum;
    }
  } catch { /* unreadable */ }
  return null;
}
/** `netstat -e` prints a "Bytes  <received>  <sent>" row (localised label on some systems). */
export function parseNetstatE(out: string): number | null {
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*Bytes\s+(\d+)\s+(\d+)\s*$/i.exec(line);
    if (m) return Number(m[1]) + Number(m[2]);
  }
  return null;
}

export async function takeSample(): Promise<HostSample> {
  const s = state();
  const now = Date.now();
  const c = cpuTotals();
  let cpu = 0;
  if (s.prevCpu) { const dt = c.total - s.prevCpu.total, di = c.idle - s.prevCpu.idle; cpu = dt > 0 ? Math.round((1 - di / dt) * 1000) / 10 : 0; }
  s.prevCpu = c;
  const mem = Math.round((1 - os.freemem() / os.totalmem()) * 1000) / 10;
  const bytes = await netBytes();
  let netBps: number | null = null;
  if (bytes != null && s.prevNet && now > s.prevNet.at && bytes >= s.prevNet.bytes) netBps = Math.round(((bytes - s.prevNet.bytes) / (now - s.prevNet.at)) * 1000);
  if (bytes != null) s.prevNet = { at: now, bytes };
  const sample: HostSample = { at: now, cpu, mem, disk: diskUsedPct(), netBps };
  s.samples.push(sample);
  if (s.samples.length > MAX) s.samples.splice(0, s.samples.length - MAX);
  return sample;
}

/** Read the history; starts the sampler if needed and keeps it alive while read. */
export async function readHistory(): Promise<{ samples: HostSample[]; intervalMs: number; shapes: Record<"cpu" | "mem" | "disk" | "net", Shape> }> {
  const s = state();
  s.lastRead = Date.now();
  if (!s.timer) {
    await takeSample(); // primes the CPU and network deltas
    s.timer = setInterval(() => {
      if (Date.now() - s.lastRead > IDLE_STOP) { clearInterval(s.timer!); s.timer = null; return; }
      void takeSample();
    }, INTERVAL);
    (s.timer as { unref?: () => void }).unref?.();
  }
  const samples = s.samples.slice(1); // the first sample has no CPU / network delta yet
  const pick = (k: keyof HostSample) => samples.map((x) => x[k] as number | null).filter((v): v is number => v != null);
  return {
    samples,
    intervalMs: INTERVAL,
    shapes: { cpu: shapeOf(pick("cpu")), mem: shapeOf(pick("mem")), disk: shapeOf(pick("disk")), net: shapeOf(pick("netBps"), true) },
  };
}

export function shapeOf(xs: number[], relative = false): Shape {
  if (xs.length < 4) return "unknown";
  const max = Math.max(...xs), min = Math.min(...xs);
  const range = max - min;
  if (relative ? range <= Math.max(1, max * 0.01) : range < 2) return "flat";
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
  const outliers = xs.filter((v) => v - median > 2.5 * sd).length;
  const deltas = xs.slice(1).map((v, i) => Math.abs(v - xs[i]));
  const bigJumps = deltas.filter((d) => d > range * 0.3).length;
  if (outliers > 0 && outliers <= Math.max(1, Math.floor(xs.length * 0.15))) return "spiky";
  if (bigJumps / deltas.length > 0.3) return "bursty";
  return "steady";
}

export function __resetSamplerForTests(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  g.__agentosHostSampler = { samples: [], timer: null, lastRead: 0, prevCpu: null, prevNet: null };
}
