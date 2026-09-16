import { fail, flag, idsFromQuery, ok, readBody } from "@/lib/api-http";
import { dependencyEdges, planStats, taskViews, TaskView } from "@/lib/plan-doc";
import {
  ApiError,
  asArray,
  asIds,
  createTasks,
  deleteTasks,
  quickAddTasks,
  replaceTasks,
  updateTasks,
} from "@/lib/plan-ops";
import { editPlan, readPlan } from "@/lib/plan-store";
import { Plan, TaskStatus } from "@/lib/types";

/**
 * The task collection.
 *
 *   GET     list, with filters — every task carries its derived status
 *   POST    create (one task, many tasks, or quick-add lines)
 *   PATCH   update many, each patch naming its own id
 *   PUT     replace the whole list — the other half of the GET round trip
 *   DELETE  remove by id, or every finished task
 *
 * GET always answers with the goals, the edge list and the totals alongside the
 * tasks, because the reason to read this endpoint is usually to write back to
 * it, and a task id means nothing without the graph it sits in. Filters narrow
 * `tasks` only; the rest always describes the whole plan.
 */

export const dynamic = "force-dynamic";

const STATUSES: TaskStatus[] = ["todo", "in-progress", "done"];

function body(plan: Plan, tasks: TaskView[] = taskViews(plan.tasks)) {
  return {
    count: tasks.length,
    tasks,
    goals: plan.goals,
    dependencies: dependencyEdges(plan.tasks),
    stats: planStats(plan),
  };
}

/**
 * Filters, all optional and all ANDed:
 *   ?status=in-progress,todo   ?goal=<id or name>   ?q=<title substring>
 *   ?done=true   ?blocked=true   ?dependsOn=<id>   ?blocking=<id>
 */
function filtered(plan: Plan, url: URL): TaskView[] {
  let views = taskViews(plan.tasks);
  const param = (name: string) => url.searchParams.get(name);

  const status = param("status");
  if (status) {
    const wanted = status.split(",").map((s) => s.trim());
    const unknown = wanted.filter((s) => !STATUSES.includes(s as TaskStatus));
    if (unknown.length)
      throw new ApiError(400, `Unknown status: ${unknown.join(", ")}`, [
        `known statuses: ${STATUSES.join(", ")}`,
      ]);
    views = views.filter((t) => wanted.includes(t.status));
  }

  const goal = param("goal");
  if (goal) {
    const g = plan.goals.find(
      (g) => g.id === goal || g.name.toLowerCase() === goal.toLowerCase()
    );
    if (goal === "none") views = views.filter((t) => !t.goalId);
    else if (!g) throw new ApiError(404, `No goal called "${goal}"`);
    else views = views.filter((t) => t.goalId === g.id);
  }

  const q = param("q");
  if (q) {
    const needle = q.toLowerCase();
    views = views.filter((t) => t.title.toLowerCase().includes(needle));
  }

  for (const [name, pick] of [
    ["done", (t: TaskView) => t.done],
    ["blocked", (t: TaskView) => !!t.blocked],
  ] as const) {
    const v = param(name);
    if (v === null) continue;
    const want = v !== "false" && v !== "0";
    views = views.filter((t) => pick(t) === want);
  }

  const dependsOn = param("dependsOn");
  if (dependsOn) views = views.filter((t) => t.dependsOn.includes(dependsOn));
  const blocking = param("blocking");
  if (blocking) views = views.filter((t) => t.dependents.includes(blocking));

  return views;
}

export async function GET(req: Request) {
  try {
    const plan = await readPlan();
    return ok(body(plan, filtered(plan, new URL(req.url))));
  } catch (err) {
    return fail(err);
  }
}

/**
 * Create. Accepts a single task, `{ tasks: [...] }`, or `{ quickAdd: [...] }`
 * for the `Write report !1 #deep-work` grammar the app's own box parses.
 */
export async function POST(req: Request) {
  try {
    const input = await readBody(req);
    const bag = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

    const created = await editPlan((plan) => {
      if (Array.isArray(input)) {
        const r = createTasks(plan, input);
        return { plan: r.plan, result: r.tasks };
      }
      if (bag.quickAdd !== undefined) {
        const r = quickAddTasks(plan, asArray(bag.quickAdd, "quickAdd"));
        return { plan: r.plan, result: r.tasks };
      }
      const r = createTasks(plan, bag.tasks !== undefined ? asArray(bag.tasks, "tasks") : [input]);
      return { plan: r.plan, result: r.tasks };
    });

    return ok({ count: created.length, tasks: created }, 201);
  } catch (err) {
    return fail(err);
  }
}

/** Update many at once: `{ tasks: [{ id, …patch }] }`. All or nothing. */
export async function PATCH(req: Request) {
  try {
    const input = await readBody(req);
    const patches = Array.isArray(input)
      ? input
      : asArray((input as Record<string, unknown>)?.tasks, "tasks");

    const updated = await editPlan((plan) => {
      const r = updateTasks(plan, patches);
      return { plan: r.plan, result: r.tasks };
    });
    return ok({ count: updated.length, tasks: updated });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Replace the whole list — fetch everything from GET, edit the array, send it
 * back. Tasks you kept are updated, ids we don't know are created, and anything
 * missing from the list is deleted, so a partial list is a destructive request
 * rather than a harmless one.
 */
export async function PUT(req: Request) {
  try {
    const input = await readBody(req);
    const tasks = Array.isArray(input)
      ? input
      : asArray((input as Record<string, unknown>)?.tasks, "tasks");

    const summary = await editPlan((plan) => {
      const r = replaceTasks(plan, tasks);
      return {
        plan: r.plan,
        result: {
          created: r.created.length,
          updated: r.updated.length,
          deleted: r.deleted.length,
          plan: r.plan,
        },
      };
    });
    const { plan, ...counts } = summary;
    return ok({ ...counts, ...body(plan) });
  } catch (err) {
    return fail(err);
  }
}

/** `?ids=a,b`, `{ ids: [...] }`, or `?done=true` for everything finished. */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    let ids = idsFromQuery(url);
    if (!ids.length && req.headers.get("content-length") !== "0") {
      const text = await req.text();
      if (text.trim()) {
        try {
          ids = asIds((JSON.parse(text) as Record<string, unknown>).ids, "ids");
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw new ApiError(400, "The request body is not valid JSON");
        }
      }
    }

    const clearDone = flag(url, "done");
    if (!ids.length && !clearDone)
      throw new ApiError(400, "Say what to delete: ?ids=a,b or ?done=true");

    const deleted = await editPlan((plan) => {
      const targets = clearDone
        ? [...new Set([...ids, ...plan.tasks.filter((t) => t.done).map((t) => t.id)])]
        : ids;
      const r = deleteTasks(plan, targets);
      return { plan: r.plan, result: r.tasks };
    });
    return ok({ count: deleted.length, tasks: deleted });
  } catch (err) {
    return fail(err);
  }
}
