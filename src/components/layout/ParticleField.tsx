"use client";

import { useEffect, useRef } from "react";
import type * as ThreeNS from "three";

// Global WebGL particle field — adapted from the "Thermal Dynamics" telemetry field
// in EnterpriseComponents-Design.html (Three.js): ~2.4k additive soft dots with a
// sine shimmer, slow drift, and mouse parallax. Recoloured to the Agent OS neon-green
// and dropped behind the UI (fixed, pointer-events:none). Pauses when the tab is
// hidden, honours prefers-reduced-motion, and clamps DPR — so it stays cheap.
export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let disposed = false;
    const cleanup: Array<() => void> = [];

    (async () => {
      const THREE = await import("three"); // async chunk — keeps it out of the initial bundle
      if (disposed) return;

      let renderer: ThreeNS.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
      } catch {
        return; // WebGL unavailable — skip silently, the CSS backdrop still stands
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x05070d, 0.001);

      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 2000);
      camera.position.z = 600;

      // ── tunables ──
      const COUNT = 3600; // density
      const SIZE = 4.5;   // base point size (px at z≈600)
      const SPEED = 1.4;  // animation-speed multiplier

      const positions = new Float32Array(COUNT * 3);
      for (let i = 0; i < COUNT * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 2000;
        positions[i + 1] = (Math.random() - 0.5) * 1000;
        positions[i + 2] = (Math.random() - 0.5) * 1000;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Color(0x6fff9b) }, // Agent OS neon-green
          time: { value: 0 },
        },
        vertexShader: `
          uniform float time;
          void main() {
            vec3 pos = position;
            pos.y += sin(pos.x * 0.005 + time) * 10.0;
            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = ${SIZE.toFixed(1)} * (600.0 / -mvPos.z);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform vec3 color;
          void main() {
            vec2 coord = gl_PointCoord.xy - vec2(0.5);
            float dist = length(coord);
            if (dist > 0.5) discard;
            float alpha = smoothstep(0.5, 0.2, dist) * 0.6;
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const points = new THREE.Points(geo, mat);
      scene.add(points);

      let pointerX = 0;
      let pointerY = 0;
      const onMove = (e: MouseEvent) => {
        pointerX = (e.clientX - window.innerWidth / 2) * 0.0005;
        pointerY = (e.clientY - window.innerHeight / 2) * 0.0005;
      };
      window.addEventListener("mousemove", onMove, { passive: true });
      cleanup.push(() => window.removeEventListener("mousemove", onMove));

      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", onResize);
      cleanup.push(() => window.removeEventListener("resize", onResize));

      const clock = new THREE.Clock();
      const draw = (t: number) => {
        mat.uniforms.time.value = t;
        points.rotation.y = t * 0.01;
        points.rotation.x = Math.sin(t * 0.05) * 0.02;
        camera.position.x += (pointerX * 150 - camera.position.x) * 0.05;
        camera.position.y += (-pointerY * 150 - camera.position.y) * 0.05;
        camera.lookAt(scene.position);
        renderer.render(scene, camera);
      };

      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        draw(0); // a single static frame — respect reduced-motion
      } else {
        const loop = () => { raf = requestAnimationFrame(loop); draw(clock.getElapsedTime() * SPEED); };
        const onVis = () => {
          cancelAnimationFrame(raf);
          if (!document.hidden) raf = requestAnimationFrame(loop); // pause GPU when tab is hidden
        };
        document.addEventListener("visibilitychange", onVis);
        cleanup.push(() => document.removeEventListener("visibilitychange", onVis));
        raf = requestAnimationFrame(loop);
      }

      cleanup.push(() => {
        cancelAnimationFrame(raf);
        geo.dispose();
        mat.dispose();
        renderer.dispose();
      });
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup.forEach((fn) => fn());
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 h-full w-full pointer-events-none"
      style={{ zIndex: 0, opacity: 0.5, mixBlendMode: "screen" }}
    />
  );
}
