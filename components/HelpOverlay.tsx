"use client";

import { useApp } from "@/lib/store";
import { STATUS_COLOR, TaskStatus } from "@/lib/types";

const SHORTCUTS: [string, string][] = [
  ["n / c / ⌘K", "add task (quick-add)"],
  ["a", "new task depending on the selected one"],
  ["f / g or ↑ / ↓", "focus previous / next — g follows the arrows on"],
  ["Shift+J / Shift+K", "move task down / up the to-do queue"],
  ["Enter / e", "edit selected task"],
  ["d", "toggle done — dependents become in-progress"],
  ["b", "toggle blocked"],
  ["1 – 3", "set priority P1–P3 — the board re-sorts itself"],
  ["s", "auto-sort queue by priority"],
  ["x / Del", "delete selected task"],
  ["u / ⌘Z", "undo the last clear"],
  ["m", "toggle light / dark theme"],
  ["w", "toggle the animated water canvas"],
  ["?", "this help"],
  ["Esc", "close panels / deselect"],
  ["drag row (list)", "reorder the queue"],
  ["dbl-click crocodile", "edit its description in place — Enter keeps it, Esc doesn't"],
  ["dbl-click row (list)", "open the editor"],
  ["dbl-click canvas", "create task"],
  ["drag canvas", "pan the board — nothing on it is placed by hand"],
  ["🧹 (top bar)", "finished work deletes itself, five seconds after the whole chain is done"],
  ["drag ○ → node", "draw a dependency arrow"],
  ["drag ○ → empty space", "new task on the end of the arrow"],
  ["click ○", "new task depending on that one"],
  ["click arrow", "remove that dependency"],
];

const SYNTAX: [string, string][] = [
  ["!1 … !3", "priority (P1 = do or die)"],
  ["#deep-work", "goal — created if new"],
  [">design", "depends on task whose description starts with “design”"],
  ["*waiting-on-bob", "blocked, with reason"],
  ["^", "front of the to-do queue"],
];

/** What the drawing of a task says, part by part. See CrocShape.tsx. */
const ANATOMY: [string, string][] = [
  ["colour", "its status — murky waiting, gold startable, green finished"],
  ["tail tip", "priority: P1 red, P2 amber, P3 blue"],
  ["eyes", "open while there is work left in it; shut when it's done"],
  ["teeth", "showing on the ones you can start right now"],
  ["the ○ at its snout", "drag from there to say what waits on it"],
];

const STATUSES: [string, string][] = [
  ["In progress", "every prerequisite is done — this one can bite"],
  ["To do", "submerged: waiting on a prerequisite, or blocked"],
  ["Done", "fed. Whatever depended on it surfaces"],
];

export default function HelpOverlay() {
  const open = useApp((s) => s.helpOpen);
  const setHelpOpen = useApp((s) => s.setHelpOpen);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-sm flex items-center justify-center p-6"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-title font-semibold text-slate-200">
            Keyboard shortcuts
          </h2>
          <button
            onClick={() => setHelpOpen(false)}
            className="text-slate-500 hover:text-slate-300"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mb-5">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-2 text-label">
              <kbd className="kbd">{key}</kbd>
              <span className="text-slate-400">{desc}</span>
            </div>
          ))}
        </div>
        <h2 className="text-title font-semibold text-slate-200 mb-2">Status</h2>
        <p className="text-label text-slate-500 mb-2">
          Status is derived from the dependency graph — the only part you set is
          whether a task is done.
        </p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mb-5">
          {STATUSES.map(([name, desc]) => (
            <div key={name} className="flex items-center gap-2 text-label">
              <span
                className={`px-1.5 py-0.5 rounded border text-note whitespace-nowrap card-skin status-${name
                  .toLowerCase()
                  .replace(" ", "-")}`}
                style={{
                  color: STATUS_COLOR[
                    name.toLowerCase().replace(" ", "-") as TaskStatus
                  ],
                }}
              >
                {name}
              </span>
              <span className="text-slate-400">{desc}</span>
            </div>
          ))}
        </div>

        {/* Every task on the canvas is drawn as a crocodile, and the drawing
            carries as much as the colour does — so it needs a legend. */}
        <h2 className="text-title font-semibold text-slate-200 mb-2">
          Reading a crocodile
        </h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mb-5">
          {ANATOMY.map(([part, means]) => (
            <div key={part} className="flex items-baseline gap-2 text-label">
              <span className="text-slate-300 shrink-0 w-24">{part}</span>
              <span className="text-slate-400">{means}</span>
            </div>
          ))}
        </div>

        <h2 className="text-title font-semibold text-slate-200 mb-2">
          Quick-add syntax
        </h2>
        <p className="text-label text-slate-500 mb-2">
          Type a description plus any tokens, e.g.{" "}
          <code className="text-lagoon-300">
            Fix login bug !1 #deep-work &gt;deploy *waiting-on-bob
          </code>
        </p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
          {SYNTAX.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-2 text-label">
              <code className="kbd">{key}</code>
              <span className="text-slate-400">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
