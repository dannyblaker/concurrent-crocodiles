"use client";

import { useApp } from "@/lib/store";
import FlowCanvas from "./FlowCanvas";

/** The editable flowchart: FlowCanvas wired to the store, plus its toolbar. */
export default function FlowView({
  exportRef,
}: {
  exportRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const tasks = useApp((s) => s.plan.tasks);
  const goals = useApp((s) => s.plan.goals);
  const selectedId = useApp((s) => s.selectedId);
  const newTaskFrom = useApp((s) => s.newTaskFrom);
  const sweepAt = useApp((s) => s.sweepAt);
  const { select, updateTask, toggleDependency, toggleDone, quickAdd } =
    useApp();

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-1 pb-2 text-label text-slate-500 flex-wrap">
        <span>the board arranges itself: order left to right, priority top to bottom</span>
        <span>· double-click canvas: new task (quick-add syntax works)</span>
        <span>· double-click a crocodile: retype its description in place</span>
        <span>· drag ○ → node: dependency</span>
        <span>· click ○ or drag it to empty space: new dependent task</span>
        <span>· click arrow: remove</span>
      </div>

      <FlowCanvas
        tasks={tasks}
        goals={goals}
        selectedId={selectedId}
        onSelect={select}
        onRename={(id, title) => updateTask(id, { title })}
        onToggleDependency={toggleDependency}
        onToggleDone={toggleDone}
        onCreate={(input, dependsOn) => {
          const id = quickAdd(input);
          if (!id) return;
          // a new task has no dependents, so this can never close a loop
          if (dependsOn) toggleDependency(id, dependsOn);
        }}
        createFrom={newTaskFrom}
        sweepAt={sweepAt}
        canvasRef={(el) => {
          if (exportRef) exportRef.current = el;
        }}
      />
    </div>
  );
}
