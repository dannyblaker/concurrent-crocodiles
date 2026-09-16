import { cycleOf } from "./graph";
import { parseQuickAdd } from "./parse";
import { GOAL_COLORS, Goal, Plan, Task, asPriority } from "./types";

/**
 * Every write the API can make to a plan, as pure functions.
 *
 * The store in `store.ts` is the browser's copy of these moves, tangled up with
 * selection and undo; this module is the same moves for a caller that isn't a
 * person — strict about its input, and returning a whole new plan rather than
 * editing one in place, so a route can validate the result before it persists
 * anything. Nothing here touches the disk or the network.
 *
 * The graph rules are the ones the UI enforces by construction: a dependency
 * has to point at a task that exists, and it must not close a loop. A caller
 * handing us a whole graph can break both at once, so both are checked against
 * the finished plan rather than one edit at a time — a batch is free to add an
 * edge and remove it again before it is asked to make sense.
 */

/** A failure with an HTTP status attached, so route handlers can stay thin. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[]
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Bag = Record<string, unknown>;

/**
 * Validation collects rather than throws: one request describing twelve tasks
 * should come back with everything wrong with it, not just the first thing.
 */
class Problems {
  readonly items: string[] = [];
  add(msg: string) {
    this.items.push(msg);
  }
  check(message: string) {
    if (this.items.length) throw new ApiError(400, message, this.items);
  }
}

export const newId = () => crypto.randomUUID().slice(0, 8);

export function emptyPlan(): Plan {
  return { goals: [], tasks: [], shareToken: newId() + newId() };
}

export function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    goals: plan.goals.map((g) => ({ ...g })),
    tasks: plan.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
  };
}

/**
 * Whatever was stored, as a plan we can work with.
 *
 * Deliberately forgiving — this is our own document coming back off disk, and a
 * plan written by an older version of the app should still open. Input arriving
 * from a caller goes through the strict path below instead.
 */
export function normalizePlan(raw: unknown): Plan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyPlan();
  const doc = raw as Bag;
  const goals: Goal[] = (Array.isArray(doc.goals) ? doc.goals : [])
    .filter((g): g is Bag => !!g && typeof g === "object")
    .map((g, i) => ({
      id: typeof g.id === "string" ? g.id : newId(),
      name: typeof g.name === "string" ? g.name : `Goal ${i + 1}`,
      color:
        typeof g.color === "string" ? g.color : GOAL_COLORS[i % GOAL_COLORS.length],
    }));
  const tasks: Task[] = (Array.isArray(doc.tasks) ? doc.tasks : [])
    .filter((t): t is Bag => !!t && typeof t === "object")
    .map((t, i) => ({
      id: typeof t.id === "string" ? t.id : newId(),
      title: described(typeof t.title === "string" ? t.title : "", t.notes),
      priority: asPriority(num(t.priority)),
      goalId: typeof t.goalId === "string" ? t.goalId : null,
      dependsOn: (Array.isArray(t.dependsOn) ? t.dependsOn : []).filter(
        (d): d is string => typeof d === "string"
      ),
      blocked: typeof t.blocked === "string" ? t.blocked : null,
      done: t.done === true,
      order: num(t.order) ?? i + 1,
      createdAt: num(t.createdAt) ?? 0,
    }));
  return {
    goals,
    tasks,
    shareToken:
      typeof doc.shareToken === "string" && doc.shareToken
        ? doc.shareToken
        : newId() + newId(),
  };
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * A task used to carry a title and, separately, notes. It now carries one
 * description, so a document from that time is read with its notes folded into
 * the title rather than dropped: the words were the user's, and losing them on
 * open is not the same as no longer having a box for them.
 */
export function described(title: string, notes: unknown): string {
  const extra = typeof notes === "string" ? notes.trim() : "";
  if (!extra) return title;
  return title.trim() ? `${title.trim()} — ${extra}` : extra;
}

/* --------------------------------------------------------------- input --- */

/** Fields a caller may set. */
const WRITABLE = new Set([
  "id",
  "title",
  "priority",
  "goalId",
  "goal",
  "dependsOn",
  "blocked",
  "done",
  "order",
  "createdAt",
]);

/**
 * Fields we hand out but won't take back. They are functions of the graph, so
 * accepting them would mean accepting a second, contradictory source of truth —
 * but they are ignored rather than rejected, so an exported document can be
 * edited and posted straight back.
 */
const DERIVED = new Set(["status", "depth", "dependents", "goalName"]);

/**
 * Names the model has no use for, accepted and dropped rather than refused. Any
 * document this app has ever exported has to be one it will take back, so a
 * field it can't place costs the field and not the whole request.
 */
const RETIRED = new Set(["duration", "flowX", "flowY", "notes", "parallel"]);

export function asObject(v: unknown, label: string): Bag {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ApiError(400, `${label} must be an object`);
  return v as Bag;
}

export function asArray(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) throw new ApiError(400, `${label} must be an array`);
  return v;
}

export function asIds(v: unknown, label: string): string[] {
  return asArray(v, label).map((id, i) => {
    if (typeof id !== "string" || !id.trim())
      throw new ApiError(400, `${label}[${i}] must be a non-empty id`);
    return id.trim();
  });
}

const nextOrder = (plan: Plan) =>
  plan.tasks.length ? Math.max(...plan.tasks.map((t) => t.order)) + 1 : 1;

/**
 * Apply an input object to a task. `base` is the task being edited, or null to
 * build a new one — which is the only difference between a create and a patch:
 * on a create every field falls back to a default and the title is required.
 */
function coerceTask(
  input: unknown,
  base: Task | null,
  plan: Plan,
  p: Problems,
  label: string
): Task {
  const bag = asObject(input, label);
  for (const key of Object.keys(bag))
    if (!WRITABLE.has(key) && !DERIVED.has(key) && !RETIRED.has(key))
      p.add(`${label}: unknown field "${key}"`);

  const t: Task = base
    ? { ...base, dependsOn: [...base.dependsOn] }
    : {
        id: newId(),
        title: "",
        priority: 3,
        goalId: null,
        dependsOn: [],
        done: false,
        order: nextOrder(plan),
        createdAt: Date.now(),
      };

  if (!base && typeof bag.id === "string" && bag.id.trim()) t.id = bag.id.trim();

  if ("title" in bag) {
    if (typeof bag.title !== "string" || !bag.title.trim())
      p.add(`${label}: title must be a non-empty string`);
    else t.title = bag.title.trim();
  } else if (!base) {
    p.add(`${label}: title is required`);
  }

  // 4 is taken but not kept: the app has three levels, and a document naming a
  // fourth is still one this API promises to accept. It comes in as a P3.
  if ("priority" in bag) {
    const v = num(bag.priority);
    if (v == null || ![1, 2, 3, 4].includes(v))
      p.add(`${label}: priority must be 1, 2 or 3`);
    else t.priority = asPriority(v);
  }

  // `goal` names a goal (creating it if new, as `#goal` does in quick-add);
  // `goalId` points at one that already exists. Either may clear it with null.
  if ("goalId" in bag) {
    if (bag.goalId == null) t.goalId = null;
    else if (typeof bag.goalId !== "string") p.add(`${label}: goalId must be a string`);
    else if (!plan.goals.some((g) => g.id === bag.goalId))
      p.add(`${label}: no goal with id "${bag.goalId}"`);
    else t.goalId = bag.goalId;
  }
  if ("goal" in bag) {
    const resolved = resolveGoal(bag.goal, plan, p, label);
    if (resolved !== undefined) t.goalId = resolved;
  }

  if ("dependsOn" in bag) {
    if (!Array.isArray(bag.dependsOn)) {
      p.add(`${label}: dependsOn must be an array of task ids`);
    } else {
      const ids: string[] = [];
      for (const dep of bag.dependsOn) {
        if (typeof dep !== "string" || !dep.trim()) {
          p.add(`${label}: dependsOn entries must be task ids`);
        } else if (dep.trim() === t.id) {
          p.add(`${label}: a task cannot depend on itself`);
        } else if (!ids.includes(dep.trim())) {
          ids.push(dep.trim());
        }
      }
      t.dependsOn = ids;
    }
  }

  if ("blocked" in bag) {
    if (bag.blocked == null || bag.blocked === "" || bag.blocked === false)
      t.blocked = null;
    else if (bag.blocked === true) t.blocked = "Blocked";
    else if (typeof bag.blocked !== "string")
      p.add(`${label}: blocked must be a reason, or null`);
    else t.blocked = bag.blocked;
  }

  if ("done" in bag) {
    if (typeof bag.done !== "boolean") p.add(`${label}: done must be true or false`);
    else t.done = bag.done;
  }

  for (const key of ["order", "createdAt"] as const) {
    if (!(key in bag)) continue;
    const v = num(bag[key]);
    if (v == null) p.add(`${label}: ${key} must be a number`);
    else t[key] = v;
  }

  return t;
}

/**
 * A goal reference — an id, a name, or the goal object an export hands back.
 * Returns undefined when the input was unusable, which is not the same as the
 * null that clears a task's goal.
 */
function resolveGoal(
  value: unknown,
  plan: Plan,
  p: Problems,
  label: string
): string | null | undefined {
  if (value == null || value === "") return null;
  let name = typeof value === "string" ? value : null;
  if (value && typeof value === "object") {
    const g = value as Bag;
    if (typeof g.id === "string" && plan.goals.some((x) => x.id === g.id)) return g.id;
    name = typeof g.name === "string" ? g.name : null;
  }
  if (!name) {
    p.add(`${label}: goal must be a name, a goal object, or null`);
    return undefined;
  }
  const byId = plan.goals.find((g) => g.id === name);
  if (byId) return byId.id;
  const existing = plan.goals.find(
    (g) => g.name.toLowerCase() === name!.trim().toLowerCase()
  );
  if (existing) return existing.id;
  const created: Goal = {
    id: newId(),
    name: name.trim(),
    color: GOAL_COLORS[plan.goals.length % GOAL_COLORS.length],
  };
  plan.goals.push(created);
  return created.id;
}

/* ----------------------------------------------------------- integrity --- */

/**
 * The two things a caller can say that the graph cannot mean: a dependency on
 * a task that isn't there, and a loop. Checked against the finished plan, never
 * an intermediate one.
 */
export function validatePlan(plan: Plan) {
  const p = new Problems();
  const seen = new Set<string>();
  for (const t of plan.tasks) {
    if (seen.has(t.id)) p.add(`duplicate task id "${t.id}"`);
    seen.add(t.id);
  }
  const goalIds = new Set(plan.goals.map((g) => g.id));
  for (const g of plan.goals) if (!g.name.trim()) p.add(`goal "${g.id}" has no name`);
  for (const t of plan.tasks) {
    if (t.goalId && !goalIds.has(t.goalId))
      p.add(`task "${t.id}" points at goal "${t.goalId}", which does not exist`);
    for (const dep of t.dependsOn)
      if (!seen.has(dep))
        p.add(`task "${t.id}" depends on "${dep}", which does not exist`);
  }
  p.check("The plan does not hold together");

  const cycle = cycleOf(plan.tasks);
  if (cycle)
    // reversed, so the arrow points the way the canvas draws it: prerequisite
    // first, and the thing that waits for it second
    throw new ApiError(400, "That would create a dependency cycle", [
      [...cycle].reverse().join(" → "),
    ]);
  return plan;
}

/* ------------------------------------------------------------- writes --- */

export function findTask(plan: Plan, id: string): Task {
  const t = plan.tasks.find((t) => t.id === id);
  if (!t) throw new ApiError(404, `No task with id "${id}"`);
  return t;
}

/** Adds tasks. Ids may be supplied (an import round-trip) or left to us. */
function addTasks(plan: Plan, inputs: unknown[], p: Problems, from = "tasks"): Task[] {
  const created: Task[] = [];
  inputs.forEach((input, i) => {
    const label = `${from}[${i}]`;
    const task = coerceTask(input, null, plan, p, label);
    if (plan.tasks.some((t) => t.id === task.id))
      p.add(`${label}: a task with id "${task.id}" already exists`);
    plan.tasks.push(task);
    created.push(task);
  });
  return created;
}

/** Applies patches to tasks that exist. Each patch has to carry its own id. */
function patchTasks(plan: Plan, inputs: unknown[], p: Problems, from = "tasks"): Task[] {
  const updated: Task[] = [];
  inputs.forEach((input, i) => {
    const label = `${from}[${i}]`;
    const bag = asObject(input, label);
    const id = typeof bag.id === "string" ? bag.id.trim() : "";
    if (!id) {
      p.add(`${label}: id is required to update a task`);
      return;
    }
    const idx = plan.tasks.findIndex((t) => t.id === id);
    if (idx < 0) {
      p.add(`${label}: no task with id "${id}"`);
      return;
    }
    const next = coerceTask(bag, plan.tasks[idx], plan, p, label);
    plan.tasks[idx] = next;
    updated.push(next);
  });
  return updated;
}

/** Removes tasks, and every dependency that pointed at them. */
function removeTasks(plan: Plan, ids: string[]): Task[] {
  const gone = new Set(ids);
  const removed = plan.tasks.filter((t) => gone.has(t.id));
  plan.tasks = plan.tasks.filter((t) => !gone.has(t.id));
  for (const t of plan.tasks)
    t.dependsOn = t.dependsOn.filter((dep) => !gone.has(dep));
  return removed;
}

export function createTasks(plan: Plan, inputs: unknown[]) {
  const next = clonePlan(plan);
  const p = new Problems();
  const tasks = addTasks(next, inputs, p);
  p.check("Those tasks could not be created");
  return { plan: validatePlan(next), tasks };
}

export function updateTasks(plan: Plan, inputs: unknown[]) {
  const next = clonePlan(plan);
  const p = new Problems();
  const tasks = patchTasks(next, inputs, p);
  p.check("Those tasks could not be updated");
  return { plan: validatePlan(next), tasks };
}

export function deleteTasks(plan: Plan, ids: string[]) {
  const next = clonePlan(plan);
  const missing = ids.filter((id) => !next.tasks.some((t) => t.id === id));
  if (missing.length)
    throw new ApiError(404, "Nothing was deleted: some ids are unknown", missing);
  const tasks = removeTasks(next, ids);
  return { plan: validatePlan(next), tasks };
}

/**
 * The other half of a fetch-everything round trip: hand back the whole task
 * list and it becomes the task list. Anything you didn't send is deleted, which
 * is the point — and also why it insists on a complete document rather than
 * treating a short list as a no-op.
 */
export function replaceTasks(plan: Plan, inputs: unknown[]) {
  const next = clonePlan(plan);
  const p = new Problems();
  const before = new Map(next.tasks.map((t) => [t.id, t]));
  const kept: Task[] = [];
  const created: Task[] = [];
  const updated: Task[] = [];

  inputs.forEach((input, i) => {
    const label = `tasks[${i}]`;
    const bag = asObject(input, label);
    const id = typeof bag.id === "string" ? bag.id.trim() : "";
    const existing = id ? before.get(id) : undefined;
    // an id we don't know is a new task, not a mistake: the same document can
    // carry edits and additions
    const task = coerceTask(bag, existing ?? null, next, p, label);
    if (existing) updated.push(task);
    else created.push(task);
    kept.push(task);
  });

  const keptIds = new Set(kept.map((t) => t.id));
  const deleted = next.tasks.filter((t) => !keptIds.has(t.id));
  next.tasks = kept;
  p.check("The task list could not be replaced");
  return { plan: validatePlan(next), created, updated, deleted, tasks: kept };
}

/** Quick-add syntax, the same grammar the app's `n` box parses. */
export function quickAddTasks(plan: Plan, inputs: unknown[]) {
  const next = clonePlan(plan);
  const p = new Problems();
  const tasks = addQuickTasks(next, inputs, p);
  p.check("Those tasks could not be added");
  return { plan: validatePlan(next), tasks };
}

function addQuickTasks(plan: Plan, inputs: unknown[], p: Problems): Task[] {
  const created: Task[] = [];

  inputs.forEach((input, i) => {
    const label = `input[${i}]`;
    if (typeof input !== "string") {
      p.add(`${label}: must be a string`);
      return;
    }
    const parsed = parseQuickAdd(input, plan.tasks, plan.goals);
    if (!parsed.title) {
      p.add(`${label}: "${input}" has no title once the tokens are removed`);
      return;
    }
    let goalId: string | null = null;
    if (parsed.goalName) goalId = resolveGoal(parsed.goalName, plan, p, label) ?? null;
    const orders = plan.tasks.map((t) => t.order);
    const task: Task = {
      id: newId(),
      title: parsed.title,
      priority: parsed.priority,
      goalId,
      dependsOn: parsed.dependsOn,
      blocked: parsed.blocked,
      done: false,
      order: parsed.urgent
        ? (orders.length ? Math.min(...orders) : 0) - 1
        : (orders.length ? Math.max(...orders) : 0) + 1,
      createdAt: Date.now(),
    };
    plan.tasks.push(task);
    created.push(task);
  });

  return created;
}

/**
 * Dependencies as their own edit, because they are the part of a task that is
 * really a statement about two tasks. `set` replaces the list; `add`/`remove`
 * adjust it.
 */
export function editDependencies(
  plan: Plan,
  id: string,
  ops: { set?: unknown; add?: unknown; remove?: unknown }
) {
  const next = clonePlan(plan);
  const task = findTask(next, id);
  let deps = [...task.dependsOn];
  if (ops.set !== undefined) deps = asIds(ops.set, "dependsOn");
  if (ops.add !== undefined)
    for (const dep of asIds(ops.add, "add")) if (!deps.includes(dep)) deps.push(dep);
  if (ops.remove !== undefined) {
    const gone = new Set(asIds(ops.remove, "remove"));
    deps = deps.filter((d) => !gone.has(d));
  }
  if (deps.includes(id))
    throw new ApiError(400, "A task cannot depend on itself", [id]);
  task.dependsOn = deps;
  return { plan: validatePlan(next), task };
}

/* -------------------------------------------------------------- goals --- */

const GOAL_FIELDS = new Set(["id", "name", "color"]);
/** counted from the tasks, so handed out but not taken back — see DERIVED */
const GOAL_DERIVED = new Set(["taskCount", "doneCount"]);

function coerceGoal(input: unknown, base: Goal | null, plan: Plan, p: Problems, label: string): Goal {
  const bag = asObject(input, label);
  for (const key of Object.keys(bag))
    if (!GOAL_FIELDS.has(key) && !GOAL_DERIVED.has(key))
      p.add(`${label}: unknown field "${key}"`);

  const g: Goal = base
    ? { ...base }
    : {
        id: typeof bag.id === "string" && bag.id.trim() ? bag.id.trim() : newId(),
        name: "",
        color: GOAL_COLORS[plan.goals.length % GOAL_COLORS.length],
      };

  if ("name" in bag) {
    if (typeof bag.name !== "string" || !bag.name.trim())
      p.add(`${label}: name must be a non-empty string`);
    else g.name = bag.name.trim();
  } else if (!base) {
    p.add(`${label}: name is required`);
  }

  if ("color" in bag) {
    if (typeof bag.color !== "string" || !/^#[0-9a-f]{3,8}$/i.test(bag.color.trim()))
      p.add(`${label}: color must be a hex colour like #818cf8`);
    else g.color = bag.color.trim();
  }
  return g;
}

export function createGoals(plan: Plan, inputs: unknown[]) {
  const next = clonePlan(plan);
  const p = new Problems();
  const goals: Goal[] = [];
  inputs.forEach((input, i) => {
    const label = `goals[${i}]`;
    const goal = coerceGoal(input, null, next, p, label);
    if (next.goals.some((g) => g.id === goal.id))
      p.add(`${label}: a goal with id "${goal.id}" already exists`);
    if (next.goals.some((g) => g.name.toLowerCase() === goal.name.toLowerCase()))
      p.add(`${label}: a goal called "${goal.name}" already exists`);
    next.goals.push(goal);
    goals.push(goal);
  });
  p.check("Those goals could not be created");
  return { plan: validatePlan(next), goals };
}

export function updateGoals(plan: Plan, inputs: unknown[]) {
  const next = clonePlan(plan);
  const p = new Problems();
  const goals: Goal[] = [];
  inputs.forEach((input, i) => {
    const label = `goals[${i}]`;
    const bag = asObject(input, label);
    const id = typeof bag.id === "string" ? bag.id.trim() : "";
    const idx = next.goals.findIndex((g) => g.id === id);
    if (idx < 0) {
      p.add(`${label}: no goal with id "${id}"`);
      return;
    }
    const goal = coerceGoal(bag, next.goals[idx], next, p, label);
    if (
      next.goals.some(
        (g) => g.id !== goal.id && g.name.toLowerCase() === goal.name.toLowerCase()
      )
    )
      p.add(`${label}: a goal called "${goal.name}" already exists`);
    next.goals[idx] = goal;
    goals.push(goal);
  });
  p.check("Those goals could not be updated");
  return { plan: validatePlan(next), goals };
}

/** Deleting a goal unassigns its tasks; it never deletes work. */
export function deleteGoals(plan: Plan, ids: string[]) {
  const next = clonePlan(plan);
  const missing = ids.filter((id) => !next.goals.some((g) => g.id === id));
  if (missing.length)
    throw new ApiError(404, "Nothing was deleted: some ids are unknown", missing);
  const gone = new Set(ids);
  const goals = next.goals.filter((g) => gone.has(g.id));
  next.goals = next.goals.filter((g) => !gone.has(g.id));
  let unassigned = 0;
  for (const t of next.tasks)
    if (t.goalId && gone.has(t.goalId)) {
      t.goalId = null;
      unassigned += 1;
    }
  return { plan: validatePlan(next), goals, unassigned };
}

/* -------------------------------------------------------------- batch --- */

export interface BatchSummary {
  created: number;
  updated: number;
  deleted: number;
  goalsCreated: number;
  goalsUpdated: number;
  goalsDeleted: number;
}

const BATCH_FIELDS = new Set(["create", "update", "delete", "tasks", "goals", "quickAdd"]);

/**
 * Everything at once, or nothing at all.
 *
 * The whole edit is assembled against a copy and validated once at the end, so
 * a batch may pass through states the graph would refuse — adding an edge and
 * cutting it again, or deleting a prerequisite and the task that needed it —
 * and is judged only on where it lands. A single problem anywhere rejects the
 * request without writing.
 *
 * Order is fixed: goals first (so tasks can point at new ones), then creates,
 * quick-adds, updates, and deletes last (so an update can prepare a task for
 * the removal of another).
 */
export function applyBatch(plan: Plan, body: unknown) {
  const bag = asObject(body, "body");
  const p = new Problems();
  for (const key of Object.keys(bag))
    if (!BATCH_FIELDS.has(key)) p.add(`body: unknown field "${key}"`);
  p.check("That batch could not be read");

  let next = clonePlan(plan);
  const summary: BatchSummary = {
    created: 0,
    updated: 0,
    deleted: 0,
    goalsCreated: 0,
    goalsUpdated: 0,
    goalsDeleted: 0,
  };

  if (bag.goals !== undefined) {
    const goals = asObject(bag.goals, "goals");
    for (const key of Object.keys(goals))
      if (!["create", "update", "delete"].includes(key))
        p.add(`goals: unknown field "${key}"`);
    p.check("That batch could not be read");
    if (goals.create !== undefined) {
      const r = createGoals(next, asArray(goals.create, "goals.create"));
      next = r.plan;
      summary.goalsCreated = r.goals.length;
    }
    if (goals.update !== undefined) {
      const r = updateGoals(next, asArray(goals.update, "goals.update"));
      next = r.plan;
      summary.goalsUpdated = r.goals.length;
    }
    if (goals.delete !== undefined) {
      const r = deleteGoals(next, asIds(goals.delete, "goals.delete"));
      next = r.plan;
      summary.goalsDeleted = r.goals.length;
    }
  }

  // `tasks` is the whole-list form — the round trip — and is exclusive with the
  // create/update/delete form, because the two disagree about what silence means.
  if (bag.tasks !== undefined) {
    if (bag.create !== undefined || bag.update !== undefined || bag.delete !== undefined)
      throw new ApiError(
        400,
        'Send either "tasks" (the whole list) or create/update/delete, not both'
      );
    const r = replaceTasks(next, asArray(bag.tasks, "tasks"));
    next = r.plan;
    summary.created = r.created.length;
    summary.updated = r.updated.length;
    summary.deleted = r.deleted.length;
  } else {
    // one copy carried through every stage, validated once at the end
    const staged = clonePlan(next);
    if (bag.create !== undefined)
      summary.created += addTasks(staged, asArray(bag.create, "create"), p, "create").length;
    if (bag.quickAdd !== undefined)
      summary.created += addQuickTasks(staged, asArray(bag.quickAdd, "quickAdd"), p).length;
    if (bag.update !== undefined)
      summary.updated = patchTasks(staged, asArray(bag.update, "update"), p, "update").length;
    if (bag.delete !== undefined) {
      const ids = asIds(bag.delete, "delete");
      const missing = ids.filter((id) => !staged.tasks.some((t) => t.id === id));
      if (missing.length) for (const id of missing) p.add(`delete: no task with id "${id}"`);
      summary.deleted = removeTasks(staged, ids).length;
    }
    p.check("That batch was rejected; nothing was changed");
    next = staged;
  }

  return { plan: validatePlan(next), summary };
}

/* ------------------------------------------------------------- import --- */

/**
 * Take a document back in. Accepts an export (derived fields and all) or a bare
 * plan, and either replaces the plan outright or merges by id.
 */
export function importPlan(plan: Plan, body: unknown, mode: "replace" | "merge") {
  const doc = asObject(body, "body");
  const tasks = asArray(doc.tasks ?? [], "tasks");
  const goals = asArray(doc.goals ?? [], "goals");

  if (mode === "replace") {
    const base: Plan = {
      goals: [],
      tasks: [],
      // an import that carries no token keeps the one the share links use
      shareToken:
        typeof doc.shareToken === "string" && doc.shareToken
          ? doc.shareToken
          : plan.shareToken,
    };
    const p = new Problems();
    const withGoals = clonePlan(base);
    goals.forEach((input, i) => {
      withGoals.goals.push(coerceGoal(input, null, withGoals, p, `goals[${i}]`));
    });
    const created = addTasks(withGoals, tasks, p);
    p.check("That document could not be imported");
    return {
      plan: validatePlan(withGoals),
      summary: { tasks: created.length, goals: withGoals.goals.length, mode },
    };
  }

  const next = clonePlan(plan);
  const p = new Problems();
  goals.forEach((input, i) => {
    const label = `goals[${i}]`;
    const bag = asObject(input, label);
    const id = typeof bag.id === "string" ? bag.id.trim() : "";
    const idx = next.goals.findIndex((g) => g.id === id);
    if (idx >= 0) next.goals[idx] = coerceGoal(bag, next.goals[idx], next, p, label);
    else next.goals.push(coerceGoal(bag, null, next, p, label));
  });
  let created = 0;
  let updated = 0;
  tasks.forEach((input, i) => {
    const label = `tasks[${i}]`;
    const bag = asObject(input, label);
    const id = typeof bag.id === "string" ? bag.id.trim() : "";
    const idx = next.tasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      next.tasks[idx] = coerceTask(bag, next.tasks[idx], next, p, label);
      updated += 1;
    } else {
      next.tasks.push(coerceTask(bag, null, next, p, label));
      created += 1;
    }
  });
  p.check("That document could not be merged");
  return { plan: validatePlan(next), summary: { tasks: created + updated, created, updated, goals: goals.length, mode } };
}
