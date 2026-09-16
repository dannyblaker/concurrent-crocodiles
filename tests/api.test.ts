/**
 * The API, against a temp directory — never the real data/plan.json.
 *
 * These routes are the only writer that isn't a person, so what they are held
 * to here is mostly refusal: the graph rules the UI enforces by construction
 * (a dependency points at something that exists, and doesn't close a loop) have
 * to be enforced by argument instead, and a request that breaks them has to
 * leave the stored plan exactly as it found it.
 */
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePlan, makeTask, resetFactory } from "./factory";
import { Edge, GoalView, PlanStats, TaskView } from "@/lib/plan-doc";
import { Plan } from "@/lib/types";

let tmp: string;

/** All the routes, sharing one module registry (and so one write queue). */
async function routes() {
  vi.resetModules();
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  const [tasks, task, deps, goals, goal, batch, exp, imp, api] = await Promise.all([
    import("@/app/api/tasks/route"),
    import("@/app/api/tasks/[id]/route"),
    import("@/app/api/tasks/[id]/dependencies/route"),
    import("@/app/api/goals/route"),
    import("@/app/api/goals/[id]/route"),
    import("@/app/api/batch/route"),
    import("@/app/api/export/route"),
    import("@/app/api/import/route"),
    import("@/app/api/route"),
  ]);
  return { tasks, task, deps, goals, goal, batch, exp, imp, api };
}

const req = (url: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Every route answers in the same envelope; this is as much of it as we read. */
interface Body {
  ok: boolean;
  error?: string;
  details?: string[];
  count?: number;
  tasks?: TaskView[];
  task?: TaskView;
  goals?: GoalView[];
  goal?: GoalView;
  dependencies?: Edge[];
  stats?: PlanStats;
  summary?: Record<string, number>;
  created?: number;
  updated?: number;
  deleted?: number;
  unassigned?: number;
  dependsOn?: { id: string; title: string }[];
  dependents?: { id: string; title: string }[];
  endpoints?: { method: string; path: string }[];
}

const json = async (res: Response) => (await res.json()) as Body;
const rows = (body: Body) => body.tasks ?? [];
const ids = (body: Body) => rows(body).map((t) => t.id);

async function seed(plan: Plan) {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true });
  await fs.writeFile(path.join(tmp, "data", "plan.json"), JSON.stringify(plan));
}

async function stored(): Promise<Plan> {
  return JSON.parse(await fs.readFile(path.join(tmp, "data", "plan.json"), "utf8"));
}

/** a → b → c, plus one unrelated task: enough graph to ask questions of */
function chain() {
  return makePlan([
    makeTask({ id: "a", title: "Draft", priority: 1, goalId: "g1", done: true }),
    makeTask({ id: "b", title: "Review", dependsOn: ["a"] }),
    makeTask({ id: "c", title: "Ship", dependsOn: ["b"] }),
    makeTask({ id: "ci", title: "CI run" }),
  ]);
}

beforeEach(async () => {
  resetFactory();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "crocodiles-api-"));
  delete process.env.DATABASE_URL;
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("GET /api/tasks", () => {
  beforeEach(() => seed(chain()));

  it("derives status, depth and dependents for every task", async () => {
    const { tasks } = await routes();
    const body = await json(await tasks.GET(req("/api/tasks")));
    const byId = Object.fromEntries(rows(body).map((t) => [t.id, t]));

    expect(byId.a.status).toBe("done");
    expect(byId.b.status).toBe("in-progress"); // its one prerequisite is done
    expect(byId.c.status).toBe("todo");
    expect(byId.c.depth).toBe(2);
    expect(byId.a.dependents).toEqual(["b"]);
  });

  it("lists the dependencies on their own, as edges", async () => {
    const { tasks } = await routes();
    const body = await json(await tasks.GET(req("/api/tasks")));
    expect(body.dependencies).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
  });

  it("counts the plan up", async () => {
    const { tasks } = await routes();
    const stats = (await json(await tasks.GET(req("/api/tasks")))).stats!;
    expect(stats.byStatus).toEqual({ "in-progress": 2, todo: 1, done: 1 });
    expect(stats.longestChain).toBe(3);
  });

  it("filters by status, and leaves the rest of the plan described in full", async () => {
    const { tasks } = await routes();
    const body = await json(await tasks.GET(req("/api/tasks?status=in-progress")));
    expect(ids(body)).toEqual(["b", "ci"]);
    expect(body.count).toBe(2);
    // the graph is the whole graph, whatever the filter said
    expect(body.dependencies).toHaveLength(2);
  });

  it("filters by goal, by flag and by text", async () => {
    const { tasks } = await routes();
    const matching = async (q: string) =>
      ids(await json(await tasks.GET(req(`/api/tasks${q}`))));

    expect(await matching("?goal=deep-work")).toEqual(["a"]);
    expect(await matching("?goal=none")).toEqual(["b", "c", "ci"]);
    expect(await matching("?done=false&q=ship")).toEqual(["c"]);
    expect(await matching("?dependsOn=b")).toEqual(["c"]);
    expect(await matching("?blocking=b")).toEqual(["a"]);
  });

  it("says so when a filter names something that isn't there", async () => {
    const { tasks } = await routes();
    const res = await tasks.GET(req("/api/tasks?status=urgent"));
    expect(res.status).toBe(400);
    expect((await json(res)).ok).toBe(false);
  });
});

describe("POST /api/tasks", () => {
  beforeEach(() => seed(chain()));

  it("creates one task and gives it an id", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(req("/api/tasks", "POST", { title: "Write tests" }));
    expect(res.status).toBe(201);
    const [created] = rows(await json(res));
    expect(created.title).toBe("Write tests");
    expect((await stored()).tasks.map((t) => t.id)).toContain(created.id);
  });

  it("creates several, and lets them depend on each other in the same request", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(
      req("/api/tasks", "POST", {
        tasks: [
          { id: "x", title: "First" },
          { id: "y", title: "Second", dependsOn: ["x"] },
        ],
      })
    );
    expect(res.status).toBe(201);
    expect((await stored()).tasks.find((t) => t.id === "y")!.dependsOn).toEqual(["x"]);
  });

  it("takes quick-add lines, with the tokens the app parses", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(
      req("/api/tasks", "POST", { quickAdd: ["Write report !1 #writing"] })
    );
    const [t] = rows(await json(res));
    expect(t).toMatchObject({ title: "Write report", priority: 1 });
    // the goal was created on the way through, as `#goal` does in the app
    expect((await stored()).goals.map((g) => g.name)).toContain("writing");
  });

  it("refuses a task with no title", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(req("/api/tasks", "POST", { priority: 1 }));
    expect(res.status).toBe(400);
    expect((await json(res)).details).toEqual(["tasks[0]: title is required"]);
  });

  it("refuses a field it doesn't know, rather than dropping it silently", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(req("/api/tasks", "POST", { title: "x", when: "tomorrow" }));
    expect(res.status).toBe(400);
    expect((await json(res)).details).toEqual(['tasks[0]: unknown field "when"']);
  });

  /**
   * `duration` is not a field this plan has. Refusing it would mean a document
   * this app itself exported could not be handed back, which is the one thing
   * the round trip promises — so it is accepted and dropped.
   */
  it("accepts a field the plan does not have, and drops it", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(
      req("/api/tasks", "POST", {
        title: "From an old export",
        duration: 45,
        flowX: 300,
        flowY: 120,
        parallel: true,
        notes: "a second box for words",
      })
    );
    expect(res.status).toBe(201);
    const t = (await stored()).tasks.find((t) => t.title === "From an old export")!;
    expect(t).not.toHaveProperty("duration");
    // and notes: the description is the one place a task's words go now
    expect(t).not.toHaveProperty("notes");
    // likewise a canvas position: the board arranges itself
    expect(t).not.toHaveProperty("flowX");
    // and a concurrency flag: the startable column is the answer to that
    expect(t).not.toHaveProperty("parallel");
  });

  /** The app has three levels, and a document naming a fourth still opens. */
  it("folds a priority outside the three into the lowest", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(
      req("/api/tasks", "POST", { title: "An old P4", priority: 4 })
    );
    expect(res.status).toBe(201);
    expect((await stored()).tasks.find((t) => t.title === "An old P4")!.priority).toBe(3);
  });

  it("still refuses a priority that was never a priority", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(req("/api/tasks", "POST", { title: "x", priority: 5 }));
    expect(res.status).toBe(400);
    expect((await json(res)).details).toEqual([
      "tasks[0]: priority must be 1, 2 or 3",
    ]);
  });

  it("refuses a dependency on a task that does not exist, and writes nothing", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(
      req("/api/tasks", "POST", { title: "Ghost work", dependsOn: ["nope"] })
    );
    expect(res.status).toBe(400);
    expect((await stored()).tasks).toHaveLength(4);
  });

  it("reports everything wrong with a request at once", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(
      req("/api/tasks", "POST", { tasks: [{ title: "" }, { title: "ok", priority: 9 }] })
    );
    expect((await json(res)).details).toHaveLength(2);
  });
});

describe("PATCH /api/tasks", () => {
  beforeEach(() => seed(chain()));

  it("updates many at once, touching only the fields it was sent", async () => {
    const { tasks } = await routes();
    const res = await tasks.PATCH(
      req("/api/tasks", "PATCH", {
        tasks: [
          { id: "b", done: true },
          { id: "c", priority: 1 },
        ],
      })
    );
    expect(res.status).toBe(200);
    const after = await stored();
    expect(after.tasks.find((t) => t.id === "b")).toMatchObject({ done: true, title: "Review" });
    expect(after.tasks.find((t) => t.id === "c")!.priority).toBe(1);
  });

  it("advances the frontier, because status is derived and not stored", async () => {
    const { tasks } = await routes();
    await tasks.PATCH(req("/api/tasks", "PATCH", { tasks: [{ id: "b", done: true }] }));
    const body = await json(await tasks.GET(req("/api/tasks?status=in-progress")));
    expect(ids(body)).toContain("c");
  });

  it("rejects the whole request when one id is unknown", async () => {
    const { tasks } = await routes();
    const res = await tasks.PATCH(
      req("/api/tasks", "PATCH", {
        tasks: [
          { id: "b", title: "Renamed" },
          { id: "ghost", title: "Nope" },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect((await stored()).tasks.find((t) => t.id === "b")!.title).toBe("Review");
  });
});

describe("PUT /api/tasks", () => {
  beforeEach(() => seed(chain()));

  it("replaces the whole list: edits, additions and removals in one document", async () => {
    const { tasks } = await routes();
    const before = rows(await json(await tasks.GET(req("/api/tasks"))));
    // the round trip: keep three, rename one, drop one, add one
    const next: object[] = before
      .filter((t) => t.id !== "ci")
      .map((t) => (t.id === "c" ? { ...t, title: "Ship it" } : t));
    next.push({ title: "Retro", dependsOn: ["c"] });

    const res = await tasks.PUT(req("/api/tasks", "PUT", { tasks: next }));
    const body = await json(res);
    expect(body).toMatchObject({ created: 1, updated: 3, deleted: 1 });

    const after = await stored();
    expect(after.tasks.map((t) => t.title).sort()).toEqual(["Draft", "Retro", "Review", "Ship it"]);
  });

  it("takes back the derived fields it handed out, without complaining about them", async () => {
    const { tasks } = await routes();
    const before = (await json(await tasks.GET(req("/api/tasks")))).tasks;
    const res = await tasks.PUT(req("/api/tasks", "PUT", { tasks: before }));
    expect(res.status).toBe(200);
    expect((await json(res)).created).toBe(0);
    // and the stored plan is still the stored plan — no derived state leaked in
    expect(Object.keys((await stored()).tasks[0])).not.toContain("status");
  });
});

describe("DELETE /api/tasks", () => {
  beforeEach(() => seed(chain()));

  it("deletes by id, and takes the dependencies that pointed at it", async () => {
    const { tasks } = await routes();
    const res = await tasks.DELETE(req("/api/tasks?ids=b", "DELETE"));
    expect(res.status).toBe(200);
    const after = await stored();
    expect(after.tasks.map((t) => t.id)).toEqual(["a", "c", "ci"]);
    expect(after.tasks.find((t) => t.id === "c")!.dependsOn).toEqual([]);
  });

  it("clears the finished work with ?done=true", async () => {
    const { tasks } = await routes();
    await tasks.DELETE(req("/api/tasks?done=true", "DELETE"));
    expect((await stored()).tasks.map((t) => t.id)).toEqual(["b", "c", "ci"]);
  });

  it("deletes nothing when one of the ids is unknown", async () => {
    const { tasks } = await routes();
    const res = await tasks.DELETE(req("/api/tasks?ids=b,ghost", "DELETE"));
    expect(res.status).toBe(404);
    expect((await stored()).tasks).toHaveLength(4);
  });

  it("insists on being told what to delete", async () => {
    const { tasks } = await routes();
    expect((await tasks.DELETE(req("/api/tasks", "DELETE"))).status).toBe(400);
  });
});

describe("/api/tasks/[id]", () => {
  beforeEach(() => seed(chain()));

  it("reads one task, with its derived state", async () => {
    const { task } = await routes();
    const body = await json(await task.GET(req("/api/tasks/b"), ctx("b")));
    expect(body.task).toMatchObject({ id: "b", status: "in-progress", depth: 1, dependents: ["c"] });
  });

  it("404s for a task that isn't there", async () => {
    const { task } = await routes();
    expect((await task.GET(req("/api/tasks/ghost"), ctx("ghost"))).status).toBe(404);
  });

  it("patches the fields it is sent and no others", async () => {
    const { task } = await routes();
    await task.PATCH(req("/api/tasks/b", "PATCH", { blocked: "waiting on review" }), ctx("b"));
    const t = (await stored()).tasks.find((t) => t.id === "b")!;
    expect(t.blocked).toBe("waiting on review");
    expect(t.dependsOn).toEqual(["a"]);
  });

  it("holds a blocked task at to-do however clear its prerequisites are", async () => {
    const { task } = await routes();
    const res = await task.PATCH(req("/api/tasks/b", "PATCH", { blocked: "waiting" }), ctx("b"));
    expect((await json(res)).task).toMatchObject({ status: "todo" });
  });

  it("clears what a replacement leaves out", async () => {
    const { task } = await routes();
    await task.PUT(req("/api/tasks/b", "PUT", { title: "Review" }), ctx("b"));
    const t = (await stored()).tasks.find((t) => t.id === "b")!;
    expect(t.dependsOn).toEqual([]);
    expect(t.priority).toBe(3);
  });

  it("deletes, and unhooks whatever depended on it", async () => {
    const { task } = await routes();
    await task.DELETE(req("/api/tasks/b", "DELETE"), ctx("b"));
    const after = await stored();
    expect(after.tasks.map((t) => t.id)).toEqual(["a", "c", "ci"]);
    expect(after.tasks.find((t) => t.id === "c")!.dependsOn).toEqual([]);
  });
});

describe("/api/tasks/[id]/dependencies", () => {
  beforeEach(() => seed(chain()));

  it("reads both directions", async () => {
    const { deps } = await routes();
    const body = await json(await deps.GET(req("/api/tasks/b/dependencies"), ctx("b")));
    expect(body.dependsOn).toEqual([{ id: "a", title: "Draft" }]);
    expect(body.dependents).toEqual([{ id: "c", title: "Ship" }]);
  });

  it("adds and removes edges", async () => {
    const { deps } = await routes();
    await deps.POST(req("/api/tasks/ci/dependencies", "POST", { add: ["a"] }), ctx("ci"));
    expect((await stored()).tasks.find((t) => t.id === "ci")!.dependsOn).toEqual(["a"]);

    await deps.DELETE(req("/api/tasks/ci/dependencies?ids=a", "DELETE"), ctx("ci"));
    expect((await stored()).tasks.find((t) => t.id === "ci")!.dependsOn).toEqual([]);
  });

  it("refuses an edge that would close a loop, and says which one", async () => {
    const { deps } = await routes();
    const res = await deps.POST(req("/api/tasks/a/dependencies", "POST", { add: ["c"] }), ctx("a"));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toMatch(/cycle/i);
    // the loop, pointing the way the canvas draws it: prerequisite first
    expect(body.details![0]).toBe("a → b → c → a");
    expect((await stored()).tasks.find((t) => t.id === "a")!.dependsOn).toEqual([]);
  });

  it("refuses a task depending on itself", async () => {
    const { deps } = await routes();
    const res = await deps.PUT(req("/api/tasks/b/dependencies", "PUT", { set: ["b"] }), ctx("b"));
    expect(res.status).toBe(400);
  });
});

describe("/api/goals", () => {
  beforeEach(() => seed(chain()));

  it("counts the tasks mapped and done against each goal", async () => {
    const { goals } = await routes();
    const body = await json(await goals.GET());
    expect(body.goals![0]).toMatchObject({
      name: "deep-work",
      taskCount: 1,
      doneCount: 1,
    });
  });

  it("creates a goal, and refuses a second one by the same name", async () => {
    const { goals } = await routes();
    expect((await goals.POST(req("/api/goals", "POST", { name: "admin" }))).status).toBe(201);
    const dup = await goals.POST(req("/api/goals", "POST", { name: "Admin" }));
    expect(dup.status).toBe(400);
  });

  it("renames one", async () => {
    const { goal } = await routes();
    await goal.PATCH(req("/api/goals/g1", "PATCH", { name: "deep work" }), ctx("g1"));
    expect((await stored()).goals[0].name).toBe("deep work");
  });

  it("unassigns tasks rather than deleting them", async () => {
    const { goal } = await routes();
    const body = await json(await goal.DELETE(req("/api/goals/g1", "DELETE"), ctx("g1")));
    expect(body.unassigned).toBe(1);
    const after = await stored();
    expect(after.goals).toEqual([]);
    expect(after.tasks).toHaveLength(4);
    expect(after.tasks.find((t) => t.id === "a")!.goalId).toBeNull();
  });
});

describe("POST /api/batch", () => {
  beforeEach(() => seed(chain()));

  it("creates, updates and deletes in one request", async () => {
    const { batch } = await routes();
    const res = await batch.POST(
      req("/api/batch", "POST", {
        goals: { create: [{ name: "ops" }] },
        create: [{ id: "new", title: "Retro", goal: "ops", dependsOn: ["c"] }],
        update: [{ id: "b", done: true }],
        delete: ["ci"],
      })
    );
    expect(res.status).toBe(200);
    expect((await json(res)).summary).toMatchObject({
      created: 1,
      updated: 1,
      deleted: 1,
      goalsCreated: 1,
    });

    const after = await stored();
    expect(after.tasks.map((t) => t.id)).toEqual(["a", "b", "c", "new"]);
    expect(after.tasks.find((t) => t.id === "new")!.goalId).toBe(
      after.goals.find((g) => g.name === "ops")!.id
    );
  });

  it("judges the batch on where it lands, not on how it got there", async () => {
    const { batch } = await routes();
    // c depends on b, and b is deleted — the update that unhooks c comes first
    const res = await batch.POST(
      req("/api/batch", "POST", { update: [{ id: "c", dependsOn: [] }], delete: ["b"] })
    );
    expect(res.status).toBe(200);
    expect((await stored()).tasks.map((t) => t.id)).toEqual(["a", "c", "ci"]);
  });

  it("applies none of it when any part is rejected", async () => {
    const { batch } = await routes();
    const res = await batch.POST(
      req("/api/batch", "POST", {
        create: [{ title: "This one is fine" }],
        update: [{ id: "ghost", done: true }],
      })
    );
    expect(res.status).toBe(400);
    expect((await stored()).tasks).toHaveLength(4);
  });

  it("refuses to guess between the whole-list form and the piecemeal one", async () => {
    const { batch } = await routes();
    const res = await batch.POST(
      req("/api/batch", "POST", { tasks: [], delete: ["b"] })
    );
    expect(res.status).toBe(400);
  });

  it("takes the whole list back, and answers with the plan that resulted", async () => {
    const { batch } = await routes();
    const res = await batch.POST(
      req("/api/batch", "POST", {
        tasks: [
          { id: "a", title: "Draft", done: true },
          { id: "b", title: "Review", dependsOn: ["a"] },
        ],
      })
    );
    const body = await json(res);
    expect(body.summary).toMatchObject({ updated: 2, deleted: 2, created: 0 });
    expect(rows(body)[1].status).toBe("in-progress");
  });
});

describe("GET /api/export", () => {
  beforeEach(() => seed(chain()));

  it("hands out the whole plan, derivations included", async () => {
    const { exp } = await routes();
    const res = await exp.GET(req("/api/export"));
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc.app).toBe("Concurrent Crocodiles");
    expect(doc.version).toBe(1);
    expect(typeof doc.exportedAt).toBe("string");
    expect((doc.tasks as { status: string }[]).map((t) => t.status)).toEqual([
      "done",
      "in-progress",
      "todo",
      "in-progress",
    ]);
    expect(doc.dependencies).toHaveLength(2);
    expect(doc.shareToken).toBe("share-token");
  });

  it("offers itself as a file when asked", async () => {
    const { exp } = await routes();
    const res = await exp.GET(req("/api/export?download=1"));
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename=".*\.json"/);
  });

  it("can hand out the stored document instead, with nothing derived in it", async () => {
    const { exp } = await routes();
    const doc = (await (await exp.GET(req("/api/export?format=plan"))).json()) as Plan;
    expect(doc.tasks.map((t) => t.id)).toEqual(["a", "b", "c", "ci"]);
    expect(Object.keys(doc)).toEqual(["goals", "tasks", "shareToken"]);
    expect(Object.keys(doc.tasks[0])).not.toContain("status");
  });
});

describe("POST /api/import", () => {
  beforeEach(() => seed(chain()));

  it("takes an export straight back, derived fields and all", async () => {
    const { exp, imp } = await routes();
    const before = (await (await exp.GET(req("/api/export"))).json()) as Record<string, unknown>;
    const res = await imp.POST(req("/api/import", "POST", before));
    expect(res.status).toBe(200);

    // the round trip is the test: export, import, export again, same document
    const after = (await (await exp.GET(req("/api/export"))).json()) as Record<string, unknown>;
    delete before.exportedAt;
    delete after.exportedAt;
    expect(after).toEqual(before);
  });

  it("replaces the plan, keeping the share links working", async () => {
    const { imp } = await routes();
    await imp.POST(
      req("/api/import", "POST", { tasks: [{ id: "z", title: "Only task" }], goals: [] })
    );
    const after = await stored();
    expect(after.tasks.map((t) => t.id)).toEqual(["z"]);
    expect(after.shareToken).toBe("share-token");
  });

  it("merges by id when asked, leaving everything else alone", async () => {
    const { imp } = await routes();
    await imp.POST(
      req("/api/import?mode=merge", "POST", {
        tasks: [
          { id: "b", title: "Review, twice" },
          { id: "new", title: "Extra" },
        ],
      })
    );
    const after = await stored();
    expect(after.tasks).toHaveLength(5);
    expect(after.tasks.find((t) => t.id === "b")!.title).toBe("Review, twice");
  });

  it("writes nothing when the document does not hold together", async () => {
    const { imp } = await routes();
    const res = await imp.POST(
      req("/api/import", "POST", { tasks: [{ id: "x", title: "x", dependsOn: ["ghost"] }] })
    );
    expect(res.status).toBe(400);
    expect((await stored()).tasks).toHaveLength(4);
  });

  it("refuses a loop", async () => {
    const { imp } = await routes();
    const res = await imp.POST(
      req("/api/import", "POST", {
        tasks: [
          { id: "x", title: "x", dependsOn: ["y"] },
          { id: "y", title: "y", dependsOn: ["x"] },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/cycle/i);
  });
});

describe("writing on an empty machine", () => {
  it("starts a plan from nothing, rather than needing one to exist", async () => {
    const { tasks } = await routes();
    const res = await tasks.POST(req("/api/tasks", "POST", { title: "First ever" }));
    expect(res.status).toBe(201);
    const after = await stored();
    expect(after.tasks.map((t) => t.title)).toEqual(["First ever"]);
    expect(after.shareToken).toBeTruthy();
  });
});

describe("concurrent writes", () => {
  beforeEach(() => seed(makePlan()));

  it("keeps every one of them: writes queue rather than overwrite", async () => {
    const { tasks } = await routes();
    const titles = ["one", "two", "three", "four", "five"];
    // all five read-modify-write cycles are in flight at once
    const results = await Promise.all(
      titles.map((title) => tasks.POST(req("/api/tasks", "POST", { title })))
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect((await stored()).tasks.map((t) => t.title).sort()).toEqual([...titles].sort());
  });

  it("lets the next write through after one is rejected", async () => {
    const { tasks } = await routes();
    const bad = tasks.POST(req("/api/tasks", "POST", { title: "" }));
    const good = tasks.POST(req("/api/tasks", "POST", { title: "fine" }));
    expect((await bad).status).toBe(400);
    expect((await good).status).toBe(201);
    expect((await stored()).tasks.map((t) => t.title)).toEqual(["fine"]);
  });
});

describe("GET /api", () => {
  it("says what is on offer", async () => {
    const { api } = await routes();
    const body = await json(await api.GET());
    expect(body.endpoints!.map((e) => e.path)).toContain("/api/tasks");
  });
});
