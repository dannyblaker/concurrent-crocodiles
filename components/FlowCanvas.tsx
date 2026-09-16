"use client";

import { FlowPos, layoutFlow } from "@/lib/flow";
import { MOVE_MS, useFlowMotion } from "@/lib/flow-motion";
import { statuses } from "@/lib/graph";
import {
  DONE_COLOR,
  FLOW,
  Goal,
  PRIORITY_COLOR,
  STATUS_LABEL,
  Task,
} from "@/lib/types";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import CrocShape, { BACK, DONE_AT } from "./CrocShape";
import DoneButton from "./DoneButton";
import SweepCountdown from "./SweepCountdown";
import WaterSurface from "./WaterSurface";

const { W, H, NODE_W, NODE_H } = FLOW;

/** how a description is set on a crocodile's back, whether read or being typed */
const labelText = "text-label font-medium break-words";

interface TempEdge {
  sourceId: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

interface Props {
  tasks: Task[];
  goals: Goal[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** the description, retyped on the crocodile's back; omitted by the share view */
  onRename?: (id: string, title: string) => void;
  onToggleDependency?: (taskId: string, depId: string) => void;
  /** omitted by the read-only share view, which draws no done button */
  onToggleDone?: (id: string) => void;
  /**
   * A new task: quick-add text. `dependsOn` is set when the task was started
   * from a node's port, and is the task it waits on. Where on the canvas it was
   * typed doesn't come along, because the layout decides where it goes.
   */
  onCreate?: (input: string, dependsOn?: string) => void;
  /** an outside request (the `a` key) to start a task depending on this one */
  createFrom?: { sourceId: string; nonce: number } | null;
  /** id → when finished work will be swept away, for the countdown on the node.
   *  Omitted by the share view, which watches rather than tidies. */
  sweepAt?: Record<string, number>;
  /** hands the canvas element out for PNG/PDF export */
  canvasRef?: (el: HTMLDivElement | null) => void;
}

/**
 * The flowchart itself: tasks as nodes, dependencies as arrows.
 *
 * Purely props-driven, and read-only when the editing callbacks are omitted —
 * which is how the share view reuses it without a store behind it. That includes
 * where everything is: positions are a function of the tasks (see layoutFlow),
 * so the same graph draws the same board here, in the share view and in an
 * export, and nothing has to be stored or kept in step.
 *
 * The one thing the graph doesn't know is how much room a title takes. A node
 * shows the whole of its text, so it is as tall as the text needs, and that is
 * measured off the label once it is in the DOM and handed back to the layout —
 * which stacks the column accordingly. See `heights` below.
 */
export default function FlowCanvas({
  tasks,
  goals,
  selectedId,
  onSelect,
  onRename,
  onToggleDependency,
  onToggleDone,
  onCreate,
  createFrom,
  sweepAt,
  canvasRef: exposeCanvas,
}: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [tempEdge, setTempEdge] = useState<TempEdge | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [creating, setCreating] = useState<{
    pos: FlowPos;
    dependsOn?: string;
  } | null>(null);
  const [createText, setCreateText] = useState("");
  // the label being retyped in place, and what it says so far
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  );

  // Everything derived from the graph is memoised on the tasks, because a move
  // renders this component every frame for a second: the positions change, the
  // graph behind them doesn't.
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const statusOfId = useMemo(() => statuses(tasks), [tasks]);

  // ── node heights ───────────────────────────────────────────────
  //
  // How tall each task is: its label, plus the crocodile around it, and never
  // less than NODE_H. Read off the DOM after every render that could have
  // changed a label, synchronously so the corrected layout paints instead of
  // the guessed one; and watched after that, for the font arriving late.
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  // `snap` comes with the first measurement and is cleared once drawn: the
  // layout it brings is taken up in place rather than slid into, because
  // nothing has been on screen yet for a task to slide from
  const [heights, setHeights] = useState<{
    of: Map<string, number>;
    snap: boolean;
  }>({ of: new Map(), snap: false });
  const heightOf = (t: Task) => heights.of.get(t.id) ?? NODE_H;

  const measure = useCallback(() => {
    setHeights((was) => {
      let changed = was.of.size !== labelRefs.current.size;
      const next = new Map<string, number>();
      for (const [id, el] of labelRefs.current) {
        const h = Math.max(
          NODE_H,
          Math.ceil(el.offsetHeight + BACK.top + BACK.bottom)
        );
        next.set(id, h);
        if (was.of.get(id) !== h) changed = true;
      }
      return changed ? { of: next, snap: !was.of.size } : was;
    });
  }, []);
  // `goals` and `sweepAt` are there because they change what the label says
  useLayoutEffect(measure, [measure, tasks, goals, sweepAt]);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    for (const el of labelRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
    // re-observed whenever the set of labels can have changed
  }, [measure, tasks]);

  // where the graph says everything belongs, and where it has got to on the way
  const layout = useFlowMotion(
    useMemo(() => layoutFlow(tasks, heights.of), [tasks, heights.of]),
    MOVE_MS,
    heights.snap
  );
  // consumed: the next layout is a move like any other. Adjusted during render
  // (like `createFrom` below) so no frame is drawn with the flag still up.
  if (heights.snap) setHeights({ of: heights.of, snap: false });
  // a task swept or deleted while its label was being retyped takes the edit with it
  if (editing && !byId.has(editing.id)) setEditing(null);
  // the board is as tall as it needs to be, and at least what it always was
  const boardH = Math.max(
    H,
    ...tasks.map((t) => (layout.get(t.id)?.y ?? 0) + heightOf(t) + 40)
  );

  const pos = (t: Task): FlowPos => layout.get(t.id) ?? { x: 0, y: 0 };
  const outAnchor = (t: Task) => {
    const p = pos(t);
    return { x: p.x + NODE_W, y: p.y + heightOf(t) / 2 };
  };
  const inAnchor = (t: Task) => {
    const p = pos(t);
    return { x: p.x, y: p.y + heightOf(t) / 2 };
  };
  const canvasPoint = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  /**
   * First free spot to the right of a node: where the input asking for its next
   * dependent opens. Only the input goes there — the task it names is placed by
   * the layout, in the column its new dependency earns it.
   */
  const rightOf = (t: Task): FlowPos => {
    const p = pos(t);
    const x = p.x + NODE_W + 60;
    const column = tasks
      .filter((o) => o.id !== t.id)
      .map((o) => ({ ...pos(o), h: heightOf(o) }))
      .filter((q) => Math.abs(q.x - x) < NODE_W);
    let y = p.y;
    const clear = () =>
      column.every((q) => y + NODE_H + 12 <= q.y || q.y + q.h + 12 <= y);
    while (!clear() && y < boardH - NODE_H) y += NODE_H + 28;
    return { x, y };
  };

  /** open the inline input; `dependsOn` wires what it creates to a prerequisite */
  const openCreate = (p: FlowPos, dependsOn?: string) => {
    if (!onCreate) return;
    setCreating({
      pos: {
        x: Math.max(0, Math.min(W - 260, p.x)),
        y: Math.max(0, Math.min(boardH - 60, p.y)),
      },
      dependsOn,
    });
    setCreateText("");
  };

  // The `a` key, arriving as a prop: the same input, opened beside the task.
  // Adjusted during render rather than in an effect, so the input is there in
  // the pass that answers the keypress. The nonce is what makes it once-only.
  const [servedRequest, setServedRequest] = useState<number | null>(null);
  if (createFrom && createFrom.nonce !== servedRequest) {
    setServedRequest(createFrom.nonce);
    const t = byId.get(createFrom.sourceId);
    if (t) openCreate(rightOf(t), t.id);
  }

  const edgePath = (sx: number, sy: number, tx: number, ty: number) => {
    const c = Math.max(40, Math.abs(tx - sx) / 2);
    return `M ${sx} ${sy} C ${sx + c} ${sy}, ${tx - c} ${ty}, ${tx} ${ty}`;
  };

  // ── dependency drawing (drag from a node's ○ port) ─────────────
  //
  // Three endings, all of them the same sentence: something waits on this task.
  // Let go over another node and that node waits on it; let go over empty
  // canvas — or just click the port — and you get a new task that does.
  const onPortPointerDown = (e: React.PointerEvent, t: Task) => {
    if (!onToggleDependency || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const a = outAnchor(t);
    const start = canvasPoint(e.clientX, e.clientY);
    let moved = false;
    setTempEdge({ sourceId: t.id, sx: a.x, sy: a.y, tx: a.x, ty: a.y });
    const move = (ev: PointerEvent) => {
      const c = canvasPoint(ev.clientX, ev.clientY);
      if (Math.abs(c.x - start.x) > 4 || Math.abs(c.y - start.y) > 4)
        moved = true;
      setTempEdge((te) => (te ? { ...te, tx: c.x, ty: c.y } : te));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      setTempEdge(null);
      if (!moved) return openCreate(rightOf(t), t.id);

      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetId = under
        ?.closest("[data-flow-node]")
        ?.getAttribute("data-flow-node");
      if (targetId) {
        const target = byId.get(targetId);
        // add-only: toggling an existing edge here would silently remove it
        if (targetId !== t.id && target && !target.dependsOn.includes(t.id))
          onToggleDependency(targetId, t.id);
        return;
      }
      // dropped on nothing: the arrow needs a task on the end of it. Only if
      // that nothing is our own canvas — let go over the sidebar and it's a
      // cancel, same as it looks.
      if (!canvasRef.current?.contains(under)) return;
      const c = canvasPoint(ev.clientX, ev.clientY);
      openCreate({ x: c.x, y: c.y - NODE_H / 2 }, t.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // ── canvas panning + double-click create ───────────────────────
  //
  // The board pans from anywhere, crocodiles included: nothing on it is placed
  // by hand, so pressing on a node and moving can only mean "shift the water".
  // The port is the exception, and says so by stopping the event.
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sc = scrollRef.current;
    if (!sc) return;
    const sx = e.clientX,
      sy = e.clientY,
      sl = sc.scrollLeft,
      st = sc.scrollTop;
    const move = (ev: PointerEvent) => {
      // a pan that began on a node is not a click on that node
      if (Math.abs(ev.clientX - sx) > 4 || Math.abs(ev.clientY - sy) > 4)
        suppressClick.current = true;
      sc.scrollLeft = sl - (ev.clientX - sx);
      sc.scrollTop = st - (ev.clientY - sy);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      if (suppressClick.current)
        setTimeout(() => (suppressClick.current = false), 50);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    if (!onCreate || e.target !== e.currentTarget) return;
    openCreate(canvasPoint(e.clientX, e.clientY));
  };

  const commitCreate = () => {
    if (onCreate && creating && createText.trim())
      onCreate(createText, creating.dependsOn);
    setCreating(null);
  };

  // ── editing in place ───────────────────────────────────────────
  //
  // Double-click a crocodile and its label becomes a box on its back, the same
  // size and type as the label was, so nothing appears to change except that
  // the caret is there. The crocodile grows around the box as it does around
  // the label — it is measured the same way — so a longer description makes a
  // fatter crocodile while it is still being typed.
  const commitEdit = () => {
    if (!editing) return;
    const next = editing.text.trim();
    const was = byId.get(editing.id)?.title;
    // a description can't be emptied here: nothing typed means nothing changed
    if (onRename && next && next !== was) onRename(editing.id, next);
    setEditing(null);
  };

  // the not-yet-drawn arrow, held while you type the task on the end of it
  const pendingSource = creating?.dependsOn
    ? byId.get(creating.dependsOn)
    : undefined;

  // ── edges ──────────────────────────────────────────────────────
  // which pairs are joined is graph, not geometry; only the path is redrawn
  const edges = useMemo(() => {
    const out: { key: string; from: Task; to: Task }[] = [];
    for (const t of tasks)
      for (const depId of t.dependsOn) {
        const dep = byId.get(depId);
        if (dep) out.push({ key: `${depId}->${t.id}`, from: dep, to: t });
      }
    return out;
  }, [tasks, byId]);

  return (
    <div
      ref={scrollRef}
      /* a size container, so the water inside can be exactly the size of what
         you can see of the board rather than of the window — see .croc-surface */
      className="croc-port flex-1 min-h-0 overflow-auto rounded-lg border border-slate-800"
    >
      <div
        ref={(el) => {
          canvasRef.current = el;
          exposeCanvas?.(el);
        }}
        onPointerDown={onCanvasPointerDown}
        onDoubleClick={onCanvasDoubleClick}
        className="croc-water relative bg-background cursor-grab"
        style={{ width: W, height: boardH }}
      >
        {/* the water, when the canvas is dressed as water — see globals.css */}
        <WaterSurface />

        {/* dependency edges */}
        <svg
          className="absolute inset-0"
          width={W}
          height={boardH}
          style={{ pointerEvents: "none" }}
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {edges.map(({ key, from, to }) => {
            const s = outAnchor(from);
            const e2 = inAnchor(to);
            const d = edgePath(s.x, s.y, e2.x, e2.y);
            const involved = selectedId === from.id || selectedId === to.id;
            const stroke =
              hoverEdge === key
                ? "var(--edge-hover)"
                : involved
                  ? "var(--edge-active)"
                  : // a satisfied prerequisite is history — fade the arrow out
                    from.done
                    ? "var(--edge-dim)"
                    : "var(--edge)";
            return (
              <g
                key={key}
                onClick={
                  onToggleDependency
                    ? () => onToggleDependency(to.id, from.id)
                    : undefined
                }
                onMouseEnter={() => setHoverEdge(key)}
                onMouseLeave={() => setHoverEdge(null)}
                className={onToggleDependency ? "cursor-pointer" : undefined}
              >
                <title>
                  {from.title} → {to.title}
                  {onToggleDependency ? " — click to remove" : ""}
                </title>
                <path
                  d={d}
                  stroke="transparent"
                  strokeWidth={14}
                  fill="none"
                  style={{ pointerEvents: "stroke" }}
                />
                {/* stroke goes through `style`: a var() in the SVG
                    presentation attribute wouldn't resolve */}
                <path
                  d={d}
                  style={{ stroke }}
                  strokeWidth={1.5}
                  fill="none"
                  markerEnd="url(#flow-arrow)"
                />
              </g>
            );
          })}
        </svg>

        {/* nodes */}
        {tasks.map((t) => {
          const p = pos(t);
          const goal = goals.find((g) => g.id === t.goalId);
          const status = statusOfId.get(t.id)!;
          const done = status === "done";
          const labelTone = done
            ? "line-through text-slate-500"
            : "text-slate-100";
          return (
            <div
              key={t.id}
              data-flow-node={t.id}
              onClick={
                onSelect
                  ? (e) => {
                      e.stopPropagation();
                      if (!suppressClick.current) onSelect(t.id);
                    }
                  : undefined
              }
              onDoubleClick={
                onRename
                  ? (e) => {
                      e.stopPropagation();
                      setEditing({ id: t.id, text: t.title });
                    }
                  : undefined
              }
              title={`${t.title} — ${STATUS_LABEL[status]}`}
              className={`group croc-node absolute z-10 select-none cursor-grab status-${status} ${
                done ? "opacity-60" : ""
              } ${selectedId === t.id ? "is-selected" : ""}`}
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: heightOf(t),
                touchAction: "none",
                ["--croc-tail-fill" as string]: done
                  ? DONE_COLOR
                  : PRIORITY_COLOR[t.priority],
              }}
            >
              <CrocShape status={status} done={done} height={heightOf(t)} />

              {/* the label, on the flat of its back. It is as tall as its text
                  and nothing is clipped: the node is sized from it (see
                  `measure`), so the crocodile grows around a long title rather
                  than cutting it short. */}
              <div
                ref={(el) => {
                  if (el) labelRefs.current.set(t.id, el);
                  else labelRefs.current.delete(t.id);
                }}
                className="absolute"
                style={{
                  left: BACK.left,
                  right: BACK.right,
                  top: BACK.top,
                }}
              >
                {editing?.id === t.id ? (
                  /* Sized by a mirror of its own text in the same grid cell,
                     so the box is as tall as the words and no taller — and
                     the label wrapper, which the crocodile is measured from,
                     grows with it. */
                  <div className="grid">
                    <textarea
                      autoFocus
                      aria-label="Task description"
                      rows={1}
                      value={editing.text}
                      onChange={(e) =>
                        setEditing({ id: t.id, text: e.target.value })
                      }
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitEdit();
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                      /* typing and selecting text is not a pan, a select or
                         another double-click on the crocodile underneath */
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className={`${labelText} ${labelTone} [grid-area:1/1/2/2] w-full select-text cursor-text bg-transparent border-0 outline-none resize-none p-0 m-0 overflow-hidden caret-lagoon-400`}
                    />
                    <div
                      aria-hidden
                      className={`${labelText} [grid-area:1/1/2/2] invisible whitespace-pre-wrap`}
                    >
                      {editing.text + " "}
                    </div>
                  </div>
                ) : (
                  <div className={`${labelText} ${labelTone}`}>{t.title}</div>
                )}
                {/* the small print wraps onto as many rows as it needs.
                    `empty:hidden` so a task with nothing to say drops the row
                    rather than leaving a gap under its title. */}
                <div className="text-note text-slate-400 flex flex-wrap gap-x-1.5 gap-y-0.5 items-center mt-0.5 empty:hidden">
                  {sweepAt?.[t.id] != null && (
                    <SweepCountdown key={sweepAt[t.id]} at={sweepAt[t.id]} />
                  )}
                  {goal && (
                    <span
                      className="px-1 rounded-full break-words min-w-0"
                      style={{
                        backgroundColor: goal.color + "33",
                        color: goal.color,
                      }}
                    >
                      {goal.name}
                    </span>
                  )}
                  {t.blocked && (
                    <span
                      className="text-red-400 break-words min-w-0"
                      title={t.blocked}
                    >
                      ⛔ {t.blocked}
                    </span>
                  )}
                </div>
              </div>
              {onToggleDone && (
                <DoneButton
                  done={done}
                  onToggle={() => onToggleDone(t.id)}
                  style={{ right: DONE_AT.right, bottom: DONE_AT.bottom }}
                />
              )}
              {/* out-port: drag to another node to create a dependency */}
              {onToggleDependency && (
                <div
                  onPointerDown={(e) => onPortPointerDown(e, t)}
                  className="absolute -right-[7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-slate-400 bg-background hover:border-lagoon-400 hover:bg-lagoon-950 cursor-crosshair"
                  title="drag to another task, or click for a new one: it will depend on this one"
                  style={{ touchAction: "none" }}
                />
              )}
            </div>
          );
        })}

        {/* the arrow being drawn, or the one waiting on a task to be named */}
        {(tempEdge || pendingSource) && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={W}
            height={boardH}
            style={{ zIndex: 40 }}
          >
            {tempEdge && (
              <path
                d={edgePath(tempEdge.sx, tempEdge.sy, tempEdge.tx, tempEdge.ty)}
                style={{ stroke: "var(--edge-active)" }}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="none"
                markerEnd="url(#flow-arrow)"
              />
            )}
            {pendingSource && creating && (
              <path
                d={edgePath(
                  outAnchor(pendingSource).x,
                  outAnchor(pendingSource).y,
                  creating.pos.x,
                  creating.pos.y + 17
                )}
                style={{ stroke: "var(--edge-active)" }}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="none"
                markerEnd="url(#flow-arrow)"
              />
            )}
          </svg>
        )}

        {/* inline create input */}
        {creating && (
          <input
            autoFocus
            value={createText}
            onChange={(e) => setCreateText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitCreate();
              if (e.key === "Escape") setCreating(null);
            }}
            onBlur={() => setCreating(null)}
            placeholder={
              pendingSource
                ? `New task after “${pendingSource.title}”…`
                : "New task…  !1 #goal"
            }
            className="absolute z-40 w-60 bg-slate-800 border border-lagoon-500 outline-none rounded-md px-2.5 py-1.5 text-label text-slate-200 placeholder:text-slate-600 shadow-xl"
            style={{ left: creating.pos.x, top: creating.pos.y }}
          />
        )}
      </div>
    </div>
  );
}
