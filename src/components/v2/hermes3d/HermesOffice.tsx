"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CHARACTERS } from "@/lib/v2/hermes3d/clips";
import {
  HERMES3D_ASSETS, MISSING_ASSETS_MESSAGE, SEATED_IDLE_CLIPS, isSeatAnchor, pickSeats,
  type SeatAnchor,
} from "@/lib/v2/hermes3d/scene";

// SPEC-F L2.2, mounted 2026-09-02 on plain three.js (already a dependency;
// r3f/drei were never installed). The office is the baked Synty level; a few
// chairs get a body playing a SEATED IDLE clip. Nothing here reads run state
// yet, and the HUD says so: an idle body is the honest render for "nothing is
// happening" (clips.ts), and a body that types with no run behind it would be
// the fake-telemetry pattern in 3D.

export interface SceneOptions {
  quality: "full" | "lite";
  shadows: boolean;
  showFps: boolean;
  /** Chairs that get an idle body. 0 = the office alone. */
  seatedCount: number;
}

export interface SceneReport {
  officeMeshes: number;
  officeTriangles: number;
  clipsInLibrary: number;
  seatsInFile: number;
  charactersSeated: number;
  /** Anything that did not load. Shown, never swallowed. */
  problems: string[];
}

type Status =
  | { kind: "probing" }
  | { kind: "missing"; detail: string }
  | { kind: "loading"; step: string }
  | { kind: "ready"; report: SceneReport }
  | { kind: "error"; detail: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function HermesOffice({ options }: { options: SceneOptions }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "probing" });
  const [fps, setFps] = useState<number | null>(null);
  const { quality, shadows, showFps, seatedCount } = options;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    let raf = 0;
    const disposables: Array<{ dispose(): void }> = [];
    let renderer: THREE.WebGLRenderer | null = null;

    (async () => {
      setStatus({ kind: "probing" });
      // Probe before touching WebGL: the directory is gitignored, so the honest
      // first question is "is anything there", answered by the server, not by a
      // loader error deep in a parser.
      const probe = await fetch(HERMES3D_ASSETS.office, { method: "HEAD", cache: "no-store" })
        .then((r) => ({ ok: r.ok, status: r.status, statusText: r.statusText }))
        .catch((e: unknown) => ({ ok: false, status: 0, statusText: errText(e) }));
      if (!alive) return;
      if (!probe.ok) {
        setStatus({ kind: "missing", detail: `HEAD ${HERMES3D_ASSETS.office} -> ${probe.status || "network error"} ${probe.statusText}`.trim() });
        return;
      }

      setStatus({ kind: "loading", step: "office.glb" });
      renderer = new THREE.WebGLRenderer({ antialias: quality === "full", powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "lite" ? 1 : 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = shadows;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      el.appendChild(renderer.domElement);
      disposables.push(renderer);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0713);
      const camera = new THREE.PerspectiveCamera(45, Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight), 0.1, 400);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.minDistance = 2;
      controls.maxDistance = 120;
      disposables.push(controls);

      // Lights. "lite" keeps the key light only; "full" adds the hemisphere
      // fill that stands in for env lighting (no HDRI shipped, self-hosted).
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(18, 30, 12);
      key.castShadow = shadows;
      if (shadows) {
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.left = -40;
        key.shadow.camera.bottom = -40;
        key.shadow.camera.right = 40;
        key.shadow.camera.top = 40;
        key.shadow.camera.far = 120;
      }
      scene.add(key);
      scene.add(new THREE.AmbientLight(0xffffff, quality === "full" ? 0.35 : 0.6));
      if (quality === "full") scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x3a2a44, 0.9));

      const loader = new GLTFLoader();
      const problems: string[] = [];
      const report: SceneReport = { officeMeshes: 0, officeTriangles: 0, clipsInLibrary: 0, seatsInFile: 0, charactersSeated: 0, problems };

      // -- office ------------------------------------------------------------
      let office: GLTF;
      try {
        office = await loader.loadAsync(HERMES3D_ASSETS.office);
      } catch (e) {
        if (alive) setStatus({ kind: "error", detail: `office.glb failed to load: ${errText(e)}` });
        return;
      }
      if (!alive) return;
      office.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = shadows;
        m.receiveShadow = shadows;
        report.officeMeshes++;
        const idx = m.geometry.index;
        report.officeTriangles += Math.floor((idx ? idx.count : m.geometry.attributes.position?.count ?? 0) / 3);
      });
      if (report.officeMeshes === 0) {
        // A GLB that parses to nothing is the "build reported success, emitted
        // empty" failure AGENTS.md names. Say it, do not render a dark void.
        setStatus({ kind: "error", detail: "office.glb parsed but holds zero meshes; re-run scripts/v2/hermes3d/bake-office.mjs" });
        return;
      }
      scene.add(office.scene);

      const box = new THREE.Box3().setFromObject(office.scene);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      let target = center.clone();
      target.y = box.min.y + 1;

      // -- seats -------------------------------------------------------------
      let seats: SeatAnchor[] = [];
      try {
        setStatus({ kind: "loading", step: "office-seats.json" });
        const r = await fetch(HERMES3D_ASSETS.seats, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const rows: unknown = await r.json();
        if (!Array.isArray(rows)) throw new Error("not an array");
        const bad = rows.filter((x) => !isSeatAnchor(x)).length;
        if (bad) problems.push(`office-seats.json: ${bad} malformed row(s) ignored`);
        const good = rows.filter(isSeatAnchor);
        report.seatsInFile = good.length;
        seats = pickSeats(good, seatedCount);
      } catch (e) {
        problems.push(`office-seats.json unavailable (${errText(e)}); no bodies seated`);
      }
      if (!alive) return;

      // -- clips + characters ------------------------------------------------
      const mixers: THREE.AnimationMixer[] = [];
      if (seats.length > 0) {
        let clips: THREE.AnimationClip[] = [];
        try {
          setStatus({ kind: "loading", step: "hermes-clips.glb" });
          const lib = await loader.loadAsync(HERMES3D_ASSETS.clips);
          clips = lib.animations;
          report.clipsInLibrary = clips.length;
        } catch (e) {
          problems.push(`hermes-clips.glb failed (${errText(e)}); bodies would freeze in bind pose, so none seated`);
          seats = [];
        }
        if (!alive) return;

        let atlas: THREE.Texture | null = null;
        if (seats.length > 0) {
          try {
            atlas = await new THREE.TextureLoader().loadAsync(HERMES3D_ASSETS.atlas);
            atlas.colorSpace = THREE.SRGBColorSpace;
            atlas.flipY = false; // glTF UV convention; the bake exported the characters untextured
            disposables.push(atlas);
          } catch (e) {
            problems.push(`character atlas failed (${errText(e)}); bodies render flat grey`);
          }
        }

        for (let i = 0; i < seats.length; i++) {
          if (!alive) return;
          const seat = seats[i];
          const slug = CHARACTERS[i % CHARACTERS.length];
          const clipName = SEATED_IDLE_CLIPS[i % SEATED_IDLE_CLIPS.length];
          const clip = clips.find((c) => c.name === clipName);
          if (!clip) {
            problems.push(`clip "${clipName}" is not in hermes-clips.glb (first few: ${clips.map((c) => c.name).slice(0, 6).join(", ")}); ${slug} not seated`);
            continue;
          }
          setStatus({ kind: "loading", step: `characters/${slug}.glb` });
          let body: GLTF;
          try {
            body = await loader.loadAsync(`${HERMES3D_ASSETS.characters}/${slug}.glb`);
          } catch (e) {
            problems.push(`characters/${slug}.glb failed (${errText(e)})`);
            continue;
          }
          body.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.castShadow = shadows;
            m.frustumCulled = false; // skinned bounds lag the pose; culling blinks bodies out at the frame edge
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              const std = mat as THREE.MeshStandardMaterial;
              if (atlas && "map" in std) { std.map = atlas; std.needsUpdate = true; }
            }
          });
          body.scene.position.set(seat.pos[0], seat.pos[1], seat.pos[2]);
          body.scene.rotation.y = seat.rotY;
          scene.add(body.scene);
          const mixer = new THREE.AnimationMixer(body.scene);
          const action = mixer.clipAction(clip);
          action.time = Math.random() * clip.duration; // desync the loop so four bodies do not breathe in unison
          action.play();
          mixers.push(mixer);
          report.charactersSeated++;
        }
        if (report.charactersSeated > 0) {
          const c = seats.slice(0, report.charactersSeated);
          target = new THREE.Vector3(
            c.reduce((s, a) => s + a.pos[0], 0) / c.length,
            box.min.y + 1,
            c.reduce((s, a) => s + a.pos[2], 0) / c.length,
          );
        }
      }
      if (!alive) return;

      // Frame: a raised three-quarter view of the seated cluster, or of the
      // floor centre when nothing is seated. Orbit from there.
      const reach = report.charactersSeated > 0 ? 9 : Math.max(size.x, size.z) * 0.45;
      camera.position.set(target.x + reach * 0.8, target.y + reach * 0.75, target.z + reach);
      controls.target.copy(target);
      controls.update();

      const clock = new THREE.Clock();
      let frames = 0;
      let fpsAt = performance.now();
      const tick = () => {
        if (!alive || !renderer) return;
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.1);
        for (const m of mixers) m.update(dt);
        controls.update();
        renderer.render(scene, camera);
        if (showFps) {
          frames++;
          const now = performance.now();
          if (now - fpsAt >= 500) { setFps(Math.round((frames * 1000) / (now - fpsAt))); frames = 0; fpsAt = now; }
        }
      };

      const ro = new ResizeObserver(() => {
        if (!renderer) return;
        const w = Math.max(1, el.clientWidth);
        const h = Math.max(1, el.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      ro.observe(el);
      disposables.push({ dispose: () => ro.disconnect() });
      disposables.push({
        dispose: () => scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry?.dispose();
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat?.dispose();
        }),
      });

      setStatus({ kind: "ready", report });
      tick();
    })().catch((e: unknown) => { if (alive) setStatus({ kind: "error", detail: errText(e) }); });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      for (const d of disposables.reverse()) { try { d.dispose(); } catch { /* already gone */ } }
      if (renderer && renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      setFps(null);
    };
  }, [quality, shadows, showFps, seatedCount]);

  const panel: CSSProperties = {
    background: "var(--panel, rgba(255,255,255,0.04))", border: "1px solid var(--panel-border, #2a2436)",
    color: "var(--fg, #e8e2f0)", borderRadius: 10, padding: "10px 12px", fontSize: 12, lineHeight: 1.5,
  };

  return (
    <div className="relative w-full h-full" style={{ minHeight: 420 }}>
      {/* The canvas host stays mounted through every status so a re-run of the
          effect (a settings change) has somewhere to attach. */}
      <div ref={host} className="absolute inset-0" style={{ visibility: status.kind === "ready" ? "visible" : "hidden" }} />

      {status.kind === "missing" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div style={{ ...panel, maxWidth: 560, borderColor: "#f59e0b88" }}>
            <div className="font-semibold mb-1" style={{ color: "#fbbf24" }}>Assets not baked</div>
            <div>{MISSING_ASSETS_MESSAGE}</div>
            <div className="mt-2 font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{status.detail}</div>
          </div>
        </div>
      )}
      {status.kind === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div style={{ ...panel, maxWidth: 560, borderColor: "#ef444488" }}>
            <div className="font-semibold mb-1" style={{ color: "#f87171" }}>Scene failed</div>
            <div className="font-mono text-[11px]">{status.detail}</div>
          </div>
        </div>
      )}
      {(status.kind === "probing" || status.kind === "loading") && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div style={panel}>{status.kind === "probing" ? "Checking for baked assets..." : `Loading ${status.step}...`}</div>
        </div>
      )}
      {status.kind === "ready" && (
        <div className="absolute left-3 bottom-3 max-w-[560px]" style={{ ...panel, background: "rgba(11,7,19,0.82)" }}>
          <div>
            office.glb: {status.report.officeMeshes} meshes, {status.report.officeTriangles.toLocaleString()} triangles
            {status.report.seatsInFile > 0 && <>, {status.report.seatsInFile} seat anchors</>}
            {status.report.clipsInLibrary > 0 && <>, {status.report.clipsInLibrary} clips in the library</>}
            {showFps && fps !== null && <>, {fps} fps</>}
          </div>
          <div style={{ color: "var(--fg-dim, #9aa)" }}>
            {status.report.charactersSeated > 0
              ? `${status.report.charactersSeated} bodies seated, all idle. Not agents: run state is not wired to this scene yet, so nobody here is doing anything.`
              : "No bodies seated. Drag to orbit, wheel to zoom."}
          </div>
          {status.report.problems.map((p, i) => (
            <div key={i} className="font-mono text-[11px]" style={{ color: "#fbbf24" }}>! {p}</div>
          ))}
        </div>
      )}
    </div>
  );
}
