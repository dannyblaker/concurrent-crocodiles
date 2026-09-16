import { fail, ok, readBody } from "@/lib/api-http";
import { taskViews } from "@/lib/plan-doc";
import { ApiError, deleteTasks, findTask, updateTasks } from "@/lib/plan-ops";
import { editPlan, readPlan } from "@/lib/plan-store";
import { Plan } from "@/lib/types";

/**
 * One task.
 *
 *   GET     the task, with its status, depth and dependents
 *   PATCH   change the fields you send, leave the rest
 *   PUT     the same, except that it also clears anything you left out
 *   DELETE  remove it, and every dependency that pointed at it
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The derived view of one task — the same shape the list endpoint returns. */
function view(plan: Plan, id: string) {
  findTask(plan, id); // 404s if it isn't there
  return taskViews(plan.tasks).find((t) => t.id === id)!;
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return ok({ task: view(await readPlan(), id) });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const patch = { ...(await readBody(req)) as Record<string, unknown>, id };
    const plan = await editPlan((plan) => {
      const r = updateTasks(plan, [patch]);
      return { plan: r.plan, result: r.plan };
    });
    return ok({ task: view(plan, id) });
  } catch (err) {
    return fail(err);
  }
}

/**
 * A full replacement. Everything a task can hold that you don't mention goes
 * back to its default, which is the difference from PATCH — the same difference
 * PUT and PATCH have everywhere. Only the id and the creation time survive.
 */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const sent = (await readBody(req)) as Record<string, unknown>;
    if (typeof sent?.title !== "string")
      throw new ApiError(400, "A replacement has to carry a title");
    const plan = await editPlan((plan) => {
      const existing = findTask(plan, id);
      const blank: Record<string, unknown> = {
        priority: 3,
        goalId: null,
        dependsOn: [],
        blocked: null,
        done: false,
        order: existing.order,
      };
      const r = updateTasks(plan, [{ ...blank, ...sent, id, createdAt: existing.createdAt }]);
      return { plan: r.plan, result: r.plan };
    });
    return ok({ task: view(plan, id) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const deleted = await editPlan((plan) => {
      const r = deleteTasks(plan, [id]);
      return { plan: r.plan, result: r.tasks[0] };
    });
    return ok({ task: deleted });
  } catch (err) {
    return fail(err);
  }
}
