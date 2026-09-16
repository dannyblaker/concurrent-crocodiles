/**
 * Three levels, and deliberately no fourth. The board sorts itself top to bottom
 * by priority, so a level that means "never" would only make the canvas longer.
 */
export type Priority = 1 | 2 | 3;
export const PRIORITIES: Priority[] = [1, 2, 3];

/**
 * Anything into one of the three: missing is P3, and out of range is clamped
 * rather than refused. So a document naming a level this app doesn't have still
 * opens — a `4` arrives as a P3, and the task survives its label.
 */
export const asPriority = (v: number | null | undefined): Priority =>
  v == null || Number.isNaN(v)
    ? 3
    : (Math.min(3, Math.max(1, Math.round(v))) as Priority);
export type TaskStatus = "todo" | "in-progress" | "done";

export interface Task {
  id: string;
  /** The one piece of text a task carries: what it is, and anything worth saying about it. */
  title: string;
  priority: Priority;
  goalId?: string | null;
  dependsOn: string[];
  /** blocker reason; non-null means blocked */
  blocked?: string | null;
  /**
   * The only piece of status that is stored, because it is the only one you
   * assert: to-do and in-progress fall out of the graph. See statusOf().
   */
  done: boolean;
  order: number;
  createdAt: number;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  "in-progress": "In progress",
  done: "Done",
};

/** How the app lists work: what you can do now, then what is waiting, then what is finished. */
export const STATUS_ORDER: TaskStatus[] = ["in-progress", "todo", "done"];

/**
 * Status accent — the dot in the list, the text in the editor. The node and row
 * skins are the matching `.status-*` classes; both sets of hues live in
 * globals.css so they follow the theme.
 */
export const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "var(--status-todo)",
  "in-progress": "var(--status-progress)",
  done: "var(--status-done)",
};

/**
 * Flowchart canvas geometry (shared by the view and the layout).
 *
 * A node is the size it is because a crocodile is drawn in it: long enough for a
 * snout at one end and a tail at the other, and tall enough for four legs, with
 * the flat of its back left over for the label. It is close to the size of the
 * plain card it replaced because the crocodile is built out of blocks rather than
 * curves, and blocks stay legible small. See components/CrocShape.tsx.
 */
export const FLOW = {
  W: 3000,
  H: 1500,
  NODE_W: 300,
  NODE_H: 104,
};

export interface Goal {
  id: string;
  name: string;
  color: string;
}

/**
 * The whole plan: one flat graph of work, with no date on it.
 *
 * Nothing here needs a calendar. A dependency graph is a statement about order —
 * what has to happen before what — and never about when, so there is nowhere in
 * the document for a day to go.
 */
export interface Plan {
  goals: Goal[];
  tasks: Task[];
  shareToken: string;
}

/** Priority accents. Theme-aware: the actual hues live in globals.css. */
export const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--prio-1)",
  2: "var(--prio-2)",
  3: "var(--prio-3)",
};
export const DONE_COLOR = "var(--prio-done)";

/** Goal accents, drawn from the swamp: water, reeds, sun, clay, orchid. */
export const GOAL_COLORS = [
  "#3fbfae",
  "#e0a92e",
  "#6cbf4a",
  "#e0765f",
  "#4fa8d8",
  "#b98adf",
  "#f0a05a",
  "#9dcf3f",
];

