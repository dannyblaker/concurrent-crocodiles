"use client";

import { useEffect, useState } from "react";
import { FlowPos } from "./flow";

/**
 * How long a task takes to swim to its new place. Long enough to follow one
 * crocodile with your eyes while the rest of the board rearranges itself, which
 * is the whole point of animating it: you keep the thing you were looking at.
 */
export const MOVE_MS = 1000;

/** Slow at both ends: a board that shoves is a board you have to re-read. */
const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** the positions themselves, so a re-layout onto the same spots isn't a move */
const signature = (positions: Map<string, FlowPos>) =>
  [...positions].map(([id, p]) => `${id}@${p.x},${p.y}`).join("|");

/**
 * Where to draw each task, given where the layout says it belongs.
 *
 * The layout is a pure function of the graph, so every edit hands the canvas a
 * whole new set of positions at once; this is what stops that being a jump cut.
 * It tweens rather than handing the job to CSS because the arrows have to arrive
 * with the nodes — an SVG path can't transition, so every frame is a render and
 * the edges are drawn from the same in-between positions the nodes are.
 *
 * New positions are taken up during the render that brings them, not in the
 * effect that follows it: a task carries on being drawn where it already was,
 * and the tween moves it from there. Do it in the effect and the first frame
 * paints the destination before the animation has anything to say, which is a
 * jump cut with a slide after it.
 *
 * So a task seen for the first time is not animated — it simply appears where it
 * belongs, because a new node sliding in from wherever the last one was is a lie
 * about what just happened. Re-targeting mid-flight is free: the next tween
 * starts from wherever the node has got to, so a second edit during the first
 * second bends the path instead of restarting it.
 *
 * `snap` asks for the new positions to be taken up outright, with no move at
 * all. The canvas uses it for the layout that follows its first measurement of
 * the nodes, which arrives before anything has been painted: there is nothing on
 * screen for a task to slide from, so a slide would be a lie of the same kind.
 */
export function useFlowMotion(
  targets: Map<string, FlowPos>,
  ms = MOVE_MS,
  snap = false
): Map<string, FlowPos> {
  const [live, setLive] = useState(targets);
  const [drawn, setDrawn] = useState(() => signature(targets));
  const key = signature(targets);

  if (drawn !== key) {
    setDrawn(key);
    if (snap) setLive(targets);
    // otherwise the new cast list, each still standing where it was last seen
    else
      setLive((at) => {
        const held = new Map(targets);
        for (const [id, p] of at) if (held.has(id)) held.set(id, p);
        return held;
      });
  }

  useEffect(() => {
    const moving = new Map<string, FlowPos>();
    for (const [id, to] of targets) {
      const at = live.get(id);
      if (at && (at.x !== to.x || at.y !== to.y)) moving.set(id, at);
    }
    if (!moving.size) return;

    // asked, not assumed — and the jump still goes through a frame, so nothing
    // sets state in the middle of a render
    if (reducedMotion()) {
      const jump = requestAnimationFrame(() => setLive(new Map(targets)));
      return () => cancelAnimationFrame(jump);
    }

    // timed from the first frame rather than from a clock read here: those are
    // two different clocks, and the wait for that frame is not part of the move
    let raf = 0;
    let t0 = 0;
    const step = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / ms);
      const e = ease(p);
      // built on the targets, so a task that has gone drops out of the tween
      const next = new Map(targets);
      for (const [id, at] of moving) {
        const to = targets.get(id)!;
        next.set(id, {
          x: at.x + (to.x - at.x) * e,
          y: at.y + (to.y - at.y) * e,
        });
      }
      setLive(next);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `live` is where this tween starts from, not a reason to start another one,
    // so it is deliberately not a dependency. The positions are, via the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);

  return live;
}
