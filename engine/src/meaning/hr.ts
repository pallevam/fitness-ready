/**
 * Heart-rate artefact detection. Wrist optical HR can lock onto cadence or
 * lose contact and report a brief, implausible peak (the 181 bpm of 1 Nov
 * during indoor cardio). Two rules, either of which flags:
 *
 * 1. Fast rise: HR climbing faster than 5 bpm/s across at least two
 *    consecutive sample intervals. A heart accelerates a few bpm per second at
 *    most under effort; one fast interval alone can be sampling jitter, so it
 *    takes two in a row.
 * 2. Isolated peak: samples more than 25 bpm above the median of the ~60 s
 *    around them, for under 15 s. A real effort that high lasts longer and
 *    drags its own median up with it.
 */

import type { Flag, Sample } from "../model.ts";
import { clock, round } from "./time.ts";

export const HR_SPIKE_MAX_RISE_BPM_PER_S = 5;
export const HR_SPIKE_MIN_FAST_INTERVALS = 2;
export const HR_PEAK_WINDOW_S = 60;
export const HR_PEAK_EXCESS_BPM = 25;
export const HR_PEAK_MAX_DURATION_S = 15;

interface Point {
  t: string;
  s: number;
  hr: number;
}

interface Spike {
  peak: Point;
  from: number; // elapsed_s where the spike starts
  to: number; // elapsed_s where it ends
  message: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function fastRises(points: Point[]): Spike[] {
  const spikes: Spike[] = [];
  let i = 0;
  while (i < points.length - 1) {
    // Find a run of consecutive intervals each rising faster than the limit.
    let j = i;
    while (j < points.length - 1) {
      const a = points[j]!;
      const b = points[j + 1]!;
      const dt = b.s - a.s;
      if (dt <= 0 || (b.hr - a.hr) / dt <= HR_SPIKE_MAX_RISE_BPM_PER_S) break;
      j++;
    }
    if (j - i >= HR_SPIKE_MIN_FAST_INTERVALS) {
      // The peak is where the climb stops, which may be after the fast part.
      let k = j;
      while (k < points.length - 1 && points[k + 1]!.hr >= points[k]!.hr) k++;
      const start = points[i]!;
      const peak = points[k]!;
      const seconds = peak.s - start.s;
      const rate = round((peak.hr - start.hr) / seconds, 1);
      spikes.push({
        peak,
        from: start.s,
        to: peak.s,
        message:
          `HR ${peak.hr} bpm at ${clock(peak.t)} is likely a sensor artefact: it rose from ` +
          `${start.hr} to ${peak.hr} bpm in ${seconds} s (${rate} bpm/s), faster than the ` +
          `${HR_SPIKE_MAX_RISE_BPM_PER_S} bpm/s a heart can sustain.`,
      });
      i = k;
    } else {
      i = Math.max(j, i + 1);
    }
  }
  return spikes;
}

function isolatedPeaks(points: Point[]): Spike[] {
  const half = HR_PEAK_WINDOW_S / 2;
  const elevated: { p: Point; med: number }[][] = [];
  let lo = 0;
  let hi = 0;
  let current: { p: Point; med: number }[] | null = null;
  for (const p of points) {
    while (points[lo]!.s < p.s - half) lo++;
    while (hi < points.length && points[hi]!.s <= p.s + half) hi++;
    const med = median(points.slice(lo, hi).map((q) => q.hr));
    if (p.hr - med > HR_PEAK_EXCESS_BPM) {
      if (!current) elevated.push((current = []));
      current.push({ p, med });
    } else {
      current = null;
    }
  }
  const spikes: Spike[] = [];
  for (const group of elevated) {
    const first = group[0]!.p;
    const last = group[group.length - 1]!.p;
    if (last.s - first.s >= HR_PEAK_MAX_DURATION_S) continue;
    const top = group.reduce((a, b) => (b.p.hr > a.p.hr ? b : a));
    const seconds = last.s - first.s;
    spikes.push({
      peak: top.p,
      from: first.s,
      to: last.s,
      message:
        `HR ${top.p.hr} bpm at ${clock(top.p.t)} is likely a sensor artefact: it is ` +
        `${round(top.p.hr - top.med, 0)} bpm above the median of the surrounding ` +
        `${HR_PEAK_WINDOW_S} s (${round(top.med, 0)} bpm) and lasted ${seconds} s.`,
    });
  }
  return spikes;
}

export function detectHrSpikesImpl(samples: Sample[]): Flag[] {
  const points: Point[] = samples
    .filter((s): s is Sample & { hr_bpm: number } => s.hr_bpm !== null && s.hr_bpm > 0)
    .map((s) => ({ t: s.t, s: s.elapsed_s, hr: s.hr_bpm }))
    .sort((a, b) => a.s - b.s);
  if (points.length < 3) return [];

  const spikes = fastRises(points);
  // An isolated peak already explained by a fast rise is the same event.
  for (const peak of isolatedPeaks(points)) {
    const overlaps = spikes.some(
      (s) => peak.from <= s.to + HR_PEAK_MAX_DURATION_S && peak.to >= s.from - HR_PEAK_MAX_DURATION_S,
    );
    if (!overlaps) spikes.push(peak);
  }
  return spikes
    .sort((a, b) => a.peak.s - b.peak.s)
    .map((s) => ({ code: "sensor_spike", severity: "warn", message: s.message, field: "max_hr_bpm" }));
}
