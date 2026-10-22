"use client";

// ── HomeGrid (SPEC-D §6.5, H2.1 + H2.2) ─────────────────────────────────────
// The widget grid: reads settings.home.cells (DEFAULT_HOME_CELLS fallback via
// resolveHomeCells), 3-col CSS grid (1-col below md), size S=1 / M=2 / L=3
// columns, renders a WidgetShell per cell in `order`.
//
// H2.2 edit mode (decision 9 — hand-rolled HTML5 DnD, mouse-first, mirroring
// the Sidebar customize pattern): the Customize toggle arms per-cell controls
// (drag-reorder via draggable/onDragEnter/onDrop, size cycle S→M→L→S, remove,
// per-cell config form) plus the WidgetPicker. Every mutation edits a working
// copy and saves DEBOUNCED (800 ms) through useSettings().save({home:{cells}})
// — the settings PATCH deep-merge replaces arrays, so a full cells array per
// save is correct. Done flushes; Cancel restores the enter-time snapshot.
// One crashing widget shows an inline error panel only (WidgetShell boundary).

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useSettings } from "@/components/ConfigMenu";
import { getWidget } from "@/lib/v2/widgets/registry";
import {
  DEFAULT_HOME_CELLS,
  resolveHomeCells,
  type HomeCell,
  type HomeCellsKey,
  type WidgetDef,
  type WidgetSize,
} from "@/lib/v2/widgets/types";
import WidgetConfigForm from "./WidgetConfigForm";
import WidgetPicker from "./WidgetPicker";
import WidgetShell from "./WidgetShell";
import { WIDGET_COMPONENTS } from "./widgetComponents";

// Literal Tailwind classes on purpose (JIT scans source text): span applies
// only ≥md — below md the grid is 1-col and every cell is full width.
const SPAN_CLASS: Record<WidgetSize, string> = {
  S: "md:col-span-1",
  M: "md:col-span-2",
  L: "md:col-span-3",
};

/** Size cycle button order (§6.5): S → M → L → S. */
const NEXT_SIZE: Record<WidgetSize, WidgetSize> = { S: "M", M: "L", L: "S" };

const SAVE_DEBOUNCE_MS = 800;

function renumber(cells: HomeCell[]): HomeCell[] {
  return cells.map((c, i) => ({ ...c, order: i }));
}

/** Seed a new cell's config from the schema defaults (picker adds). */
function defaultConfig(def: WidgetDef): Record<string, unknown> | undefined {
  const entries = (def.configSchema ?? [])
    .filter((f) => f.default !== undefined)
    .map((f) => [f.key, f.default] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function HeaderButton({
  onClick,
  accent,
  title,
  children,
}: {
  onClick: () => void;
  accent?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11px]"
      style={{
        border: `1px solid ${accent ? `${accent}55` : "var(--panel-border, #2a2436)"}`,
        color: accent ?? "var(--fg-dim, #9aa)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * S32: the same grid hosts the Today page's widgets. `cellsKey` picks the
 * list under settings.home ("cells" = Mission Control, "todayCells" = Today);
 * Today starts EMPTY (no legacy wrappers) and shows `emptyHint` until a widget
 * is added, persisted the same way (useSettings().save, debounced).
 */
export default function HomeGrid({
  cellsKey = "cells",
  emptyHint,
}: {
  cellsKey?: HomeCellsKey;
  emptyHint?: string;
} = {}) {
  const { settings, save } = useSettings();
  const fallback = cellsKey === "cells" ? DEFAULT_HOME_CELLS : [];
  // While settings load (null) the defaults render — same layout in the
  // common unset case, so there is no flash for a stock install.
  const persisted = resolveHomeCells((settings?.home as Record<string, unknown> | undefined)?.[cellsKey], fallback);

  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<HomeCell[] | null>(null); // edit-mode working copy
  const snapshotRef = useRef<HomeCell[]>([]); // Cancel restores this
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configCellId, setConfigCellId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const cells = edit && draft ? draft : persisted;

  const scheduleSave = useCallback(
    (next: HomeCell[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void save({ home: { [cellsKey]: next } });
      }, SAVE_DEBOUNCE_MS);
    },
    [save, cellsKey],
  );

  /** Every edit-mode mutation goes through here: working copy + debounced save. */
  const mutate = useCallback(
    (fn: (cells: HomeCell[]) => HomeCell[]) => {
      setDraft((cur) => {
        const next = renumber(fn(cur ?? persisted));
        scheduleSave(next);
        return next;
      });
    },
    [persisted, scheduleSave],
  );

  const enterEdit = () => {
    snapshotRef.current = persisted;
    setDraft(persisted);
    setEdit(true);
  };

  const exitEdit = () => {
    setEdit(false);
    setDraft(null);
    setPickerOpen(false);
    setConfigCellId(null);
    setDragId(null);
    setOverId(null);
  };

  const done = () => {
    // Flush any pending debounce immediately so a hard refresh keeps the layout.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (draft) void save({ home: { [cellsKey]: draft } });
    exitEdit();
  };

  const cancel = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Debounced saves may already have landed mid-edit — restore the snapshot.
    void save({ home: { [cellsKey]: snapshotRef.current } });
    exitEdit();
  };

  /** Sidebar customize pattern: drop dragged cell before the target ('__end__' appends). */
  const move = (sourceId: string, targetId: string) => {
    mutate((cur) => {
      const source = cur.find((c) => c.id === sourceId);
      if (!source || sourceId === targetId) return cur;
      const rest = cur.filter((c) => c.id !== sourceId);
      if (targetId === "__end__") return [...rest, source];
      const at = rest.findIndex((c) => c.id === targetId);
      if (at < 0) return cur;
      return [...rest.slice(0, at), source, ...rest.slice(at)];
    });
  };

  const addWidget = (def: WidgetDef) => {
    mutate((cur) => [
      ...cur,
      {
        id: `cell-${def.slug}-${Date.now().toString(36)}`,
        widgetSlug: def.slug,
        size: def.defaultSize,
        order: cur.length,
        ...(defaultConfig(def) ? { config: defaultConfig(def) } : {}),
      },
    ]);
    setPickerOpen(false);
  };

  const configCell = configCellId ? cells.find((c) => c.id === configCellId) ?? null : null;
  const configDef = configCell ? getWidget(configCell.widgetSlug) : null;

  return (
    <section aria-label="Home widgets">
      <div className="mb-2 flex items-center justify-end gap-1.5">
        {edit ? (
          <>
            <HeaderButton onClick={() => setPickerOpen(true)} accent="#7dd3a8" title="Add a widget from the catalog">
              <Plus size={12} /> Add widget
            </HeaderButton>
            <HeaderButton onClick={cancel} title="Discard this session's layout changes">
              <RotateCcw size={12} /> Cancel
            </HeaderButton>
            <HeaderButton onClick={done} accent="#34d399" title="Keep the layout">
              <Check size={12} /> Done
            </HeaderButton>
          </>
        ) : (
          <HeaderButton onClick={enterEdit} title="Customize the widget grid (drag, resize, add, remove)">
            <SlidersHorizontal size={12} /> Customize
          </HeaderButton>
        )}
      </div>

      {cells.length === 0 && !edit ? (
        <div
          className="rounded-xl px-4 py-6 text-center text-[12.5px]"
          style={{ border: "1px dashed var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
        >
          {emptyHint ?? "No widgets here yet. Customize, then Add widget."}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cells.map((cell) => {
          const def = getWidget(cell.widgetSlug);
          if (!def) {
            // A layout row pointing at a slug the registry no longer carries —
            // inline notice, never a crash (and never silently dropped).
            return (
              <div
                key={cell.id}
                className="rounded-xl px-3 py-2.5 font-mono text-[11px] md:col-span-1"
                style={{ border: "1px dashed var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
              >
                unknown widget '{cell.widgetSlug}'
                {edit ? (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => mutate((cur) => cur.filter((c) => c.id !== cell.id))}
                  >
                    remove
                  </button>
                ) : null}
              </div>
            );
          }
          const Widget = WIDGET_COMPONENTS[cell.widgetSlug];
          return (
            <div
              key={cell.id}
              className={`min-w-0 ${SPAN_CLASS[cell.size]}`}
              draggable={edit}
              onDragStart={edit ? () => setDragId(cell.id) : undefined}
              onDragEnter={edit ? () => setOverId(cell.id) : undefined}
              onDragOver={edit ? (e) => e.preventDefault() : undefined}
              onDrop={
                edit
                  ? () => {
                      if (dragId) move(dragId, cell.id);
                      setDragId(null);
                      setOverId(null);
                    }
                  : undefined
              }
              onDragEnd={
                edit
                  ? () => {
                      setDragId(null);
                      setOverId(null);
                    }
                  : undefined
              }
              style={
                edit
                  ? {
                      cursor: "grab",
                      opacity: dragId === cell.id ? 0.4 : 1,
                      borderTop:
                        overId === cell.id && dragId && dragId !== cell.id
                          ? "2px solid #7dd3a8"
                          : "2px solid transparent",
                    }
                  : undefined
              }
            >
              <WidgetShell
                cell={cell}
                def={def}
                edit={edit}
                onConfigure={def.configSchema?.length ? () => setConfigCellId(cell.id) : undefined}
                onSizeCycle={() =>
                  mutate((cur) =>
                    cur.map((c) => (c.id === cell.id ? { ...c, size: NEXT_SIZE[c.size] } : c)),
                  )
                }
                onRemove={() => mutate((cur) => cur.filter((c) => c.id !== cell.id))}
              >
                {Widget ? (
                  <Widget config={cell.config ?? {}} cellId={cell.id} />
                ) : (
                  <div className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    '{cell.widgetSlug}' has no component registered
                  </div>
                )}
              </WidgetShell>
            </div>
          );
        })}
        {edit ? (
          // End drop zone (Sidebar '__end__' pattern) — drop here to append.
          <div
            onDragEnter={() => setOverId("__end__")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragId) move(dragId, "__end__");
              setDragId(null);
              setOverId(null);
            }}
            className="h-10 rounded-xl md:col-span-3"
            style={{
              border:
                overId === "__end__" && dragId
                  ? "2px solid #7dd3a8"
                  : "1px dashed var(--panel-border, #2a2436)",
            }}
            aria-label="Drop here to move a widget to the end"
          />
        ) : null}
      </div>

      {pickerOpen ? <WidgetPicker onAdd={addWidget} onClose={() => setPickerOpen(false)} /> : null}
      {configCell && configDef ? (
        <WidgetConfigForm
          def={configDef}
          config={configCell.config ?? {}}
          onCancel={() => setConfigCellId(null)}
          onSave={(config) => {
            mutate((cur) => cur.map((c) => (c.id === configCell.id ? { ...c, config } : c)));
            setConfigCellId(null);
          }}
        />
      ) : null}
    </section>
  );
}
