import FlowView from "@/components/FlowView";
import { MOVE_MS } from "@/lib/flow-motion";
import { Task } from "@/lib/types";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, seedStore } from "../app-state";
import { makeTask, resetFactory } from "../factory";

function renderFlow(tasks: Task[]) {
  seedStore(tasks);
  return render(<FlowView />);
}

const planTasks = () => app().plan.tasks;
const node = (title: string) =>
  screen.getByText(title).closest("[data-flow-node]") as HTMLElement;
/** where a node has come to rest, once the move is over */
const at = (title: string) => {
  const el = node(title);
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
};
/** let a move play out — see useFlowMotion */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MOVE_MS + 100);
  });
};

beforeEach(() => {
  resetFactory();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 28, 9, 0, 0));
});

describe("the canvas", () => {
  it("draws a node per task", () => {
    renderFlow(
      [
        makeTask({ id: "a", title: "Write report" }),
        makeTask({ id: "b", title: "Review PRs" }),
      ]
    );
    expect(screen.getAllByText(/Write report|Review PRs/)).toHaveLength(2);
    expect(node("Write report")).toBeInTheDocument();
  });

  it("draws one canvas, with no lane for anything to fall into", () => {
    renderFlow([makeTask({ title: "Anything" })]);
    expect(screen.queryByText(/focus — one at a time/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/parallel \/ background/i)).not.toBeInTheDocument();
    // the startable column is what runs at once; no task claims it alone
    expect(screen.queryByTitle("concurrent")).not.toBeInTheDocument();
  });

  it("lays every node out on first render, without storing anything", () => {
    renderFlow([
      makeTask({ id: "a", title: "First" }),
      makeTask({ id: "b", title: "Second", dependsOn: ["a"] }),
    ]);
    expect(at("First").x).toBeGreaterThan(0);
    expect(at("Second").x).toBeGreaterThan(at("First").x);
    expect(planTasks().some((t) => "flowX" in t)).toBe(false);
  });

  it("draws an arrow per dependency", () => {
    const { container } = renderFlow(
      [
        makeTask({ id: "a", title: "First" }),
        makeTask({ id: "b", title: "Second", dependsOn: ["a"] }),
      ]
    );
    expect(container.querySelectorAll("g[class*='cursor-pointer']")).toHaveLength(1);
    expect(screen.getByText(/First → Second/)).toBeInTheDocument();
  });

  it("marks blocked work on the node", () => {
    renderFlow(
      [makeTask({ title: "Ship it", blocked: "waiting on legal" })]
    );
    expect(screen.getByText(/waiting on legal/)).toBeInTheDocument();
  });

});

describe("interaction", () => {
  it("selects on click", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "Write report" })]);
    await user.click(node("Write report"));
    expect(app().selectedId).toBe("a");
  });

  it("retypes the description on the crocodile itself on double click", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "Write report" })]);
    const croc = node("Write report");
    await user.dblClick(croc);

    const box = within(croc).getByRole("textbox", { name: "Task description" });
    expect(box).toHaveValue("Write report");
    expect(box).toHaveFocus();
    // the words stay where they were; the side editor stays shut
    expect(app().editorOpen).toBe(false);

    await user.keyboard("Write the annual report{Enter}");
    expect(planTasks()[0].title).toBe("Write the annual report");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Write the annual report")).toBeInTheDocument();
  });

  it("puts the old description back on escape", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "Write report" })]);
    await user.dblClick(node("Write report"));
    await user.keyboard("Something else{Escape}");
    expect(planTasks()[0].title).toBe("Write report");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // and the escape stayed on the crocodile: nothing got deselected
    expect(app().selectedId).toBe("a");
  });

  it("keeps what was typed when the box loses focus, and never empties a task", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "Write report" })]);
    await user.dblClick(node("Write report"));
    await user.keyboard("  Draft it  ");
    await user.tab();
    expect(planTasks()[0].title).toBe("Draft it");

    await user.dblClick(node("Draft it"));
    await user.keyboard("{Backspace}");
    await user.tab();
    expect(planTasks()[0].title).toBe("Draft it");
  });

  it("marks a task done from its node", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "Write report" })]);
    await user.click(within(node("Write report")).getByLabelText("Mark task done"));
    expect(planTasks()[0].done).toBe(true);
    expect(app().selectedId).toBeNull(); // the click didn't fall through to the node
  });

  it("reopens a finished task from its node", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "Write report", done: true })]);
    await user.click(within(node("Write report")).getByLabelText("Reopen task"));
    expect(planTasks()[0].done).toBe(false);
  });

  it("removes a dependency when its arrow is clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderFlow(
      [
        makeTask({ id: "a", title: "First" }),
        makeTask({ id: "b", title: "Second", dependsOn: ["a"] }),
      ]
    );
    // the visible arrow is unclickable by design; the fat transparent path
    // beneath it is the hit target, and the click bubbles up to the group
    await user.click(container.querySelector('path[stroke="transparent"]')!);
    expect(planTasks().find((t) => t.id === "b")!.dependsOn).toEqual([]);
  });

  it("offers no arrange button — the board arranges itself", () => {
    renderFlow([makeTask({ title: "Anything" })]);
    expect(
      screen.queryByRole("button", { name: /auto-arrange/i })
    ).not.toBeInTheDocument();
  });
});

/**
 * The board is a picture of the graph, so an edit to the graph is an edit to the
 * picture — no gesture in between, and no jump cut either.
 */
describe("arranging itself", () => {
  it("lifts a task up the board when its priority goes up", async () => {
    renderFlow([
      makeTask({ id: "a", title: "First", priority: 2, order: 1 }),
      makeTask({ id: "b", title: "Second", priority: 3, order: 2 }),
    ]);
    const [top, bottom] = [at("First").y, at("Second").y];
    expect(bottom).toBeGreaterThan(top);

    act(() => app().setPriority("b", 1));
    await settle();

    // they have traded rows, and the P1 is the one on top
    expect(at("Second").y).toBe(top);
    expect(at("First").y).toBe(bottom);
  });

  it("takes a whole second over it, rather than cutting", async () => {
    renderFlow([
      makeTask({ id: "a", title: "First", priority: 2, order: 1 }),
      makeTask({ id: "b", title: "Second", priority: 3, order: 2 }),
    ]);
    const [top, bottom] = [at("First").y, at("Second").y];

    act(() => app().setPriority("b", 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOVE_MS / 2);
    });

    // halfway there: between where it was and where it is going, at neither end
    const y = at("Second").y;
    expect(y).toBeLessThan(bottom);
    expect(y).toBeGreaterThan(top);
  });

  it("drags the prerequisites of an urgent task up with it", async () => {
    renderFlow([
      makeTask({ id: "busy", title: "Busywork", priority: 2, order: 1 }),
      makeTask({ id: "dull", title: "Dull but needed", priority: 3, order: 2 }),
      makeTask({ id: "big", title: "The big one", priority: 3, order: 3, dependsOn: ["dull"] }),
    ]);
    expect(at("Dull but needed").y).toBeGreaterThan(at("Busywork").y);

    act(() => app().setPriority("big", 1));
    await settle();

    expect(at("Dull but needed").y).toBeLessThan(at("Busywork").y);
  });

  it("puts a new task in the column its dependency earns it", async () => {
    renderFlow([makeTask({ id: "a", title: "First" })]);
    act(() => app().quickAdd("Second >First"));
    await settle();
    expect(at("Second").x).toBeGreaterThan(at("First").x);
  });
});

/**
 * The arrow and the task on the end of it are the same gesture: every way of
 * starting one asks for a title, and wires the dependency when you give it.
 * (Dragging is only meaningful with real geometry — that half lives in e2e.)
 */
describe("growing the graph forwards", () => {
  const port = (title: string) =>
    within(node(title)).getByTitle(/drag to another task/);
  const createInput = () => screen.getByPlaceholderText(/New task/);

  it("asks for a new task when the port is clicked", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "First" })]);

    await user.click(port("First"));
    expect(createInput()).toHaveAttribute(
      "placeholder",
      expect.stringContaining("First")
    );

    await user.type(createInput(), "Second job !1{Enter}");
    const created = planTasks().find((t) => t.title === "Second job")!;
    expect(created.dependsOn).toEqual(["a"]);
    expect(created.priority).toBe(1);
  });

  it("puts the new task to the right of the one it waits on", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "First" })]);

    await user.click(port("First"));
    await user.type(createInput(), "Second job{Enter}");
    await settle();
    expect(at("Second job").x).toBeGreaterThan(at("First").x);
    expect(at("Second job").y).toBe(at("First").y);
  });

  it("creates nothing if the input is dismissed", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "First" })]);

    await user.click(port("First"));
    await user.type(createInput(), "Never mind{Escape}");
    expect(planTasks()).toHaveLength(1);
  });

  it("opens the same input for the selected task on request", async () => {
    const user = userEvent.setup();
    renderFlow([
      makeTask({ id: "a", title: "First" }),
      makeTask({ id: "b", title: "Other" }),
    ]);

    act(() => app().requestNewTaskFrom("b"));
    await user.type(createInput(), "Follow-up{Enter}");
    expect(planTasks().find((t) => t.title === "Follow-up")!.dependsOn).toEqual([
      "b",
    ]);
  });

  it("reopens on a second request for the same task", async () => {
    const user = userEvent.setup();
    renderFlow([makeTask({ id: "a", title: "First" })]);

    act(() => app().requestNewTaskFrom("a"));
    await user.type(createInput(), "One{Enter}");
    act(() => app().requestNewTaskFrom("a"));
    await user.type(createInput(), "Two{Enter}");

    expect(planTasks().map((t) => t.title)).toEqual(["First", "One", "Two"]);
  });
});
