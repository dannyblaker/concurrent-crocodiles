"use client";

import { dependentsOf, statusOf } from "@/lib/graph";
import { useApp } from "@/lib/store";
import {
  PRIORITIES,
  PRIORITY_COLOR,
  STATUS_COLOR,
  STATUS_LABEL,
} from "@/lib/types";

const field =
  "w-full bg-slate-800 border border-slate-700 focus:border-lagoon-500 outline-none rounded px-2 py-1.5 text-body text-slate-200";
const label = "text-note uppercase tracking-wider text-slate-500 mb-1 block";

export default function Editor() {
  const tasks = useApp((s) => s.plan.tasks);
  const goals = useApp((s) => s.plan.goals);
  const selectedId = useApp((s) => s.selectedId);
  const open = useApp((s) => s.editorOpen);
  const { updateTask, deleteTask, setEditorOpen, setDone, toggleDependency } =
    useApp();

  const task = tasks.find((t) => t.id === selectedId);
  if (!open || !task) return null;

  const others = tasks.filter((t) => t.id !== task.id);
  const wouldCycle = dependentsOf(tasks, task.id);
  const status = statusOf(task, new Map(tasks.map((t) => [t.id, t])));
  const waiting = task.dependsOn
    .map((id) => tasks.find((t) => t.id === id))
    .filter((d) => d && !d.done).length;

  return (
    <aside className="w-72 shrink-0 border-l border-slate-800 bg-slate-900/60 p-3 overflow-y-auto space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-note uppercase tracking-wider text-slate-500">
          Edit task
        </h2>
        <button
          onClick={() => setEditorOpen(false)}
          className="text-slate-500 hover:text-slate-300 text-title"
          title="close (esc)"
        >
          ✕
        </button>
      </div>

      {/* Status is read-only on purpose: it follows the graph, and the one
          thing you decide — whether this is finished — is the button below. */}
      <div className={`rounded-md border px-2.5 py-2 card-skin status-${status}`}>
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-label font-medium uppercase tracking-wider"
            style={{ color: STATUS_COLOR[status] }}
          >
            {STATUS_LABEL[status]}
          </span>
          <button
            onClick={() => setDone(task.id, !task.done)}
            className="btn"
            title="the only part of status you set (d)"
          >
            {task.done ? "↺ reopen" : "✓ mark done"}
          </button>
        </div>
        <p className="text-note text-slate-500 mt-1">
          {task.done
            ? "Finished — whatever depends on this is free to start."
            : task.blocked
              ? `Blocked: ${task.blocked}`
              : waiting > 0
                ? `Waiting on ${waiting} unfinished prerequisite${waiting === 1 ? "" : "s"}.`
                : "Every prerequisite is done — this is startable now."}
        </p>
      </div>

      <div>
        <label className={label}>Task description</label>
        <textarea
          className={`${field} h-20 resize-none`}
          value={task.title}
          onChange={(e) => updateTask(task.id, { title: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

      <div>
        <label className={label}>Priority</label>
        <div className="flex gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => updateTask(task.id, { priority: p })}
              className={`flex-1 text-label py-1.5 rounded border ${
                task.priority === p
                  ? "border-slate-400 bg-slate-700"
                  : "border-slate-700 bg-slate-800 hover:bg-slate-700"
              }`}
              style={{ color: PRIORITY_COLOR[p] }}
            >
              P{p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={label}>Goal</label>
        <select
          className={field}
          value={task.goalId || ""}
          onChange={(e) =>
            updateTask(task.id, { goalId: e.target.value || null })
          }
        >
          <option value="">— none —</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Blocked</label>
        <input
          className={field}
          placeholder="reason (empty = not blocked)"
          value={task.blocked || ""}
          onChange={(e) =>
            updateTask(task.id, { blocked: e.target.value || null })
          }
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

      {others.length > 0 && (
        <div>
          <label className={label}>Depends on (must finish first)</label>
          <div className="space-y-0.5 max-h-36 overflow-y-auto border border-slate-800 rounded p-1.5">
            {others.map((o) => {
              const disabled = wouldCycle.has(o.id);
              return (
                <label
                  key={o.id}
                  className={`flex items-center gap-1.5 text-label ${
                    disabled
                      ? "text-slate-700 cursor-not-allowed"
                      : "text-slate-300 cursor-pointer"
                  }`}
                  title={disabled ? "would create a dependency cycle" : ""}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={task.dependsOn.includes(o.id)}
                    onChange={() => toggleDependency(task.id, o.id)}
                    className="accent-lagoon-500"
                  />
                  <span className="truncate">{o.title}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex pt-1">
        <button
          onClick={() => deleteTask(task.id)}
          className="text-label px-2 py-1 rounded border border-red-900 text-red-400 hover:bg-red-950"
        >
          delete
        </button>
      </div>
    </aside>
  );
}
