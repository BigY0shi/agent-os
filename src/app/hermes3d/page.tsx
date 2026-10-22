import Hermes3DView from "@/components/v2/hermes3d/Hermes3DView";

// SPEC-F L2: the Hermes 3D office. The scene itself is client-only (WebGL);
// see Hermes3DView for the ssr:false boundary.
export default function Hermes3DRoute() {
  return <Hermes3DView />;
}
