import MemoryView from "@/components/v2/memory/MemoryView";

// Memory V2 (SPEC-A A8) — episodic memory browser over /api/v2/memory/*.
// The old vault-grep MemoryPanel page lives on in .exile/2026-08-27_090625/.
export default function MemoryRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <MemoryView />
    </div>
  );
}
