"use client";

import { statuses } from "@/lib/graph";
import { useApp } from "@/lib/store";
import {
  Goal,
  PRIORITY_COLOR,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
  Task,
  TaskStatus,
} from "@/lib/types";
import { useRef, useState } from "react";
import SweepCountdown from "./SweepCountdown";

function Row({
  task,
  status,
  goal,
  selected,
  sweepAt,
}: {
  task: Task;
  status: TaskStatus;
  goal?: Goal;
  selected: boolean;
  /** when this finished task will be swept away, if it is on its way out */
  sweepAt?: number;
}) {
  const { select, setEditorOpen, toggleDone } = useApp();
  const done = status === "done";

  return (
    <div
      data-task-row={task.id}
      data-status={status}
      onClick={() => select(task.id)}
      onDoubleClick={() => {
        select(task.id);
        setEditorOpen(true);
      }}
      className={`group croc-hide flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border ${
        selected
          ? "border-lagoon-400/70 bg-lagoon-950/40"
          : `card-skin status-${status}`
      } ${done ? "opacity-60" : ""}`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleDone(task.id);
        }}
        role="checkbox"
        aria-checked={done}
        aria-label={task.title}
        className={`w-4 h-4 shrink-0 rounded-full border flex items-center justify-center text-note ${
          done
            ? "bg-emerald-500/80 border-emerald-500 text-slate-950"
            : "border-slate-500 hover:border-emerald-400"
        }`}
        title={done ? "reopen" : "mark done (d)"}
      >
        {done ? "✓" : ""}
      </button>
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: PRIORITY_COLOR[task.priority] }}
        title={`P${task.priority}`}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`text-body break-words ${
            done ? "line-through text-slate-500" : "text-slate-200"
          }`}
        >
          {task.title}
        </div>
        <div className="text-note text-slate-500 flex gap-1.5 items-center flex-wrap empty:hidden">
          {sweepAt != null && <SweepCountdown key={sweepAt} at={sweepAt} />}
          {task.dependsOn.length > 0 && (
            <span title="has dependencies">⛓ {task.dependsOn.length}</span>
          )}
          {task.blocked && (
            <span className="text-red-400" title={task.blocked}>
              ⛔ {task.blocked}
            </span>
          )}
          {goal && (
            <span
              className="px-1 rounded-full"
              style={{ backgroundColor: goal.color + "33", color: goal.color }}
            >
              {goal.name}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleDone(task.id);
          }}
          title={done ? "reopen (d)" : "mark done (d)"}
          className="text-note px-1.5 py-0.5 rounded bg-slate-700 hover:bg-emerald-600 text-slate-200"
        >
          {done ? "↺ reopen" : "✓ done"}
        </button>
      </div>
    </div>
  );
}

/**
 * The plan as a list, grouped by the status the graph derives — in-progress
 * first, because that group *is* the answer to "what can I pick up right now".
 * Only the to-do group is draggable: order decides which waiting task leads,
 * and dragging finished work around would mean nothing.
 */
export default function TaskList() {
  const tasks = useApp((s) => s.plan.tasks);
  const goals = useApp((s) => s.plan.goals);
  const selectedId = useApp((s) => s.selectedId);
  const sweepAt = useApp((s) => s.sweepAt);
  const placeBefore = useApp((s) => s.placeBefore);
  const clearDone = useApp((s) => s.clearDone);
  const [showDone, setShowDone] = useState(true);
  // drag & drop: id to insert before; null = end of queue; undefined = not dragging
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  const dragId = useRef<string | null>(null);

  const statusOfId = statuses(tasks);
  const inStatus = (s: TaskStatus) =>
    tasks
      .filter((t) => statusOfId.get(t.id) === s)
      .sort((a, b) => a.order - b.order);

  const goalOf = (t: Task) => goals.find((g) => g.id === t.goalId);
  const groups = STATUS_ORDER.map((s) => ({ status: s, tasks: inStatus(s) }));
  const todo = inStatus("todo");

  return (
    <div className="space-y-3">
      {groups.map(({ status, tasks }) => {
        if (!tasks.length) return null;
        const isDone = status === "done";
        const draggable = status === "todo";
        return (
          <div key={status}>
            <div className="flex items-baseline gap-2 px-2 mb-1">
              <button
                onClick={isDone ? () => setShowDone(!showDone) : undefined}
                disabled={!isDone}
                className={`text-note uppercase tracking-wider ${
                  isDone ? "hover:text-slate-300" : "cursor-default"
                }`}
                style={{ color: STATUS_COLOR[status] }}
              >
                {STATUS_LABEL[status]} · {tasks.length}
                {isDone && (showDone ? " ▾" : " ▸")}
              </button>
              <div className="flex-1" />
              {isDone && (
                <button
                  onClick={clearDone}
                  className="text-note text-slate-600 hover:text-red-400"
                  title="drop the finished tasks off the board (undoable)"
                >
                  clear
                </button>
              )}
            </div>

            {(!isDone || showDone) && (
              <div
                className="space-y-0.5"
                onDragLeave={(e) => {
                  if (e.currentTarget === e.target) setDropBefore(undefined);
                }}
              >
                {tasks.map((t, i) =>
                  draggable ? (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        dragId.current = t.id;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const r = e.currentTarget.getBoundingClientRect();
                        const before = e.clientY < r.top + r.height / 2;
                        setDropBefore(before ? t.id : todo[i + 1]?.id ?? null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId.current && dropBefore !== undefined)
                          placeBefore(dragId.current, dropBefore);
                        dragId.current = null;
                        setDropBefore(undefined);
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                        setDropBefore(undefined);
                      }}
                    >
                      {dropBefore === t.id && (
                        <div className="border-t-2 border-lagoon-400 rounded-full mx-2" />
                      )}
                      <Row
                        task={t}
                        status={status}
                        goal={goalOf(t)}
                        selected={selectedId === t.id}
                        sweepAt={sweepAt[t.id]}
                      />
                    </div>
                  ) : (
                    <Row
                      key={t.id}
                      task={t}
                      status={status}
                      goal={goalOf(t)}
                      selected={selectedId === t.id}
                      sweepAt={sweepAt[t.id]}
                    />
                  )
                )}
                {draggable && dropBefore === null && (
                  <div className="border-t-2 border-lagoon-400 rounded-full mx-2" />
                )}
              </div>
            )}
          </div>
        );
      })}

      {tasks.length === 0 && (
        <p className="text-label text-slate-600 px-2">
          Empty swamp — press <kbd className="kbd">n</kbd> to put a crocodile in
          it.
        </p>
      )}
    </div>
  );
}
