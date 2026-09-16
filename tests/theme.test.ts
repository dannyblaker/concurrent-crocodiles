import {
  THEME_SCRIPT,
  currentCanvas,
  currentTheme,
  setCanvas,
  setTheme,
  toggleCanvas,
  toggleTheme,
} from "@/lib/theme";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = () => document.documentElement;
const prefersLight = (matches: boolean) => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("light") && matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  );
};

/** the boot script is a string injected into <head>; run it the same way */
const runBootScript = () => new Function(THEME_SCRIPT)();

beforeEach(() => {
  root().removeAttribute("data-theme");
  root().removeAttribute("data-canvas");
  localStorage.clear();
});

describe("reading the current theme", () => {
  it("reports dark unless the attribute says light", () => {
    expect(currentTheme()).toBe("dark");
    root().dataset.theme = "light";
    expect(currentTheme()).toBe("light");
    root().dataset.theme = "dark";
    expect(currentTheme()).toBe("dark");
  });

  it("treats a nonsense attribute as dark", () => {
    root().dataset.theme = "banana";
    expect(currentTheme()).toBe("dark");
  });
});

describe("setting and toggling", () => {
  it("stamps the attribute and remembers the choice", () => {
    setTheme("light");
    expect(root().dataset.theme).toBe("light");
    expect(localStorage.getItem("crocodiles-theme")).toBe("light");
  });

  it("flips back and forth", () => {
    setTheme("dark");
    toggleTheme();
    expect(currentTheme()).toBe("light");
    toggleTheme();
    expect(currentTheme()).toBe("dark");
  });

  it("still applies the theme when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(() => setTheme("light")).not.toThrow();
    expect(root().dataset.theme).toBe("light");
  });
});

describe("the canvas preference", () => {
  it("is plain unless the attribute says water", () => {
    expect(currentCanvas()).toBe("plain");
    root().dataset.canvas = "water";
    expect(currentCanvas()).toBe("water");
    root().dataset.canvas = "puddle";
    expect(currentCanvas()).toBe("plain");
  });

  it("stamps the attribute and remembers the choice", () => {
    setCanvas("water");
    expect(root().dataset.canvas).toBe("water");
    expect(localStorage.getItem("crocodiles-canvas")).toBe("water");
  });

  it("flips back and forth", () => {
    toggleCanvas();
    expect(currentCanvas()).toBe("water");
    toggleCanvas();
    expect(currentCanvas()).toBe("plain");
  });

  it("still changes the canvas when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(() => setCanvas("water")).not.toThrow();
    expect(root().dataset.canvas).toBe("water");
  });
});

describe("the pre-paint boot script", () => {
  it("defaults the canvas to plain, and reads a saved water", () => {
    runBootScript();
    expect(root().dataset.canvas).toBe("plain");

    localStorage.setItem("crocodiles-canvas", "water");
    runBootScript();
    expect(root().dataset.canvas).toBe("water");
  });

  it("treats junk in the canvas slot as plain", () => {
    localStorage.setItem("crocodiles-canvas", "lava");
    runBootScript();
    expect(root().dataset.canvas).toBe("plain");
  });

  it("applies the canvas even when the theme read throws", () => {
    // one preference failing shouldn't cost the other: two try blocks, not one
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key === "crocodiles-theme") throw new Error("blocked");
      return "water";
    });
    runBootScript();
    expect(root().dataset.canvas).toBe("water");
  });

  it("round-trips with setCanvas: what one writes, the other restores", () => {
    setCanvas("water");
    root().removeAttribute("data-canvas");
    runBootScript();
    expect(currentCanvas()).toBe("water");
  });
  it("applies a saved preference", () => {
    localStorage.setItem("crocodiles-theme", "light");
    runBootScript();
    expect(root().dataset.theme).toBe("light");
  });

  it("falls back to the OS preference when nothing is saved", () => {
    prefersLight(true);
    runBootScript();
    expect(root().dataset.theme).toBe("light");

    root().removeAttribute("data-theme");
    prefersLight(false);
    runBootScript();
    expect(root().dataset.theme).toBe("dark");
  });

  it("prefers the saved choice over the OS setting", () => {
    prefersLight(true);
    localStorage.setItem("crocodiles-theme", "dark");
    runBootScript();
    expect(root().dataset.theme).toBe("dark");
  });

  it("ignores a junk value in storage", () => {
    prefersLight(false);
    localStorage.setItem("crocodiles-theme", "chartreuse");
    runBootScript();
    expect(root().dataset.theme).toBe("dark");
  });

  it("survives storage throwing, rather than leaving the page unstyled", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(runBootScript).not.toThrow();
  });

  it("round-trips with setTheme: what one writes, the other restores", () => {
    setTheme("light");
    root().removeAttribute("data-theme");
    runBootScript();
    expect(currentTheme()).toBe("light");
  });
});
