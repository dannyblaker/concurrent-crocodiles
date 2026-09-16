import { columnX, layoutFlow, navOrder, rowY } from "@/lib/flow";
import { FLOW } from "@/lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTask, resetFactory } from "./factory";

beforeEach(resetFactory);

describe("layoutFlow", () => {
  it("puts each task in the column its dependency depth earns", () => {
    const layout = layoutFlow([
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "c", dependsOn: ["b"] }),
    ]);
    expect(layout.get("a")!.x).toBe(columnX(0));
    expect(layout.get("b")!.x).toBe(columnX(1));
    expect(layout.get("c")!.x).toBe(columnX(2));
  });

  it("stacks tasks that share a column instead of overlapping them", () => {
    const layout = layoutFlow([
      makeTask({ id: "a", order: 1 }),
      makeTask({ id: "b", order: 2 }),
    ]);
    expect(layout.get("a")!.x).toBe(layout.get("b")!.x);
    expect(Math.abs(layout.get("a")!.y - layout.get("b")!.y)).toBeGreaterThanOrEqual(
      FLOW.NODE_H
    );
  });

  it("spaces a column evenly, however many are in it", () => {
    const layout = layoutFlow([
      makeTask({ id: "f1", order: 1 }),
      makeTask({ id: "f2", order: 2 }),
      makeTask({ id: "f3", order: 3 }),
    ]);
    const ys = ["f1", "f2", "f3"].map((id) => layout.get(id)!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys[2] - ys[1]).toBe(ys[1] - ys[0]);
  });

  it("sorts a column by priority, most urgent at the top", () => {
    const layout = layoutFlow([
      makeTask({ id: "meh", priority: 3, order: 1 }),
      makeTask({ id: "now", priority: 1, order: 2 }),
      makeTask({ id: "soon", priority: 2, order: 3 }),
    ]);
    expect(layout.get("now")!.y).toBe(rowY(0));
    expect(layout.get("soon")!.y).toBe(rowY(1));
    expect(layout.get("meh")!.y).toBe(rowY(2));
  });

  it("lifts what an urgent task waits on, whatever that task calls itself", () => {
    // "dull" is a P3 on its own account, but the P1 can't start without it
    const layout = layoutFlow([
      makeTask({ id: "busywork", priority: 2, order: 1 }),
      makeTask({ id: "dull", priority: 3, order: 2 }),
      makeTask({ id: "urgent", priority: 1, order: 3, dependsOn: ["dull"] }),
    ]);
    expect(layout.get("dull")!.y).toBe(rowY(0));
    expect(layout.get("busywork")!.y).toBe(rowY(1));
    // and the chain reads straight across the top
    expect(layout.get("urgent")!.y).toBe(rowY(0));
    expect(layout.get("urgent")!.x).toBeGreaterThan(layout.get("dull")!.x);
  });

  it("keeps a chain level rather than stitching between rows", () => {
    const layout = layoutFlow([
      makeTask({ id: "a1", order: 1 }),
      makeTask({ id: "a2", order: 2 }),
      // b2 is declared first, but follows the row of what it waits on
      makeTask({ id: "b2", order: 3, dependsOn: ["a2"] }),
      makeTask({ id: "b1", order: 4, dependsOn: ["a1"] }),
    ]);
    expect(layout.get("b1")!.y).toBe(layout.get("a1")!.y);
    expect(layout.get("b2")!.y).toBe(layout.get("a2")!.y);
  });

  it("terminates on a cycle rather than hanging", () => {
    const tasks = [
      makeTask({ id: "a", dependsOn: ["b"] }),
      makeTask({ id: "b", dependsOn: ["a"] }),
    ];
    expect(layoutFlow(tasks).size).toBe(2);
  });

  it("places every task, dangling dependency or not", () => {
    const layout = layoutFlow([
      makeTask({ id: "a", dependsOn: ["gone"] }),
      makeTask({ id: "b" }),
    ]);
    expect([...layout.keys()].sort()).toEqual(["a", "b"]);
  });
});

/**
 * The keyboard walks the plan the way the work runs: on from a task is whatever
 * waits on it, so a chain is followed to its end rather than dropping down a
 * column and leaving you to find where the arrow went.
 */
describe("navOrder", () => {
  it("goes to what waits on a task, not to the one below it", () => {
    const order = navOrder([
      makeTask({ id: "a", order: 1 }),
      makeTask({ id: "below", order: 2 }),
      makeTask({ id: "after-a", order: 3, dependsOn: ["a"] }),
    ]);
    expect(order).toEqual(["a", "after-a", "below"]);
  });

  it("follows a chain the whole way before starting the next one", () => {
    const order = navOrder([
      makeTask({ id: "a1", order: 1 }),
      makeTask({ id: "b1", order: 2 }),
      makeTask({ id: "a2", order: 3, dependsOn: ["a1"] }),
      makeTask({ id: "a3", order: 4, dependsOn: ["a2"] }),
      makeTask({ id: "b2", order: 5, dependsOn: ["b1"] }),
    ]);
    expect(order).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });

  it("takes the topmost dependent first when a task has several", () => {
    const order = navOrder([
      makeTask({ id: "a", order: 1 }),
      makeTask({ id: "low", order: 2, priority: 3, dependsOn: ["a"] }),
      makeTask({ id: "high", order: 3, priority: 1, dependsOn: ["a"] }),
    ]);
    // `high` is the P1, so it is the one drawn at the top of that column
    expect(order).toEqual(["a", "high", "low"]);
  });

  it("visits a task with two prerequisites once", () => {
    const order = navOrder([
      makeTask({ id: "a", order: 1 }),
      makeTask({ id: "b", order: 2 }),
      makeTask({ id: "both", order: 3, dependsOn: ["a", "b"] }),
    ]);
    expect(order).toHaveLength(3);
    expect(new Set(order).size).toBe(3);
    expect(order.indexOf("both")).toBeGreaterThan(order.indexOf("a"));
  });

  it("starts from the far left, never from the middle of a chain", () => {
    const order = navOrder([
      makeTask({ id: "last", order: 1, dependsOn: ["first"] }),
      makeTask({ id: "first", order: 2 }),
    ]);
    expect(order).toEqual(["first", "last"]);
  });

  it("leaves nobody unreachable, cycle or no cycle", () => {
    const tasks = [
      makeTask({ id: "a", dependsOn: ["b"] }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "loner" }),
    ];
    expect(new Set(navOrder(tasks))).toEqual(new Set(["a", "b", "loner"]));
  });

  it("ignores a dependency on a task that no longer exists", () => {
    const order = navOrder([
      makeTask({ id: "a", dependsOn: ["ghost"] }),
      makeTask({ id: "b", dependsOn: ["a"] }),
    ]);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("layoutFlow with node heights", () => {
  it("moves what is stacked under a taller task down by the difference", () => {
    const tasks = [
      makeTask({ id: "tall", order: 1 }),
      makeTask({ id: "under", order: 2 }),
      makeTask({ id: "last", order: 3 }),
    ];
    const plain = layoutFlow(tasks);
    const grown = layoutFlow(tasks, new Map([["tall", FLOW.NODE_H + 50]]));
    expect(grown.get("tall")).toEqual(plain.get("tall"));
    expect(grown.get("under")!.y).toBe(plain.get("under")!.y + 50);
    expect(grown.get("last")!.y).toBe(plain.get("last")!.y + 50);
  });

  it("leaves other columns alone", () => {
    const tasks = [
      makeTask({ id: "a", order: 1 }),
      makeTask({ id: "b", order: 2, dependsOn: ["a"] }),
    ];
    const grown = layoutFlow(tasks, new Map([["a", FLOW.NODE_H + 80]]));
    expect(grown.get("b")).toEqual(layoutFlow(tasks).get("b"));
  });
});
