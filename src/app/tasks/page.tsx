import TasksView from "@/components/v2/tasks/TasksView";

// Tasks V2 (SPEC-B B4) — list + calendar, drag-drop board, agents strip over
// /api/v2/tasks/*. The /kanban module is untouched — this is the V2 surface.
export default function TasksRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <TasksView />
    </div>
  );
}
