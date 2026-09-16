export type Theme = "light" | "dark";
/** What the flowchart floats on: animated water, or a quiet grid. */
export type CanvasStyle = "water" | "plain";

const KEY = "crocodiles-theme";
const CANVAS_KEY = "crocodiles-canvas";
const SWEEP_KEY = "crocodiles-sweep";

/**
 * Runs synchronously in <head>, before first paint: picks this device's theme,
 * canvas and sweep (or the OS preference, for the theme) and stamps them on
 * <html>, so the server-rendered defaults never flash. See
 * node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
 *
 * A try block each rather than one around the lot: a storage read that throws
 * should cost the preference it was reading and nothing else. Whatever it can't
 * set keeps the value the server rendered.
 */
export const THEME_SCRIPT = `(function(){var r=document.documentElement;try{var t=localStorage.getItem(${JSON.stringify(
  KEY
)});if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";r.dataset.theme=t}catch(e){}try{r.dataset.canvas=localStorage.getItem(${JSON.stringify(
  CANVAS_KEY
)})==="water"?"water":"plain"}catch(e){}try{r.dataset.sweep=localStorage.getItem(${JSON.stringify(
  SWEEP_KEY
)})==="off"?"off":"on"}catch(e){}})()`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private mode / storage disabled — the choice just won't survive a reload
  }
}

/** Flip light ⇄ dark. State lives in the DOM + localStorage, not in React:
 *  the UI that depends on it is styled by `[data-theme]` in globals.css. */
export function toggleTheme() {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** Plain unless the attribute says otherwise — the swamp is opt-in. */
export function currentCanvas(): CanvasStyle {
  return document.documentElement.dataset.canvas === "water" ? "water" : "plain";
}

export function setCanvas(style: CanvasStyle) {
  document.documentElement.dataset.canvas = style;
  try {
    localStorage.setItem(CANVAS_KEY, style);
  } catch {
    // as above: the canvas still changes, it just won't be remembered
  }
}

/** Flip plain ⇄ water, by exactly the same means as the theme. */
export function toggleCanvas() {
  setCanvas(currentCanvas() === "plain" ? "water" : "plain");
}

/**
 * Whether finished work sweeps itself off the board. On unless this device has
 * said otherwise — a board you have to tidy is a board that stays untidy.
 *
 * Read from the attribute rather than from storage so it is the same answer the
 * boot script already gave, before first paint. The behaviour it drives lives in
 * lib/auto-delete.ts; the store keeps a copy so React can react to it.
 */
export function currentSweep(): boolean {
  return document.documentElement.dataset.sweep !== "off";
}

export function setSweep(on: boolean) {
  document.documentElement.dataset.sweep = on ? "on" : "off";
  try {
    localStorage.setItem(SWEEP_KEY, on ? "on" : "off");
  } catch {
    // as above: it still applies, it just won't be remembered
  }
}
