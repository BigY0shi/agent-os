import SkillsView from "@/components/v2/skills/SkillsView";

// Skills (SPEC-B B7, CONVENTIONS §11) — skills-as-policies: standing policy
// blocks (v2_skills) authored here and injected into task-execution prompts
// (B2) and the Jarvis context (C4) via skills/store.ts withSkills(). The page
// path /skills was free (only the legacy /api/skills API route existed — it
// serves the FILE-based operating skills list and is untouched).
export default function SkillsRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <SkillsView />
    </div>
  );
}
