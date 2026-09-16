import { expect, flowNode, quickAdd, row, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Concurrent Crocodiles" })).toBeVisible();
});

test.describe("the morning brain-dump", () => {
  test("adds tasks to the list and the canvas at once", async ({ page, planServer }) => {
    await quickAdd(page, "Draft the proposal !1 #deep-work", "Draft the proposal");
    await quickAdd(page, "Review PRs !2", "Review PRs");

    await expect(page.getByText("In progress · 2")).toBeVisible();
    await expect(flowNode(page, "Draft the proposal")).toBeVisible();
    await expect(flowNode(page, "Draft the proposal").getByText("deep-work")).toBeVisible();
    await expect(row(page, "Draft the proposal").getByText("deep-work")).toBeVisible();

    await planServer.settled();
    expect(planServer.titles()).toEqual(["Draft the proposal", "Review PRs"]);
  });

  test("writes nothing back just for opening the app", async ({ page, planServer }) => {
    await page.waitForTimeout(1200); // well past the 600ms autosave debounce
    expect(planServer.saveCount()).toBe(0);
  });

  test("keeps the input focused so tasks can be typed in a row", async ({ page }) => {
    const input = page.getByPlaceholder(/Add task/);
    await input.fill("First task");
    await input.press("Enter");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
  });

  test("puts an urgent task at the front of the queue", async ({ page, planServer }) => {
    await quickAdd(page, "Normal work", "Normal work");
    await quickAdd(page, "Hotfix ^", "Hotfix");
    await planServer.settled();

    const order = planServer
      .tasks()
      .sort((a, b) => a.order - b.order)
      .map((t) => t.title);
    expect(order).toEqual(["Hotfix", "Normal work"]);
  });

  test("links a dependent task to its prerequisite", async ({ page }) => {
    await quickAdd(page, "Design it", "Design it");
    await quickAdd(page, "Build it >design", "Build it");

    await expect(row(page, "Build it").getByTitle("has dependencies")).toHaveText(/1/);
    // an arrow on the canvas, drawn from the prerequisite to the dependent
    await expect(page.locator("g.cursor-pointer")).toHaveCount(1);
    await expect(page.locator("svg title")).toContainText("Design it");
  });

  test("holds a blocked task at to-do, flagged on the canvas", async ({ page }) => {
    await quickAdd(page, "Ship it *waiting-on-legal", "Ship it");
    await expect(page.getByText("To do · 1")).toBeVisible();
    await expect(page.getByText(/waiting on legal/).first()).toBeVisible();
    await expect(flowNode(page, "Ship it").getByText(/waiting on legal/)).toBeVisible();
  });

  /**
   * Nothing marks a task as the concurrent one — `~` is just a word in a title.
   * What runs at once is whatever is startable, which is a fact of the graph
   * rather than of a label.
   */
  test("puts unrelated work on the one canvas, unmarked and startable", async ({ page }) => {
    await quickAdd(page, "Focus work", "Focus work");
    await quickAdd(page, "CI pipeline ~", "CI pipeline ~");

    await expect(page.getByText("In progress · 2")).toBeVisible();
    await expect(flowNode(page, "CI pipeline ~").getByTitle("concurrent")).toHaveCount(0);
  });
});

test.describe("marking work done", () => {
  test.beforeEach(async ({ page }) => {
    await quickAdd(page, "Write the report", "Write the report");
  });

  test("from the sidebar row", async ({ page, planServer }) => {
    await row(page, "Write the report").hover();
    await row(page, "Write the report").getByRole("button", { name: /done/i }).click();
    await expect(page.getByText("Done · 1")).toBeVisible();
    await planServer.settled();
    expect(planServer.tasks()[0].done).toBe(true);
  });

  test("from the flowchart node, and back again", async ({ page, planServer }) => {
    await page.locator("body").click();
    const node = flowNode(page, "Write the report");
    await node.hover();
    await node.getByLabel("Mark task done").click();
    await expect(page.getByText("Done · 1")).toBeVisible();

    await node.hover();
    await node.getByLabel("Reopen task").click();
    await expect(page.getByText("In progress · 1")).toBeVisible();
    await planServer.settled();
    expect(planServer.tasks()[0].done).toBe(false);
  });

  test("with the d key", async ({ page }) => {
    await page.locator("body").click();
    await page.keyboard.press("g");
    await page.keyboard.press("d");
    await expect(page.getByText("Done · 1")).toBeVisible();
    await page.keyboard.press("d");
    await expect(page.getByText("In progress · 1")).toBeVisible();
  });
});

test.describe("the flowchart", () => {
  /**
   * Nothing on the board is placed by hand, so a drag over a crocodile means the
   * same as a drag over the water: shift the view. What it must not do is move
   * the task, select it, or mark it done on the way past.
   */
  test("pans the board when a node is dragged, and leaves the task alone", async ({
    page,
    planServer,
  }) => {
    await quickAdd(page, "Write the report", "Write the report");
    await page.locator("body").click();
    await page.keyboard.press("Escape"); // quick-add selects what it made
    await planServer.settled();
    const savesBefore = planServer.saveCount();

    const node = flowNode(page, "Write the report");
    const before = (await node.boundingBox())!;
    const placedAt = await node.evaluate((el) => (el as HTMLElement).style.left);

    await page.mouse.move(before.x + 60, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(before.x - 140, before.y + 20, { steps: 10 });
    await page.mouse.up();

    // the view moved; the crocodile is exactly where the layout left it
    expect((await node.boundingBox())!.x).toBeLessThan(before.x);
    expect(await node.evaluate((el) => (el as HTMLElement).style.left)).toBe(placedAt);
    await expect(node).not.toHaveClass(/is-selected/);
    await expect(node.getByLabel("Mark task done")).toBeVisible();
    expect(planServer.saveCount()).toBe(savesBefore); // nothing to save: nothing changed
  });

  /**
   * The point of the whole thing: priority is the only handle on where work sits,
   * and using it rearranges the board under you. This is the reduced-motion path,
   * which the whole suite runs in — it arrives, it just doesn't swim there.
   */
  test("re-sorts itself when a priority changes", async ({ page }) => {
    await quickAdd(page, "Small thing", "Small thing");
    await quickAdd(page, "The big one", "The big one");

    const small = flowNode(page, "Small thing");
    const big = flowNode(page, "The big one");
    const above = async () =>
      (await big.boundingBox())!.y < (await small.boundingBox())!.y;
    expect(await above()).toBe(false);

    await big.click();
    await page.keyboard.press("1");

    await expect.poll(above, { timeout: 3000 }).toBe(true);
  });

  test("draws and removes a dependency arrow", async ({ page, planServer }) => {
    await quickAdd(page, "First job", "First job");
    await quickAdd(page, "Second job", "Second job");
    await page.locator("body").click();

    const source = flowNode(page, "First job");
    const target = flowNode(page, "Second job");
    const port = source.locator("div[title^='drag to another task']");
    const portBox = (await port.boundingBox())!;
    const targetBox = (await target.boundingBox())!;

    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 10,
    });
    await page.mouse.up();

    await planServer.settled();
    const second = planServer.tasks().find((t) => t.title === "Second job")!;
    const first = planServer.tasks().find((t) => t.title === "First job")!;
    expect(second.dependsOn).toEqual([first.id]);

    // clicking the arrow removes it again
    await page.locator("path[stroke='transparent']").first().click({ force: true });
    await planServer.settled();
    expect(planServer.tasks().find((t) => t.title === "Second job")!.dependsOn).toEqual([]);
  });

  test("drags an arrow into empty space and names the task on the end of it", async ({
    page,
    planServer,
  }) => {
    await quickAdd(page, "First job", "First job");
    await page.locator("body").click();

    const source = flowNode(page, "First job");
    const port = source.locator("div[title^='drag to another task']");
    const portBox = (await port.boundingBox())!;

    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(portBox.x + 300, portBox.y + 160, { steps: 10 });
    await page.mouse.up();

    // nothing exists yet — the arrow is waiting on a title
    await page.getByPlaceholder(/New task/).fill("Second job");
    await page.getByPlaceholder(/New task/).press("Enter");

    await expect(flowNode(page, "Second job")).toBeVisible();
    await planServer.settled();
    const first = planServer.tasks().find((t) => t.title === "First job")!;
    const second = planServer.tasks().find((t) => t.title === "Second job")!;
    expect(second.dependsOn).toEqual([first.id]);
    // and it lands in the next column, not where the mouse was let go
    await expect
      .poll(
        async () =>
          (await flowNode(page, "Second job").boundingBox())!.x >
          (await flowNode(page, "First job").boundingBox())!.x
      )
      .toBe(true);
  });

  test("creates a dependent task from the keyboard with a", async ({ page, planServer }) => {
    await quickAdd(page, "First job", "First job");
    await page.locator("body").click();
    await page.keyboard.press("g");
    await page.keyboard.press("a");

    await page.getByPlaceholder(/New task/).fill("Second job");
    await page.getByPlaceholder(/New task/).press("Enter");

    // the new task is selected, so a again chains a third off the second
    await page.keyboard.press("a");
    await page.getByPlaceholder(/New task/).fill("Third job");
    await page.getByPlaceholder(/New task/).press("Enter");

    await planServer.settled();
    const id = (title: string) => planServer.tasks().find((t) => t.title === title)!.id;
    expect(planServer.tasks().find((t) => t.title === "Second job")!.dependsOn).toEqual([
      id("First job"),
    ]);
    expect(planServer.tasks().find((t) => t.title === "Third job")!.dependsOn).toEqual([
      id("Second job"),
    ]);
  });

  test("opens the editor beside the canvas, not off-screen", async ({ page }) => {
    await quickAdd(page, "Write the report", "Write the report");
    await page.locator("body").click();

    await flowNode(page, "Write the report").click();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("complementary").filter({ hasText: "Edit task" });
    await expect(editor).toBeInViewport();
    await expect(editor.getByRole("textbox").first()).toHaveValue("Write the report");
  });

  test("retypes a description on the crocodile itself", async ({ page }) => {
    await quickAdd(page, "Write the report", "Write the report");
    await page.locator("body").click();

    const croc = flowNode(page, "Write the report");
    await croc.dblclick();
    const box = croc.getByRole("textbox", { name: "Task description" });
    await expect(box).toHaveValue("Write the report");
    await expect(page.getByText("Edit task")).toBeHidden();

    await box.fill("Write the annual report");
    await page.keyboard.press("Enter");
    await expect(flowNode(page, "Write the annual report")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Task description" })).toHaveCount(0);

    // and it stuck: the list row says so too
    await expect(page.locator("[data-task-row]").filter({ hasText: "Write the annual report" })).toBeVisible();
  });

  test("creates a task by double-clicking the canvas", async ({ page, planServer }) => {
    // the water itself, clear of any crocodile: a double-click on one edits it
    await page.locator(".croc-water").dblclick({ position: { x: 400, y: 300 } });
    await page.getByPlaceholder(/New task/).fill("Made on the canvas");
    await page.getByPlaceholder(/New task/).press("Enter");

    await expect(flowNode(page, "Made on the canvas")).toBeVisible();
    await planServer.settled();
    expect(planServer.titles()).toContain("Made on the canvas");
  });
});

/**
 * The suite runs reduced-motion (see playwright.config.ts), which is exactly the
 * path where a task teleports. This is the other one: the board moves, and it
 * takes its time about it.
 */
test.describe("the board in motion", () => {
  // through contextOptions, because that is how the config sets it and the
  // low-level option wins over the named one
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("swims a task to its new row instead of cutting to it", async ({ page }) => {
    await quickAdd(page, "Small thing", "Small thing");
    await quickAdd(page, "The big one", "The big one");

    const big = flowNode(page, "The big one");
    await big.click();
    await page.keyboard.press("1");

    // sampled across the move, which takes about a second
    const ys: number[] = [];
    for (let i = 0; i < 20; i++) {
      ys.push((await big.boundingBox())!.y);
      await page.waitForTimeout(40);
    }
    const [from, to] = [ys[0], ys[ys.length - 1]];
    // it started where it was — no frame of it at the destination first
    expect(to).toBeLessThan(from);
    // and it was seen on the way, rather than only at either end
    expect(ys.some((y) => y < from && y > to)).toBe(true);
    // still climbing, or arrived: never doubling back
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
  });
});
