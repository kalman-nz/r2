import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { JobLineView, TrackedAt, TrackingStage, TrackingStep } from "./api";
import { orgFilter } from "./currentOrg";

// Equipment tracking (pb_hooks/lib/tracking.js): each organisation's steps
// kit goes through on its way to a project and back, and where everything
// on a project is. Units are counted at their step; progress for a line, a
// heading or a whole project comes from adding those up.

export const TRACKING_STAGES: { value: TrackingStage; label: string; hint: string }[] = [
  { value: "prep", label: "Getting ready", hint: "Pulled for the project, still in the building" },
  { value: "out", label: "Gone", hint: "Left with the project" },
  { value: "back", label: "Back", hint: "Returned to stock" },
];

const NO_STEPS: TrackingStep[] = [];

// The organisation's steps, in order (getting ready, gone, back).
export function useTrackingSteps() {
  const { data: steps = NO_STEPS, isLoading } = useQuery({
    queryKey: ["tracking-steps"],
    queryFn: () => pb.collection("tracking_steps").getFullList<TrackingStep>({ filter: orgFilter(), sort: "sortOrder,created" }),
    staleTime: 60_000,
  });
  return useMemo(() => ({ steps, isLoading, byId: new Map(steps.map((s) => [s.id, s])) }), [steps, isLoading]);
}

export function addAt(into: TrackedAt, more: TrackedAt | undefined): TrackedAt {
  for (const [step, n] of Object.entries(more ?? {})) into[step] = (into[step] ?? 0) + n;
  return into;
}

export interface Progress {
  total: number;
  // The furthest step every unit has reached, or null.
  current: TrackingStep | null;
  // The one after it, and how many units have reached that.
  next: TrackingStep | null;
  nextCount: number;
  // Units that have reached any step.
  started: number;
}

export function progressOf(steps: TrackingStep[], at: TrackedAt, total: number): Progress {
  // reached[i]: units at step i or further along.
  const reached = steps.map(() => 0);
  for (let i = steps.length - 1; i >= 0; i--) reached[i] = (at[steps[i].id] ?? 0) + (reached[i + 1] ?? 0);
  let current = -1;
  if (total > 0) for (let i = 0; i < steps.length; i++) if (reached[i] >= total) current = i;
  const next = current + 1 < steps.length ? current + 1 : -1;
  return {
    total,
    current: current >= 0 ? steps[current] : null,
    next: next >= 0 ? steps[next] : null,
    nextCount: next >= 0 ? reached[next] : 0,
    started: reached[0] ?? 0,
  };
}

// Physical lines' units added up (a heading, a kit, a whole project).
export function linesProgress(steps: TrackingStep[], lines: JobLineView[]): Progress | null {
  const tracked = lines.filter((l) => l.tracking);
  if (tracked.length === 0) return null;
  const at: TrackedAt = {};
  let total = 0;
  for (const l of tracked) {
    addAt(at, l.tracking!.at);
    total += Math.round(l.quantity);
  }
  return progressOf(steps, at, total);
}

export type Layout = "board" | "list";

const LAYOUT_KEY = "tracking.layout";

// Board or list, remembered in this browser (a convenience, so storage
// failing just means the default).
export function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "board";
    } catch {
      return "board";
    }
  });
  return [
    layout,
    (next) => {
      setLayout(next);
      try {
        localStorage.setItem(LAYOUT_KEY, next);
      } catch {
        // not remembered, that's all
      }
    },
  ];
}
