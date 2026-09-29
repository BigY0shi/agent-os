"use client";

// AgentFace: the animated "face" of an agent (S11, _design/jarvis-v3-plan.md).
//
//   constellation  Jarvis. A plexus star-cloud (nodes + nearest-neighbour edges) that
//                  shifts violet (idle) -> electric blue (speaking), with signal pulses
//                  running along the edges while it thinks or works.
//   galaxy         The Oracle. A white spiral galaxy with differential rotation.
//   radar          News Radar. Concentric particle rings under a rotating sweep that
//                  lights up what it passes.
//
// The face shows the state it is GIVEN. It never invents activity: "working" only
// animates while the caller says a request is in flight (AGENTS.md "Never fabricate
// state"). `getLevel` (0..1, e.g. TTS audio level) is optional; without it, speaking
// uses a steady breath rather than a fake waveform.
//
// three.js is imported lazily (as ParticleField does); the canvas pauses when the tab
// is hidden, sizes itself from its container, and draws one static frame under
// prefers-reduced-motion.

import { useEffect, useRef, type CSSProperties } from "react";
import type * as ThreeNS from "three";

export type FaceState = "idle" | "listening" | "thinking" | "working" | "speaking" | "error";
export type FaceVariant = "constellation" | "galaxy" | "radar";

export const FACE_STATES: FaceState[] = ["idle", "listening", "thinking", "working", "speaking", "error"];

/** Per-variant colour for each state. Jarvis: violet idle -> electric blue replying. */
export const FACE_PALETTE: Record<FaceVariant, Record<FaceState, string>> = {
  constellation: {
    idle: "#8b5cf6",
    listening: "#6d63f5",
    thinking: "#5476ff",
    working: "#3b95ff",
    speaking: "#22d3ff",
    error: "#ff5a6b",
  },
  galaxy: {
    idle: "#e9ecf4",
    listening: "#e3e8ff",
    thinking: "#ddd6ff",
    working: "#d6e4ff",
    speaking: "#ffffff",
    error: "#ff8f8f",
  },
  radar: {
    idle: "#f2b441",
    listening: "#f7c257",
    thinking: "#ffcf6e",
    working: "#ffdb85",
    speaking: "#ffeab0",
    error: "#ff5a6b",
  },
};

interface Motion { spin: number; pulse: number; twinkle: number; glow: number; signals: number }
const MOTION: Record<FaceState, Motion> = {
  idle:      { spin: 0.05, pulse: 0.018, twinkle: 0.25, glow: 0.62, signals: 0 },
  listening: { spin: 0.07, pulse: 0.03,  twinkle: 0.4,  glow: 0.74, signals: 0.15 },
  thinking:  { spin: 0.15, pulse: 0.025, twinkle: 0.9,  glow: 0.84, signals: 0.7 },
  working:   { spin: 0.26, pulse: 0.04,  twinkle: 0.6,  glow: 0.92, signals: 1 },
  speaking:  { spin: 0.11, pulse: 0.07,  twinkle: 0.45, glow: 1.0,  signals: 0.35 },
  error:     { spin: 0.015, pulse: 0,    twinkle: 0.1,  glow: 0.5,  signals: 0 },
};

export interface AgentFaceProps {
  variant: FaceVariant;
  state: FaceState;
  /** Optional live level 0..1 (audio), read every frame. */
  getLevel?: () => number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name, e.g. "Jarvis, speaking". Defaults to "<variant> face, <state>". */
  label?: string;
}

export function AgentFace({ variant, state, getLevel, className, style, label }: AgentFaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<FaceState>(state);
  stateRef.current = state;
  const levelRef = useRef(getLevel);
  levelRef.current = getLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let disposed = false;
    let raf = 0;
    const cleanup: Array<() => void> = [];

    (async () => {
      const THREE = await import("three");
      if (disposed) return;
      let renderer: ThreeNS.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
      } catch {
        // No WebGL: the CSS poster behind the canvas is the face (skill: static fallback).
        wrap.dataset.faceError = "webgl-unavailable";
        return;
      }
      wrap.dataset.faceLive = "1";
      const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); wrap.dataset.faceLive = "0"; };
      canvas.addEventListener("webglcontextlost", onLost);
      cleanup.push(() => canvas.removeEventListener("webglcontextlost", onLost));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
      camera.position.set(0, 0, 3.4);

      const built = buildVariant(THREE, variant);
      scene.add(built.group);

      const resize = () => {
        const w = Math.max(1, wrap.clientWidth);
        const h = Math.max(1, wrap.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(wrap);
      cleanup.push(() => ro.disconnect());

      // Smoothed state: colour and motion ease toward the target so a state change
      // reads as a transition, not a cut.
      const color = new THREE.Color(FACE_PALETTE[variant][stateRef.current]);
      const target = new THREE.Color();
      const m: Motion = { ...MOTION[stateRef.current] };
      let phase = 0;
      let last = performance.now();
      let lvl = 0;

      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const s = stateRef.current;
        const goal = MOTION[s];
        const k = Math.min(1, dt * 3.2);
        m.spin += (goal.spin - m.spin) * k;
        m.pulse += (goal.pulse - m.pulse) * k;
        m.twinkle += (goal.twinkle - m.twinkle) * k;
        m.glow += (goal.glow - m.glow) * k;
        m.signals += (goal.signals - m.signals) * k;
        target.set(FACE_PALETTE[variant][s]);
        color.lerp(target, Math.min(1, dt * 2.6));
        const raw = s === "speaking" || s === "listening" ? Math.max(0, Math.min(1, levelRef.current?.() ?? 0)) : 0;
        lvl += (raw - lvl) * Math.min(1, dt * 12);
        phase += dt * m.spin;
        built.update({ t: now / 1000, dt, phase, color, m, level: lvl, state: s });
        wrap.dataset.faceState = s;
        renderer.render(scene, camera);
      };

      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        frame(performance.now());
      } else {
        // Render only while the tab is visible AND the face is on screen.
        let onScreen = true;
        const loop = (now: number) => { raf = requestAnimationFrame(loop); frame(now); };
        const sync = () => {
          cancelAnimationFrame(raf);
          if (!document.hidden && onScreen && wrap.dataset.faceLive === "1") { last = performance.now(); raf = requestAnimationFrame(loop); }
        };
        document.addEventListener("visibilitychange", sync);
        cleanup.push(() => document.removeEventListener("visibilitychange", sync));
        const io = new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); sync(); });
        io.observe(wrap);
        cleanup.push(() => io.disconnect());
        raf = requestAnimationFrame(loop);
      }
      cleanup.push(() => { cancelAnimationFrame(raf); built.dispose(); renderer.dispose(); });
    })();

    return () => { disposed = true; cancelAnimationFrame(raf); cleanup.forEach((fn) => fn()); };
  }, [variant]);

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={label ?? `${variant} face, ${state}`}
      data-face-variant={variant}
      data-face-state={state}
      className={className}
      style={{ position: "relative", ...style }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: `radial-gradient(closest-side, ${FACE_PALETTE[variant][state]}33, transparent 70%)`, transition: "background 600ms ease" }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

type Three = typeof ThreeNS;
interface FrameArgs { t: number; dt: number; phase: number; color: ThreeNS.Color; m: Motion; level: number; state: FaceState }
interface Built { group: ThreeNS.Group; update: (a: FrameArgs) => void; dispose: () => void }

function buildVariant(THREE: Three, variant: FaceVariant): Built {
  if (variant === "galaxy") return buildGalaxy(THREE);
  if (variant === "radar") return buildRadar(THREE);
  return buildConstellation(THREE);
}

/** Soft round sprite, shared by the core glows. */
function glowTexture(THREE: Three): ThreeNS.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// Points shader shared by all variants: per-point size and seed, twinkle, glow.
const POINT_VERT = `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uPx;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 1.0 + uTwinkle * 0.55 * sin(uTime * (1.4 + aSeed * 2.3) + aSeed * 40.0);
    gl_PointSize = aSize * uPx * tw * (3.4 / -mv.z);
    vA = clamp(tw, 0.25, 1.6);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = `
  uniform vec3 uColor;
  uniform float uGlow;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    a = a * a * uGlow * vA;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), a * 0.35), a);
  }
`;

function pointsMaterial(THREE: Three, extra: Record<string, ThreeNS.IUniform> = {}, vert = POINT_VERT) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTwinkle: { value: 0.3 },
      uColor: { value: new THREE.Color() },
      uGlow: { value: 0.7 },
      uPx: { value: Math.min(window.devicePixelRatio || 1, 2) },
      ...extra,
    },
    vertexShader: vert,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// --- Jarvis: constellation / plexus ------------------------------------------

function buildConstellation(THREE: Three): Built {
  const group = new THREE.Group();
  const N = 560;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const seed = new Float32Array(N);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    // Fibonacci sphere, pushed into a shell-weighted volume so it reads as a cloud.
    const y = 1 - (i / (N - 1)) * 2;
    const rr = Math.sqrt(1 - y * y);
    const th = golden * i;
    const r = 0.45 + 0.55 * Math.pow(Math.random(), 0.45);
    const j = 0.08;
    pos[i * 3] = (Math.cos(th) * rr + (Math.random() - 0.5) * j) * r;
    pos[i * 3 + 1] = (y + (Math.random() - 0.5) * j) * r;
    pos[i * 3 + 2] = (Math.sin(th) * rr + (Math.random() - 0.5) * j) * r;
    size[i] = 2.2 + Math.pow(Math.random(), 3) * 7;
    seed[i] = Math.random();
  }
  // Edges: each node to up to 3 nearest neighbours inside a radius.
  const edges: number[] = [];
  const pairs: Array<[number, number]> = [];
  const MAXD2 = 0.26 * 0.26;
  for (let i = 0; i < N; i++) {
    const near: Array<[number, number]> = [];
    for (let k = 0; k < N; k++) {
      if (k === i) continue;
      const dx = pos[i * 3] - pos[k * 3], dy = pos[i * 3 + 1] - pos[k * 3 + 1], dz = pos[i * 3 + 2] - pos[k * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < MAXD2) near.push([d2, k]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, k] of near.slice(0, 3)) {
      if (k < i) continue; // each edge once
      pairs.push([i, k]);
      edges.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    }
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  pGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const pMat = pointsMaterial(THREE);
  const points = new THREE.Points(pGeo, pMat);

  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edges), 3));
  const lMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
  const lines = new THREE.LineSegments(lGeo, lMat);

  // Signal pulses travelling along edges (thinking / working).
  const S = 48;
  const sPos = new Float32Array(S * 3);
  const sSize = new Float32Array(S).fill(9);
  const sSeed = new Float32Array(S).map(() => Math.random());
  const sEdge = new Int32Array(S).map(() => Math.floor(Math.random() * Math.max(1, pairs.length)));
  const sT = new Float32Array(S).map(() => Math.random());
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute("aSize", new THREE.BufferAttribute(sSize, 1));
  sGeo.setAttribute("aSeed", new THREE.BufferAttribute(sSeed, 1));
  const sMat = pointsMaterial(THREE);
  const signals = new THREE.Points(sGeo, sMat);

  const WHITE = new THREE.Color(1, 1, 1);
  const tex = glowTexture(THREE);
  const coreMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const core = new THREE.Sprite(coreMat);
  core.scale.setScalar(1.6);

  const cloud = new THREE.Group();
  cloud.add(lines, points, signals);
  group.add(core, cloud);

  return {
    group,
    update: ({ t, dt, phase, color, m, level }) => {
      cloud.rotation.y = phase * 1.4;
      cloud.rotation.x = Math.sin(phase * 0.6) * 0.25;
      const breath = 1 + m.pulse * Math.sin(t * 2.1) + level * 0.14;
      cloud.scale.setScalar(breath);
      pMat.uniforms.uTime.value = t;
      pMat.uniforms.uTwinkle.value = m.twinkle;
      (pMat.uniforms.uColor.value as ThreeNS.Color).copy(color);
      pMat.uniforms.uGlow.value = m.glow;
      lMat.color.copy(color);
      lMat.opacity = 0.1 + 0.16 * m.glow + level * 0.12;
      // Pulses advance along their edge; a finished pulse hops to a new edge.
      for (let i = 0; i < S; i++) {
        sT[i] += dt * (0.6 + sSeed[i] * 0.9) * (0.3 + m.signals * 1.4);
        if (sT[i] >= 1) { sT[i] = 0; sEdge[i] = Math.floor(Math.random() * Math.max(1, pairs.length)); }
        const pr = pairs[sEdge[i]];
        if (!pr) continue;
        const [a, b] = pr;
        const u = sT[i];
        sPos[i * 3] = pos[a * 3] + (pos[b * 3] - pos[a * 3]) * u;
        sPos[i * 3 + 1] = pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * u;
        sPos[i * 3 + 2] = pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * u;
      }
      sGeo.attributes.position.needsUpdate = true;
      sMat.uniforms.uTime.value = t;
      (sMat.uniforms.uColor.value as ThreeNS.Color).copy(color).lerp(WHITE, 0.35);
      sMat.uniforms.uGlow.value = m.signals * 1.2;
      coreMat.color.copy(color);
      coreMat.opacity = 0.12 + 0.18 * m.glow + level * 0.3;
      core.scale.setScalar(1.3 + m.pulse * 4 * Math.sin(t * 2.1) + level * 0.6);
    },
    dispose: () => { pGeo.dispose(); pMat.dispose(); lGeo.dispose(); lMat.dispose(); sGeo.dispose(); sMat.dispose(); coreMat.dispose(); tex.dispose(); },
  };
}

// --- Oracle: spiral galaxy ----------------------------------------------------

const GALAXY_VERT = `
  attribute float aSize;
  attribute float aSeed;
  attribute float aR;
  attribute float aAng;
  attribute float aY;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uPx;
  uniform float uPhase;
  varying float vA;
  void main() {
    // Differential rotation: the core turns faster than the rim.
    float ang = aAng + uPhase * (1.6 / (0.25 + aR));
    vec3 p = vec3(cos(ang) * aR, sin(ang) * aR, aY);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 1.0 + uTwinkle * 0.5 * sin(uTime * (1.2 + aSeed * 2.0) + aSeed * 50.0);
    gl_PointSize = aSize * uPx * tw * (3.4 / -mv.z);
    vA = clamp(tw * (1.15 - aR * 0.55), 0.2, 1.6);
    gl_Position = projectionMatrix * mv;
  }
`;

function buildGalaxy(THREE: Three): Built {
  const group = new THREE.Group();
  const N = 9000;
  const ARMS = 3;
  const r = new Float32Array(N), ang = new Float32Array(N), y = new Float32Array(N);
  const size = new Float32Array(N), seed = new Float32Array(N);
  const pos = new Float32Array(N * 3); // required attribute; the shader computes real positions
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  for (let i = 0; i < N; i++) {
    const rr = Math.pow(Math.random(), 0.6) * 1.15;
    const arm = (i % ARMS) * ((Math.PI * 2) / ARMS);
    const spread = 0.12 + (1 - rr) * 0.08;
    r[i] = rr;
    ang[i] = arm + rr * 3.4 + gauss() * spread * (2.4 - rr);
    y[i] = gauss() * 0.05 * (1.2 - rr);
    size[i] = 1.4 + Math.pow(Math.random(), 4) * 6 + (rr < 0.15 ? 2 : 0);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aR", new THREE.BufferAttribute(r, 1));
  geo.setAttribute("aAng", new THREE.BufferAttribute(ang, 1));
  geo.setAttribute("aY", new THREE.BufferAttribute(y, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.5); // positions live in the shader
  const mat = pointsMaterial(THREE, { uPhase: { value: 0 } }, GALAXY_VERT);
  const stars = new THREE.Points(geo, mat);

  const tex = glowTexture(THREE);
  const coreMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const core = new THREE.Sprite(coreMat);
  const disc = new THREE.Group();
  disc.add(stars);
  disc.rotation.x = -0.42;
  group.add(disc, core);

  return {
    group,
    update: ({ t, phase, color, m, level }) => {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uPhase.value = phase;
      mat.uniforms.uTwinkle.value = m.twinkle;
      (mat.uniforms.uColor.value as ThreeNS.Color).copy(color);
      mat.uniforms.uGlow.value = 0.55 + 0.45 * m.glow;
      disc.scale.setScalar(1 + m.pulse * 0.6 * Math.sin(t * 1.8) + level * 0.08);
      coreMat.color.copy(color);
      coreMat.opacity = 0.35 + 0.3 * m.glow + level * 0.35;
      core.scale.setScalar(0.55 + m.pulse * 3 * Math.sin(t * 1.8) + level * 0.5);
    },
    dispose: () => { geo.dispose(); mat.dispose(); coreMat.dispose(); tex.dispose(); },
  };
}

// --- News Radar: rings under a sweep -----------------------------------------

const RADAR_VERT = `
  attribute float aSize;
  attribute float aSeed;
  attribute float aKind;   // 0 ring dot, 1 sweep arm, 2 blip
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uPx;
  uniform float uSweep;
  varying float vA;
  void main() {
    vec3 p = position;
    float ang = atan(p.y, p.x);
    float r = length(p.xy);
    if (aKind > 0.5 && aKind < 1.5) {
      // sweep arm points ride the sweep angle
      p = vec3(cos(uSweep) * r, sin(uSweep) * r, 0.0);
      ang = uSweep;
    }
    float behind = mod(uSweep - ang + 6.28318, 6.28318);
    float lit = exp(-behind * 2.6);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 1.0 + uTwinkle * 0.3 * sin(uTime * 2.0 + aSeed * 30.0);
    float base = aKind > 1.5 ? 0.05 : (aKind > 0.5 ? 1.0 : 0.28);
    float boost = aKind > 1.5 ? 3.0 : 1.0;
    gl_PointSize = aSize * uPx * tw * (1.0 + lit * 0.8 * boost) * (3.4 / -mv.z);
    vA = clamp(base + lit * 1.2 * boost, 0.0, 1.8);
    gl_Position = projectionMatrix * mv;
  }
`;

function buildRadar(THREE: Three): Built {
  const group = new THREE.Group();
  const RINGS = 6, PER = 200, ARM = 60, BLIPS = 70;
  const N = RINGS * PER + ARM + BLIPS;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N), kind = new Float32Array(N);
  let i = 0;
  for (let ring = 1; ring <= RINGS; ring++) {
    const rr = (ring / RINGS) * 1.05;
    for (let k = 0; k < PER; k++, i++) {
      const a = (k / PER) * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = Math.sin(a) * rr; pos[i * 3 + 2] = 0;
      size[i] = ring === RINGS ? 2.4 : 1.7; seed[i] = Math.random(); kind[i] = 0;
    }
  }
  for (let k = 0; k < ARM; k++, i++) {
    const rr = (k / ARM) * 1.05;
    pos[i * 3] = rr; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
    size[i] = 3.2; seed[i] = Math.random(); kind[i] = 1;
  }
  for (let k = 0; k < BLIPS; k++, i++) {
    const a = Math.random() * Math.PI * 2, rr = 0.15 + Math.random() * 0.9;
    pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = Math.sin(a) * rr; pos[i * 3 + 2] = 0;
    size[i] = 3 + Math.random() * 4; seed[i] = Math.random(); kind[i] = 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  const mat = pointsMaterial(THREE, { uSweep: { value: 0 } }, RADAR_VERT);
  const dots = new THREE.Points(geo, mat);
  const tex = glowTexture(THREE);
  const coreMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const core = new THREE.Sprite(coreMat);
  const plate = new THREE.Group();
  plate.add(dots);
  plate.rotation.x = -0.5;
  group.add(plate, core);

  return {
    group,
    update: ({ t, phase, color, m, level }) => {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uSweep.value = (phase * 9) % (Math.PI * 2);
      mat.uniforms.uTwinkle.value = m.twinkle;
      (mat.uniforms.uColor.value as ThreeNS.Color).copy(color);
      mat.uniforms.uGlow.value = 0.6 + 0.4 * m.glow + level * 0.3;
      plate.scale.setScalar(1 + m.pulse * 0.4 * Math.sin(t * 2.2) + level * 0.06);
      coreMat.color.copy(color);
      coreMat.opacity = 0.18 + 0.2 * m.glow + level * 0.3;
      core.scale.setScalar(0.35 + level * 0.3);
    },
    dispose: () => { geo.dispose(); mat.dispose(); coreMat.dispose(); tex.dispose(); },
  };
}
