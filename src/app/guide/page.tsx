import GuideView from "@/components/GuideView";
import { loadGuide } from "@/lib/guide";

// S29: the in-app wiki. Reads docs/guide and docs/modules on every visit (no rebuild
// needed after a doc edit). The previous page (the build-your-own markdown from
// /api/guide) lives on inside it as its last section.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function GuideRoute() {
  const { general, modules } = loadGuide();
  return (
    <div className="mx-auto max-w-[1400px]">
      <GuideView general={general} modules={modules} />
    </div>
  );
}
