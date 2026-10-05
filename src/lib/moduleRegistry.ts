// Module registry (S14, _design/jarvis-v3-plan.md): one list of the modules a user
// can switch skills and workflows on for, keyed the way settings.skills.modules and
// cliComplete({ module }) key them.
//
// `readsSkills` is a claim about CODE, not configuration: true only where an agent
// call in that module passes its key to withSkills / cliComplete({ module }). The
// pop-up says so plainly when a module does not read skills yet, instead of showing
// a toggle that silently does nothing (AGENTS.md "Never fabricate state"). The smoke
// greps the source to keep this list honest.
//
// Labels and routes mirror src/components/Sidebar.tsx NAV (not imported: Sidebar is a
// client component and this file is used server-side too).

export interface ModuleEntry {
  id: string;
  label: string;
  route: string;
  readsSkills: boolean;
  /** Sub-modules that live inside another module's page (Jarvis tabs). */
  parent?: string;
}

/** Module keys whose agent calls read module skills today. */
export const SKILL_WIRED: readonly string[] = [
  "deals", "hire", "marketing", "content-engine", "agent-kanban",
  "news-radar", "brainstorm", "idea-engine", "pipeline", "leads", "games", "room",
  "oracle", "jarvis",
];

const RAW: Array<[id: string, label: string, route: string, parent?: string]> = [
  ["mission-control", "Mission Control", "/"],
  ["integrations", "Integrations", "/integrations"],
  ["automations", "Automations", "/automations"],
  ["anynotes", "AnyNotes", "/anynotes"],
  ["newsletter", "Newsletter", "/newsletter"],
  ["rabbit", "Rabbit R1", "/rabbit"],
  ["agents", "Agents", "/agents"],
  ["paperclip", "Paperclip", "/paperclip"],
  ["room", "AI Agent Mastermind", "/room"],
  ["pipeline", "Pipeline", "/pipeline"],
  ["deals", "Deal Desk", "/deals"],
  ["marketing", "Marketing Hub", "/marketing"],
  ["hire", "Hire Engine", "/hire"],
  ["audit", "Audit Console", "/audit"],
  ["brainstorm", "Brainstorm", "/brainstorm"],
  ["idea-engine", "Idea Engine", "/idea-engine"],
  ["jarvis", "Jarvis", "/jarvis"],
  ["oracle", "Oracle", "/jarvis?tab=oracle", "jarvis"],
  ["news-radar", "News Radar", "/jarvis?tab=radar", "jarvis"],
  ["outreach", "Outreach", "/jarvis?tab=outreach", "jarvis"],
  ["claude", "Claude", "/claude"],
  ["openclaw", "OpenClaw", "/openclaw"],
  ["hermes", "Hermes", "/hermes"],
  ["antigravity", "Antigravity", "/antigravity"],
  ["codex", "Codex", "/codex"],
  ["cursor", "Cursor", "/cursor"],
  ["pi", "Pi", "/pi"],
  ["ollama", "Ollama Cloud", "/ollama"],
  ["freeclaude", "Free Claude Code", "/freeclaude"],
  ["fusion", "Fusion", "/fusion"],
  ["sakana", "Sakana Fugu", "/sakana"],
  ["local", "Local", "/local"],
  ["engine", "Local Engine", "/engine"],
  ["agent-kanban", "Agent Kanban", "/agent-kanban"],
  ["browser", "Browser", "/browser"],
  ["loop", "Loop", "/loop"],
  ["content-engine", "Content Engine", "/content-engine"],
  ["seo", "SEO", "/seo"],
  ["leads", "Leads", "/leads"],
  ["opendesign", "Open Design", "/opendesign"],
  ["video", "Video", "/video"],
  ["music", "Music", "/music"],
  ["games", "Game Studio", "/games"],
  ["thumbnails", "Thumbnails", "/thumbnails"],
  ["notebook", "Notebook", "/notebook"],
  ["hermes3d", "Hermes 3D", "/hermes3d"],
  ["kanban", "Kanban", "/kanban"],
  ["tasks", "Tasks", "/tasks"],
  ["today", "Today", "/today"],
  ["webmcp", "WebMCP", "/webmcp"],
  ["skills", "Skills", "/skills"],
  ["memory", "Memory", "/memory"],
  ["terminal", "Terminal", "/terminal"],
];

export const MODULES: ModuleEntry[] = RAW.map(([id, label, route, parent]) => ({
  id, label, route, parent, readsSkills: SKILL_WIRED.includes(id),
}));

const JARVIS_TAB_MODULE: Record<string, string> = { oracle: "oracle", radar: "news-radar", outreach: "outreach" };

export function getModule(id: string): ModuleEntry | null {
  return MODULES.find((m) => m.id === id) ?? null;
}

/** Which module a URL belongs to (Jarvis tabs resolve to their own module). */
export function moduleForPath(pathname: string, search = ""): ModuleEntry | null {
  if (pathname === "/" || pathname === "") return getModule("mission-control");
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  if (seg === "jarvis") {
    const tab = new URLSearchParams(search).get("tab") ?? "";
    return getModule(JARVIS_TAB_MODULE[tab] ?? "jarvis");
  }
  return getModule(seg);
}

export function isModuleId(id: unknown): id is string {
  return typeof id === "string" && MODULES.some((m) => m.id === id);
}
