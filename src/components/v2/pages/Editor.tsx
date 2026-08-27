"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { SCRATCHPAD_ACCENT, TASK_STATUS_COLORS_CLIENT, type PageClient } from "./shared";

// ── Editor (SPEC-B B5.1/B5.2) — TipTap day editor, single-client autosave ────
// StarterKit + TaskList/TaskItem with custom attrs (taskUuid/displayId on
// taskItem; nodeId/mentionHandled on paragraph — the butler's write-back +
// comment-anchor surface). Autosave: ~1.5 s debounce, rev CAS; a 409 refetches
// and REPLACES content (replace-and-toast per SPEC §1.1 — no step replay).
// Server write-backs (bound-task attrs, mention stamps) come back on the save
// response and are adopted with the caret restored by position.

/** taskUuid → live status, provided by ScratchpadView's tasks poll. */
export const TaskStatusContext = createContext<Record<string, string>>({});

// Paragraph anchor attrs (rendered as data-* so comment bubbles can find the DOM node).
const ScratchpadAttrs = Extension.create({
  name: "scratchpadAttrs",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          nodeId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-node-id"),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.nodeId ? { "data-node-id": String(attrs.nodeId) } : {},
          },
          mentionHandled: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-mention-handled"),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.mentionHandled ? { "data-mention-handled": String(attrs.mentionHandled) } : {},
          },
        },
      },
    ];
  },
});

function TaskItemView({ node, updateAttributes }: NodeViewProps) {
  const statuses = useContext(TaskStatusContext);
  const checked = node.attrs.checked === true;
  const taskUuid = typeof node.attrs.taskUuid === "string" ? node.attrs.taskUuid : null;
  const displayId = typeof node.attrs.displayId === "string" ? node.attrs.displayId : null;
  const status = taskUuid ? statuses[taskUuid] : undefined;
  const statusColor = status ? (TASK_STATUS_COLORS_CLIENT[status] ?? "#9aa") : null;

  return (
    <NodeViewWrapper
      as="li"
      data-type="taskItem"
      data-checked={checked}
      className="flex items-start gap-2 my-0.5 list-none"
    >
      <span contentEditable={false} className="flex items-center gap-1.5 shrink-0 pt-[3px] select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => updateAttributes({ checked: e.target.checked })}
          style={{ accentColor: SCRATCHPAD_ACCENT }}
        />
        {displayId && (
          <button
            type="button"
            title={`Open ${displayId} in Tasks`}
            onClick={() => {
              window.location.href = `/tasks?focus=${encodeURIComponent(displayId)}`;
            }}
            className="font-mono text-[10px] px-1.5 py-[1px] rounded cursor-pointer"
            style={{
              color: SCRATCHPAD_ACCENT,
              background: `${SCRATCHPAD_ACCENT}14`,
              border: `1px solid ${SCRATCHPAD_ACCENT}44`,
            }}
          >
            {displayId}
          </button>
        )}
        {status && statusColor && (
          <span
            className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] px-1.5 py-[1px] rounded"
            style={{ color: statusColor, background: `${statusColor}14`, border: `1px solid ${statusColor}44` }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
            {status}
          </span>
        )}
      </span>
      <NodeViewContent
        className={`flex-1 min-w-0 ${checked ? "line-through opacity-60" : ""}`}
      />
    </NodeViewWrapper>
  );
}

const BoundTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskUuid: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-task-uuid"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.taskUuid ? { "data-task-uuid": String(attrs.taskUuid) } : {},
      },
      displayId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-display-id"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.displayId ? { "data-display-id": String(attrs.displayId) } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView);
  },
});

export interface SaveOutcome {
  kind: "saved" | "conflict";
  bound?: number;
}

export default function Editor({
  page,
  onSaveOutcome,
  onDocRefreshed,
}: {
  page: PageClient;
  onSaveOutcome?: (o: SaveOutcome) => void;
  onDocRefreshed?: () => void;
}) {
  const revRef = useRef(page.rev);
  const pageIdRef = useRef(page.id);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      BoundTaskItem.configure({ nested: false }),
      ScratchpadAttrs,
    ],
    content: page.doc,
    editorProps: {
      attributes: { class: "scratchpad-prose outline-none min-h-[50vh]" },
    },
    onUpdate: () => {
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void save(), 1500);
    },
  });

  /** Replace content, keeping the caret near where it was (attr write-backs
   *  don't shift text positions, so plain position restore is safe). */
  function adoptDoc(doc: unknown) {
    if (!editor) return;
    const anchor = editor.state.selection.anchor;
    editor.commands.setContent(doc as never, { emitUpdate: false });
    try {
      editor.commands.setTextSelection(Math.min(anchor, editor.state.doc.content.size));
    } catch {
      /* caret restore is best-effort */
    }
  }

  async function save() {
    if (!editor || savingRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;
    try {
      const r = await fetch(`/api/v2/pages/${pageIdRef.current}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docJson: editor.getJSON(), rev: revRef.current }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j?.current) {
        // Stale: replace-and-toast (SPEC §1.1 — refetch-merge, no step replay).
        revRef.current = j.current.rev;
        adoptDoc(j.current.docJson);
        onSaveOutcome?.({ kind: "conflict" });
        return;
      }
      if (r.ok && typeof j?.rev === "number") {
        revRef.current = j.rev;
        if (j.docChanged && !dirtyRef.current) adoptDoc(j.docJson);
        onSaveOutcome?.({ kind: "saved", bound: j.bound?.length ?? 0 });
        if (j.bound?.length || j.docChanged) onDocRefreshed?.();
      }
    } catch {
      dirtyRef.current = true; // retry on next edit/poll
    } finally {
      savingRef.current = false;
    }
  }

  // Day switch: load the new page's doc + rev.
  useEffect(() => {
    if (!editor) return;
    if (pageIdRef.current !== page.id) {
      if (timerRef.current) clearTimeout(timerRef.current);
      pageIdRef.current = page.id;
      revRef.current = page.rev;
      dirtyRef.current = false;
      editor.commands.setContent(page.doc as never, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, editor]);

  // Adopt server-side writes (mention stamps land via savePageDocInternal):
  // poll rev; when the server is ahead and we're clean + unfocused, refetch.
  usePollWhileVisible(async () => {
    if (!editor || dirtyRef.current || savingRef.current || editor.isFocused) return;
    try {
      const r = await fetch(`/api/v2/pages/${pageIdRef.current}`, { cache: "no-store" });
      const j = await r.json();
      if (j?.page && j.page.rev > revRef.current) {
        revRef.current = j.page.rev;
        adoptDoc(j.page.doc);
        onDocRefreshed?.();
      }
    } catch {
      /* offline */
    }
  }, 5000, [editor]);

  // Flush pending edits on unmount/navigation.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) void save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <style>{`
        .scratchpad-prose { font-size: 13.5px; line-height: 1.7; color: var(--fg, #e8e2f0); }
        .scratchpad-prose p { margin: 0.35em 0; }
        .scratchpad-prose h1, .scratchpad-prose h2, .scratchpad-prose h3 {
          font-weight: 600; letter-spacing: -0.01em; margin: 0.9em 0 0.3em; }
        .scratchpad-prose h1 { font-size: 1.35em; }
        .scratchpad-prose h2 { font-size: 1.18em; }
        .scratchpad-prose h3 { font-size: 1.05em; }
        .scratchpad-prose ul, .scratchpad-prose ol { padding-left: 1.4em; margin: 0.3em 0; }
        .scratchpad-prose ul[data-type="taskList"] { padding-left: 0.2em; list-style: none; }
        .scratchpad-prose blockquote { border-left: 2px solid ${SCRATCHPAD_ACCENT}66;
          padding-left: 0.8em; margin: 0.5em 0; color: var(--fg-dim, #a89fb8); }
        .scratchpad-prose code { font-family: ui-monospace, monospace; font-size: 0.9em;
          background: rgba(255,255,255,0.06); padding: 0.1em 0.35em; border-radius: 4px; }
        .scratchpad-prose pre { background: rgba(255,255,255,0.04); padding: 0.7em 0.9em;
          border-radius: 8px; overflow-x: auto; margin: 0.5em 0;
          border: 1px solid var(--panel-border, #2a2436); }
        .scratchpad-prose hr { border: none; border-top: 1px solid var(--panel-border, #2a2436); margin: 1em 0; }
        .scratchpad-prose p[data-mention-handled] {
          background: ${SCRATCHPAD_ACCENT}0d; border-radius: 6px;
          box-shadow: -3px 0 0 0 ${SCRATCHPAD_ACCENT}66; }
      `}</style>
      <EditorContent editor={editor} />
    </div>
  );
}
