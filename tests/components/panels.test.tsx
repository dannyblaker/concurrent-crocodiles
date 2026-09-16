import CanvasToggle from "@/components/CanvasToggle";
import DoneButton from "@/components/DoneButton";
import Editor from "@/components/Editor";
import GoalsPanel from "@/components/GoalsPanel";
import HelpOverlay from "@/components/HelpOverlay";
import QuickAdd from "@/components/QuickAdd";
import ThemeToggle from "@/components/ThemeToggle";
import WaterSurface from "@/components/WaterSurface";
import { currentCanvas, currentTheme } from "@/lib/theme";
import { Task } from "@/lib/types";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, seedStore } from "../app-state";
import { makeTask, resetFactory } from "../factory";

const planTasks = () => app().plan.tasks;

beforeEach(() => {
  resetFactory();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 28, 9, 0, 0));
});

describe("ThemeToggle", () => {
  it("flips the theme on click", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(currentTheme()).toBe("dark");
    await user.click(screen.getByRole("button", { name: /toggle light or dark/i }));
    expect(currentTheme()).toBe("light");
    await user.click(screen.getByRole("button", { name: /toggle light or dark/i }));
    expect(currentTheme()).toBe("dark");
  });

  it("renders both glyphs, leaving the choice of which shows to CSS", () => {
    render(<ThemeToggle />);
    // server and client render the same markup — that's what avoids the flash
    expect(document.querySelector(".theme-when-dark")).toBeInTheDocument();
    expect(document.querySelector(".theme-when-light")).toBeInTheDocument();
  });

  it("mentions the keyboard shortcut only where one exists", () => {
    const { unmount } = render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /toggle/i })).toHaveAttribute(
      "title",
      expect.stringContaining("(m)")
    );
    unmount();
    render(<ThemeToggle hint={false} />);
    expect(screen.getByRole("button", { name: /toggle/i }).title).not.toContain("(m)");
  });
});

describe("CanvasToggle", () => {
  it("flips the canvas on click", async () => {
    const user = userEvent.setup();
    render(<CanvasToggle />);
    expect(currentCanvas()).toBe("plain");
    await user.click(screen.getByRole("button", { name: /animated water/i }));
    expect(currentCanvas()).toBe("water");
    await user.click(screen.getByRole("button", { name: /animated water/i }));
    expect(currentCanvas()).toBe("plain");
  });

  it("renders both glyphs, leaving the choice of which shows to CSS", () => {
    render(<CanvasToggle />);
    expect(document.querySelector(".canvas-when-water")).toBeInTheDocument();
    expect(document.querySelector(".canvas-when-plain")).toBeInTheDocument();
  });
});

/**
 * The pool holds still; what moves is the odd ripple. Which means the interesting
 * behaviour is all about *not* animating: not while the canvas is plain, and not for
 * someone who asked for less motion.
 */
describe("WaterSurface", () => {
  const ripples = () => document.querySelectorAll(".croc-ripple");
  const root = () => document.documentElement;

  beforeEach(() => {
    root().dataset.canvas = "water";
    // the shortest gap the component will pick, so the wait below is exact
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("drops a ripple in, after a while", () => {
    render(<WaterSurface />);
    expect(ripples()).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(5100));
    expect(ripples()).toHaveLength(1);
  });

  it("takes it away again", () => {
    render(<WaterSurface />);
    act(() => void vi.advanceTimersByTime(5100));
    act(() => void vi.advanceTimersByTime(3100));
    expect(ripples()).toHaveLength(0);
  });

  it("leaves a plain canvas alone", () => {
    root().dataset.canvas = "plain";
    render(<WaterSurface />);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(ripples()).toHaveLength(0);
  });

  it("holds still for anyone who asked for less motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({ matches: query.includes("reduced-motion"), media: query }) as MediaQueryList
    );
    render(<WaterSurface />);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(ripples()).toHaveLength(0);
  });
});

describe("DoneButton", () => {
  it("labels itself by what it will do", () => {
    const { rerender } = render(<DoneButton done={false} onToggle={() => {}} />);
    expect(screen.getByLabelText("Mark task done")).toHaveTextContent("✓");
    rerender(<DoneButton done onToggle={() => {}} />);
    expect(screen.getByLabelText("Reopen task")).toHaveTextContent("↺");
  });

  it("keeps its click away from the card underneath", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCardClick = vi.fn();
    const onCardPointerDown = vi.fn();
    render(
      <div onClick={onCardClick} onPointerDown={onCardPointerDown}>
        <DoneButton done={false} onToggle={onToggle} />
      </div>
    );
    await user.click(screen.getByLabelText("Mark task done"));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardPointerDown).not.toHaveBeenCalled();
  });
});

describe("QuickAdd", () => {
  beforeEach(() => seedStore());

  it("adds a parsed task on Enter and clears the field for the next one", async () => {
    const user = userEvent.setup();
    render(<QuickAdd />);
    const input = screen.getByPlaceholderText(/Add task/);
    await user.type(input, "Write report !1{Enter}");
    expect(planTasks()[0]).toMatchObject({
      title: "Write report",
      priority: 1,
    });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("ignores an empty submission", async () => {
    const user = userEvent.setup();
    render(<QuickAdd />);
    await user.type(screen.getByPlaceholderText(/Add task/), "   {Enter}");
    expect(planTasks()).toHaveLength(0);
  });
});

describe("Editor", () => {
  const openEditorOn = (tasks: Task[], id: string) => {
    seedStore(tasks);
    app().select(id);
    app().setEditorOpen(true);
    return render(<Editor />);
  };

  it("shows the derived status, and only lets you set the done part", async () => {
    const user = userEvent.setup();
    openEditorOn(
      [
        makeTask({ id: "a", title: "First" }),
        makeTask({ id: "b", title: "Second", dependsOn: ["a"] }),
      ],
      "b"
    );
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText(/Waiting on 1 unfinished prerequisite\./)).toBeInTheDocument();

    // finishing the prerequisite promotes this one, with nothing stored
    app().setDone("a", true);
    expect(await screen.findByText("In progress")).toBeInTheDocument();
    expect(screen.getByText(/startable now/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mark done/i }));
    expect(planTasks().find((t) => t.id === "b")!.done).toBe(true);
    expect(await screen.findByText("Done")).toBeInTheDocument();
  });

  it("names the blocker instead, when there is one", () => {
    openEditorOn([makeTask({ id: "a", blocked: "waiting on legal" })], "a");
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("Blocked: waiting on legal")).toBeInTheDocument();
  });

  it("stays closed until a task is selected and opened", () => {
    seedStore([makeTask({ id: "a" })]);
    render(<Editor />);
    expect(screen.queryByText("Edit task")).not.toBeInTheDocument();
  });

  it("edits the title", async () => {
    const user = userEvent.setup();
    openEditorOn([makeTask({ id: "a", title: "Old" })], "a");
    const title = screen.getByDisplayValue("Old");
    await user.clear(title);
    await user.type(title, "New");
    expect(planTasks()[0].title).toBe("New");
  });

  it("sets priority from the P buttons", async () => {
    const user = userEvent.setup();
    openEditorOn([makeTask({ id: "a" })], "a");
    await user.click(screen.getByRole("button", { name: "P1" }));
    expect(planTasks()[0].priority).toBe(1);
  });

  it("assigns a goal", async () => {
    const user = userEvent.setup();
    openEditorOn([makeTask({ id: "a" })], "a");
    await user.selectOptions(screen.getByRole("combobox"), "g1");
    expect(planTasks()[0].goalId).toBe("g1");
  });

  it("blocks a task by typing a reason", async () => {
    const user = userEvent.setup();
    openEditorOn([makeTask({ id: "a" })], "a");
    await user.type(screen.getByPlaceholderText(/reason/), "waiting");
    expect(planTasks()[0].blocked).toBe("waiting");
  });

  it("links a dependency, and refuses one that would cycle", async () => {
    const user = userEvent.setup();
    openEditorOn(
      [
        makeTask({ id: "a", title: "First" }),
        makeTask({ id: "b", title: "Second" }),
      ],
      "a"
    );
    await user.click(screen.getByLabelText("Second"));
    expect(planTasks()[0].dependsOn).toEqual(["b"]);

    // now edit Second: depending on First would close the loop
    app().select("b");
    expect(await screen.findByTitle(/would create a dependency cycle/)).toBeInTheDocument();
    expect(screen.getByLabelText("First")).toBeDisabled();
  });

  it("defers and deletes", async () => {
    const user = userEvent.setup();
    openEditorOn([makeTask({ id: "a", title: "Only" })], "a");
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(planTasks()).toHaveLength(0);
  });

});

describe("GoalsPanel", () => {
  it("counts tasks done against tasks mapped, per goal", () => {
    seedStore(
      [
        makeTask({ goalId: "g1", done: true }),
        makeTask({ goalId: "g1" }),
        makeTask({ goalId: "g1" }),
      ]
    );
    render(<GoalsPanel />);
    expect(screen.getByText("deep-work")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("counts tasks with no goal", () => {
    seedStore([makeTask({}), makeTask({})]);
    render(<GoalsPanel />);
    expect(screen.getByText(/2 tasks not mapped to a goal/)).toBeInTheDocument();
  });

  it("adds a goal on Enter", async () => {
    const user = userEvent.setup();
    seedStore();
    render(<GoalsPanel />);
    await user.type(screen.getByPlaceholderText("+ new goal"), "reading{Enter}");
    expect(app().plan.goals.map((g) => g.name)).toContain("reading");
  });

  it("deletes a goal", async () => {
    const user = userEvent.setup();
    seedStore();
    render(<GoalsPanel />);
    await user.click(screen.getByTitle("delete goal"));
    expect(app().plan.goals).toHaveLength(0);
  });
});

describe("HelpOverlay", () => {
  it("shows only when asked", async () => {
    const user = userEvent.setup();
    seedStore();
    render(<HelpOverlay />);
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();

    app().setHelpOpen(true);
    expect(await screen.findByText("Keyboard shortcuts")).toBeInTheDocument();
    await user.click(screen.getByText("✕"));
    expect(app().helpOpen).toBe(false);
  });

  it("documents the shortcuts the app actually listens for", () => {
    seedStore();
    app().setHelpOpen(true);
    render(<HelpOverlay />);
    for (const key of ["d", "b", "s", "m", "u / ⌘Z", "?"]) {
      expect(screen.getByText(key, { selector: "kbd" })).toBeInTheDocument();
    }
  });
});
