"use client";

// S21 Agent City (owner, 2026-09-28): the orchestrator is the tall tower in the centre;
// every configured agent gets its own procedurally generated building. The form is
// seeded from the agent's id, so a building looks the same every visit. Buildings
// pulse by the agent's REAL status (blue working, warm idle, red error, violet waiting
// on you, dark when off). The road from the tower to a building carries moving pulses
// only while that agent is actually running; agent-to-agent hand-offs are not recorded
// anywhere yet, so none are drawn. Hover shows runs / tokens / reply time; click opens
// the chat. three.js is loaded lazily; the canvas pauses when hidden or off screen and
// holds still under prefers-reduced-motion.

import { useEffect, useRef, useState } from "react";
import type * as ThreeNS from "three";
import type { CrewAgent } from "./CrewTab";

const TINT: Record<CrewAgent["status"], string> = { running: "#3b95ff", idle: "#f2b441", waiting: "#a78bfa", error: "#ff5a6b", offline: "#3a4252" };
const WORD: Record<CrewAgent["status"], string> = { running: "working now", idle: "ready", waiting: "waiting on you", error: "error", offline: "off" };
const dur = (ms: number | null) => (ms == null ? "–" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

function hash(s: string): number { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let a = seed || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

interface Props { agents: CrewAgent[]; selected: string | null; onSelect: (id: string) => void }

export default function AgentCity({ agents, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef(agents); agentsRef.current = agents;
  const selRef = useRef(selected); selRef.current = selected;
  const selectRef = useRef(onSelect); selectRef.current = onSelect;
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const layoutKey = agents.map((a) => a.id).join("|");

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let disposed = false, raf = 0;
    const cleanup: Array<() => void> = [];
    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;
      let renderer: ThreeNS.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" }); }
      catch { setFailed(true); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x07060d, 0.035);
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
      camera.position.set(0, 9, 16);
      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true; controls.enablePan = false;
      // A plain wheel scrolls the PAGE: the city sits mid-page, and a canvas that eats the
      // wheel traps the reader. Ctrl/Cmd + wheel zooms.
      controls.enableZoom = false;
      const onWheel = (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const dir = camera.position.clone().sub(controls.target);
        const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, dir.length() * (e.deltaY > 0 ? 1.1 : 0.9)));
        camera.position.copy(controls.target).add(dir.setLength(len));
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });
      cleanup.push(() => canvas.removeEventListener("wheel", onWheel));
      controls.minDistance = 8; controls.maxDistance = 30; controls.maxPolarAngle = Math.PI * 0.46;
      controls.target.set(0, 1.5, 0);
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.35;
      cleanup.push(() => controls.dispose());

      scene.add(new THREE.AmbientLight(0x8a90b0, 0.45));
      const key = new THREE.DirectionalLight(0xb9c6ff, 0.9); key.position.set(6, 12, 8); scene.add(key);

      const disposables: Array<{ dispose: () => void }> = [];
      const track = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };

      // Ground: a dark disc with a faint grid.
      const list = agentsRef.current;
      const R = 4.2 + Math.min(list.length, 24) * 0.18;
      const ground = new THREE.Mesh(track(new THREE.CircleGeometry(R + 3, 64)), track(new THREE.MeshStandardMaterial({ color: 0x0b0a14, roughness: 0.95, metalness: 0.1 })));
      ground.rotation.x = -Math.PI / 2; scene.add(ground);
      const grid = new THREE.PolarGridHelper(R + 2.5, 24, 6, 64, 0x2a2748, 0x1a1830);
      (grid.material as ThreeNS.Material).transparent = true; (grid.material as ThreeNS.Material).opacity = 0.5;
      scene.add(grid); disposables.push(grid.geometry, grid.material as ThreeNS.Material);

      const edgeMat = (hex: string) => track(new THREE.LineBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 0.9 }));
      const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0x141225, roughness: 0.55, metalness: 0.6, transparent: true, opacity: 0.92 }));
      const glowTex = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 64;
        const g = c.getContext("2d")!; const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.3, "rgba(255,255,255,0.4)"); grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return track(new THREE.CanvasTexture(c));
      })();

      // Orchestrator tower.
      const tower = new THREE.Group();
      const tMat = edgeMat("#8b5cf6");
      [[1.3, 2.2, 0], [1.0, 1.8, 2.2], [0.7, 1.6, 4.0], [0.35, 1.2, 5.6]].forEach(([w, h, y]) => {
        const geo = track(new THREE.BoxGeometry(w, h, w));
        const m = new THREE.Mesh(geo, bodyMat); m.position.y = y + h / 2; tower.add(m);
        const e = new THREE.LineSegments(track(new THREE.EdgesGeometry(geo)), tMat); e.position.copy(m.position); tower.add(e);
      });
      const tBeacon = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTex, color: 0x8b5cf6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
      tBeacon.position.y = 7.2; tBeacon.scale.setScalar(1.6); tower.add(tBeacon);
      scene.add(tower);

      // Buildings, roads and pulses.
      interface B { id: string; group: ThreeNS.Group; edges: ThreeNS.LineBasicMaterial; beacon: ThreeNS.Sprite; beaconMat: ThreeNS.SpriteMaterial; top: number; road: ThreeNS.LineBasicMaterial; pulses: ThreeNS.Sprite[]; from: ThreeNS.Vector3; to: ThreeNS.Vector3; halo: ThreeNS.Mesh; hit: ThreeNS.Mesh }
      const buildings: B[] = [];
      const hits: ThreeNS.Mesh[] = [];
      list.forEach((a, i) => {
        const r = rng(hash(a.id));
        const ang = (i / list.length) * Math.PI * 2 + (r() - 0.5) * 0.15;
        const dist = R * (0.82 + r() * 0.2);
        const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
        const group = new THREE.Group(); group.position.set(x, 0, z); group.rotation.y = r() * Math.PI;
        const em = edgeMat(TINT[a.status]);
        let y = 0, w = 0.7 + r() * 0.5, d = 0.7 + r() * 0.5;
        const tiers = 2 + Math.floor(r() * 3);
        for (let t = 0; t < tiers; t++) {
          const h = 0.5 + r() * 1.1;
          const geo = track(new THREE.BoxGeometry(w, h, d));
          const m = new THREE.Mesh(geo, bodyMat); m.position.y = y + h / 2; group.add(m);
          const e = new THREE.LineSegments(track(new THREE.EdgesGeometry(geo)), em); e.position.copy(m.position); group.add(e);
          y += h; w *= 0.62 + r() * 0.25; d *= 0.62 + r() * 0.25;
        }
        const beaconMat = track(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(TINT[a.status]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        const beacon = new THREE.Sprite(beaconMat); beacon.position.y = y + 0.35; beacon.scale.setScalar(0.9); group.add(beacon);
        const halo = new THREE.Mesh(track(new THREE.RingGeometry(0.95, 1.1, 40)), track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })));
        halo.rotation.x = -Math.PI / 2; halo.position.y = 0.02; group.add(halo);
        const hit = new THREE.Mesh(track(new THREE.BoxGeometry(1.4, y + 0.6, 1.4)), track(new THREE.MeshBasicMaterial({ visible: false })));
        hit.position.y = (y + 0.6) / 2; hit.userData.agentId = a.id; group.add(hit); hits.push(hit);
        scene.add(group);

        const from = new THREE.Vector3(0, 0.05, 0), to = new THREE.Vector3(x, 0.05, z);
        const roadMat = track(new THREE.LineBasicMaterial({ color: new THREE.Color(TINT[a.status]), transparent: true, opacity: 0.18 }));
        const road = new THREE.Line(track(new THREE.BufferGeometry().setFromPoints([from, to])), roadMat); scene.add(road);
        const pulses = [0, 1, 2].map(() => {
          const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTex, color: 0x6fb6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
          s.scale.setScalar(0.35); s.visible = false; scene.add(s); return s;
        });
        buildings.push({ id: a.id, group, edges: em, beacon, beaconMat, top: y, road: roadMat, pulses, from, to, halo, hit });
      });

      const resize = () => {
        const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize); ro.observe(wrap); cleanup.push(() => ro.disconnect());

      // Picking.
      const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
      let downAt: { x: number; y: number } | null = null;
      const pick = (e: PointerEvent): string | null => {
        const rect = canvas.getBoundingClientRect();
        ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(ptr, camera);
        const hit = ray.intersectObjects(hits, false)[0];
        return (hit?.object.userData.agentId as string) ?? null;
      };
      const onMove = (e: PointerEvent) => {
        const id = pick(e);
        canvas.style.cursor = id ? "pointer" : "grab";
        const rect = canvas.getBoundingClientRect();
        setHover(id ? { id, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
      };
      const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
      const onUp = (e: PointerEvent) => {
        if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) { const id = pick(e); if (id) selectRef.current(id); }
        downAt = null;
      };
      const onLeave = () => setHover(null);
      canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointerleave", onLeave);
      cleanup.push(() => { canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointerleave", onLeave); });

      const tmp = new THREE.Color();
      const frame = (now: number) => {
        const t = now / 1000;
        const byId = new Map(agentsRef.current.map((a) => [a.id, a]));
        for (const b of buildings) {
          const a = byId.get(b.id);
          const status = a?.status ?? "offline";
          const target = tmp.set(TINT[status]);
          b.edges.color.lerp(target, 0.1); b.beaconMat.color.lerp(target, 0.1); b.road.color.lerp(target, 0.1);
          const speed = status === "running" ? 3.2 : status === "error" ? 5 : status === "waiting" ? 2 : 1.1;
          const amp = reduced ? 0 : status === "offline" ? 0 : status === "running" ? 0.35 : 0.15;
          const p = 0.75 + amp * Math.sin(t * speed + b.top);
          b.beacon.scale.setScalar((status === "offline" ? 0.4 : 0.9) * p);
          b.beaconMat.opacity = status === "offline" ? 0.25 : 0.9;
          b.edges.opacity = status === "offline" ? 0.35 : 0.65 + 0.3 * p;
          b.road.opacity = status === "running" ? 0.55 : 0.14;
          b.pulses.forEach((s, k) => {
            s.visible = status === "running" && !reduced;
            if (!s.visible) return;
            const u = ((t * 0.35 + k / 3) % 1);
            s.position.lerpVectors(b.from, b.to, u); s.position.y = 0.12;
          });
          const on = selRef.current === b.id;
          (b.halo.material as ThreeNS.MeshBasicMaterial).opacity = on ? 0.55 : 0;
          (b.halo.material as ThreeNS.MeshBasicMaterial).color.copy(target);
        }
        (tBeacon.material as ThreeNS.SpriteMaterial).opacity = 0.7 + (reduced ? 0 : 0.25 * Math.sin(t * 1.4));
        controls.update();
        renderer.render(scene, camera);
      };
      if (reduced) {
        controls.addEventListener("change", () => frame(performance.now()));
        frame(performance.now());
      } else {
        let onScreen = true;
        const loop = (now: number) => { raf = requestAnimationFrame(loop); frame(now); };
        const sync = () => { cancelAnimationFrame(raf); if (!document.hidden && onScreen) raf = requestAnimationFrame(loop); };
        document.addEventListener("visibilitychange", sync); cleanup.push(() => document.removeEventListener("visibilitychange", sync));
        const io = new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); sync(); }); io.observe(wrap); cleanup.push(() => io.disconnect());
        raf = requestAnimationFrame(loop);
      }
      cleanup.push(() => { cancelAnimationFrame(raf); disposables.forEach((d) => d.dispose()); renderer.dispose(); });
    })();
    return () => { disposed = true; cancelAnimationFrame(raf); cleanup.forEach((fn) => fn()); };
  }, [layoutKey]);

  const h = hover ? agents.find((a) => a.id === hover.id) : null;
  return (
    <section className="glass relative overflow-hidden" aria-label="Agent City" data-agent-city>
      <div className="glass-eyebrow absolute left-5 top-4 z-10">Agent City</div>
      <div className="absolute right-5 top-4 z-10 text-[10.5px] text-[var(--fg-dimmer)]">Drag to turn · Ctrl + scroll to zoom · click a building to talk</div>
      <div ref={wrapRef} className="relative h-[420px] w-full">
        {failed
          ? <div className="grid h-full place-items-center text-[12.5px] text-[var(--fg-dimmer)]">3D is not available in this browser. The ring and roster below have the same crew.</div>
          : <canvas ref={canvasRef} className="h-full w-full" style={{ cursor: "grab" }} role="img" aria-label={`A city of ${agents.length} agents around Jarvis's tower`} />}
        {h && hover && (
          <div className="pointer-events-none absolute z-10 w-[210px] rounded-xl px-3 py-2 text-[11.5px] glass-strong" style={{ left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 220), top: Math.max(8, hover.y - 70) }}>
            <div className="flex items-center gap-1.5 text-[13px]"><span className="h-2 w-2 rounded-full" style={{ background: TINT[h.status] }} />{h.name}</div>
            <div className="text-[var(--fg-dim)]">{WORD[h.status]}</div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-[var(--fg-dimmer)]">
              <div><div className="type-figure text-[13px] text-[var(--fg)]">{h.sessions}</div>runs</div>
              <div><div className="type-figure text-[13px] text-[var(--fg)]">{h.tokens7d >= 1000 ? `${Math.round(h.tokens7d / 1000)}k` : h.tokens7d}</div>tokens 7d</div>
              <div><div className="type-figure text-[13px] text-[var(--fg)]">{dur(h.avgReplyMs)}</div>reply</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
