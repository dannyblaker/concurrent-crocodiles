import { flowDepths, urgencies } from "./graph";
import { FLOW, Task } from "./types";

export interface FlowPos {
  x: number;
  y: number;
}

/** x of the column a task at this dependency depth belongs in. */
export const columnX = (depth: number) => 40 + depth * (FLOW.NODE_W + 60);

/** the gap between two tasks stacked in one column */
export const ROW_GAP = 28;

/** y of the nth task stacked in one column, when every task is the usual height. */
export const rowY = (i: number) => 40 + i * (FLOW.NODE_H + ROW_GAP);

/**
 * The order the keyboard walks the board: downstream, left to right.
 *
 * Pressing on from a task goes to what waits on it, because following an arrow
 * forwards is reading the plan in the direction the work runs. So a chain is
 * walked end to end before the next one starts, rather than the walk dropping
 * down a column and leaving you to find where the arrow went. Where a task has
 * several dependents the topmost is taken first, and chains are started from the
 * far left — the same order the board is drawn in, so the walk is the thing you
 * are looking at and not a second order kept behind it.
 *
 * Every task appears exactly once. One with two prerequisites belongs to
 * whichever chain reaches it first; anything a cycle keeps out of the walk is
 * picked up at the end, because unreachable by keyboard is worse than out of
 * order.
 */
export function navOrder(tasks: Task[]): string[] {
  const pos = layoutFlow(tasks);
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const onBoard = (a: string, b: string) =>
    at(a).y - at(b).y || at(a).x - at(b).x;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependents = new Map<string, string[]>();
  for (const t of tasks)
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) continue;
      const waiting = dependents.get(dep);
      if (waiting) waiting.push(t.id);
      else dependents.set(dep, [t.id]);
    }
  for (const waiting of dependents.values()) waiting.sort(onBoard);

  const seen = new Set<string>();
  const order: string[] = [];
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const next of dependents.get(id) ?? []) walk(next);
  };

  const all = tasks.map((t) => t.id).sort(onBoard);
  // a task with nothing before it is the head of a chain; those go first
  for (const id of all)
    if (!byId.get(id)!.dependsOn.some((d) => byId.has(d))) walk(id);
  for (const id of all) walk(id);
  return order;
}

/**
 * Where every task sits, as a pure function of the graph.
 *
 * No position is stored anywhere. The board reads left to right by dependency
 * depth — what has to happen first is on the left — and top to bottom by
 * urgency, which is the priority a task inherits from whatever is waiting on it
 * (see urgencies()). So the important work is along the top, and so is
 * everything it needs, in the order it needs it: a P1 five prerequisites deep
 * drags the whole chain up with it rather than sitting above unrelated work.
 *
 * Within one band of equal urgency, a task follows its prerequisites — it lands
 * level with the average row of what it waits on, which keeps a chain running
 * straight across instead of stitching between rows. Columns are laid out left
 * to right so that pull always reads positions that are already decided.
 *
 * A task is FLOW.NODE_H tall unless `heights` says otherwise: a node grows to
 * fit its title rather than cutting it short, and whatever is stacked under it
 * moves down to make room. The heights come from the DOM, so the canvas passes
 * them in; without them the board is laid out as if every task were one line.
 */
export function layoutFlow(
  tasks: Task[],
  heights?: Map<string, number>
): Map<string, FlowPos> {
  const depths = flowDepths(tasks);
  const urgency = urgencies(tasks);

  const columns = new Map<number, Task[]>();
  for (const t of tasks) {
    const depth = depths.get(t.id) ?? 0;
    const column = columns.get(depth);
    if (column) column.push(t);
    else columns.set(depth, [t]);
  }

  const out = new Map<string, FlowPos>();
  for (const depth of [...columns.keys()].sort((a, b) => a - b)) {
    const column = columns.get(depth)!;
    const pull = new Map(
      column.map((t) => {
        const ys = t.dependsOn
          .map((id) => out.get(id)?.y)
          .filter((y): y is number => y != null);
        return [t.id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0];
      })
    );
    column.sort(
      (a, b) =>
        urgency.get(a.id)! - urgency.get(b.id)! ||
        pull.get(a.id)! - pull.get(b.id)! ||
        a.priority - b.priority ||
        a.order - b.order
    );
    let y = rowY(0);
    for (const t of column) {
      out.set(t.id, { x: columnX(depth), y });
      y += (heights?.get(t.id) ?? FLOW.NODE_H) + ROW_GAP;
    }
  }
  return out;
}
