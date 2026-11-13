/**
 * The Engine: one facade over the vendor adapters and the meaning layer, so
 * every MCP tool answers the same way.
 *
 * - Stateless: it fetches the windows a question needs, computes in flight and
 *   keeps nothing. One Engine per request is cheap.
 * - Deterministic: the clock is injected; meaning rules never read time.
 * - Order matters: split sessions are merged before anything else reads them,
 *   so counts, hard-session rules and recovery all see the same sessions.
 * - Every method returns an Envelope: the answer, every flag that limits
 *   trust in it, and the steps that built it, so an assistant can show its work.
 */

import type { Adapter } from "../adapter.ts";
import type {
  DateRange,
  Daily,
  LocalDate,
  LocalDateTime,
  Night,
  Sample,
  Session,
  SessionDetail,
  SessionType,
  Step,
} from "../model.ts";
import {
  detectHrSpikes,
  isHardSession,
  lastNight,
  mergeSplitSessions,
  readiness as readinessRule,
  recoveryStatus,
  referenceInstant,
  trend as trendRule,
  type Readiness,
  type RecoveryStatus,
  type Trend,
} from "../meaning/index.ts";
import {
  addDays,
  dateOf,
  daysInclusive,
  isLocalDate,
  lapRow,
  nightFull,
  nightRef,
  nightRow,
  r0,
  r1,
  r2,
  sampleTable,
  sessionFull,
  sessionRef,
  sessionBrief,
  sessionRow,
  tag,
  zoneRow,
  type SampleTable,
  type TaggedFlag,
} from "./format.ts";

// ----------------------------------------------------------------- windows

/** Nights behind the HRV 60-day mean. */
export const NIGHTS_WINDOW = 60;
/** Days behind the resting-HR 30-day mean (plus the day itself). */
export const DAILIES_WINDOW = 31;
/** Days of sessions recovery and readiness look back over (device recovery tops out near 4 days). */
export const SESSIONS_WINDOW = 8;
/** Nights and sessions shown in the brief. */
export const BRIEF_DAYS = 7;
/** Most session rows in a brief; the rest are counted and left to get_sessions. */
export const BRIEF_MAX_SESSIONS = 14;

export const MAX_NIGHTS_DAYS = 31;
export const MAX_SESSIONS_DAYS = 92;

// ---------------------------------------------------------------- envelope

export interface Envelope<T> {
  data: T;
  /** Everything that limits trust in `data`; `on` names the record a flag is about. */
  flags: TaggedFlag[];
  /** How the answer was built, in plain sentences. */
  how_built: Step[];
  /** The moment the answer is computed for, local time with offset. */
  as_of: LocalDateTime;
}

/** A problem the caller can fix (bad date, range too long, unknown id). Safe to show. */
export class EngineInputError extends Error {
  override name = "EngineInputError";
}

export interface EngineOptions {
  adapters: Adapter[];
  /** IANA zone of the user, e.g. "Asia/Kolkata". */
  tz: string;
  /** Local "now" with offset. Injected so answers are reproducible. */
  now: () => LocalDateTime;
}

/** Collects flags and steps once each, in the order they arose. */
class Work {
  readonly flags: TaggedFlag[] = [];
  readonly steps: Step[] = [];
  private readonly flagKeys = new Set<string>();
  private readonly stepKeys = new Set<string>();
  private readonly provenanceRules = new Set<string>();

  flag(flags: TaggedFlag[]): void {
    for (const f of flags) {
      // One not_synced per record however many rules noticed it.
      // Several rules report the same missing night in the same words; say it once.
      const key = f.code === "not_synced" ? `not_synced|${f.message}` : `${f.code}|${f.field}|${f.on}|${f.message}`;
      if (this.flagKeys.has(key)) continue;
      this.flagKeys.add(key);
      this.flags.push(f);
    }
  }

  /** Rule steps: kept whenever the sentence differs. */
  step(steps: Step[]): void {
    for (const s of steps) {
      const key = `${s.rule}|${s.detail}`;
      if (this.stepKeys.has(key)) continue;
      this.stepKeys.add(key);
      this.steps.push(s);
    }
  }

  /** Record provenance repeats per record (60 nights, one "wake_day_dating" each): one per rule. */
  provenance(steps: Step[]): void {
    for (const s of steps) {
      if (this.provenanceRules.has(s.rule)) continue;
      this.provenanceRules.add(s.rule);
      this.step([s]);
    }
  }

  envelope<T>(data: T, asOf: LocalDateTime): Envelope<T> {
    return { data, flags: this.flags, how_built: this.steps, as_of: asOf };
  }
}

interface Moment {
  date: LocalDate;
  now: LocalDateTime;
}

export class Engine {
  readonly tz: string;
  private readonly adapters: Adapter[];
  private readonly clock: () => LocalDateTime;

  constructor(opts: EngineOptions) {
    if (opts.adapters.length === 0) throw new Error("Engine needs at least one adapter");
    this.adapters = opts.adapters;
    this.tz = opts.tz;
    this.clock = opts.now;
  }

  // ------------------------------------------------------------- tools

  /** The day-one bundle: last night, 7-night trend, the week's sessions, readiness, recovery. */
  async brief(date?: LocalDate) {
    const work = new Work();
    const m = this.moment(date, work);
    const w = await this.readinessWindows(m, work);

    const ln = lastNight(w.nights, m.date);
    work.flag(tag(ln.flags, `night ${m.date}`));
    const tr = trendRule(w.nights, w.dailies, m.date);
    const rec = recoveryStatus(w.sessions, m.now);
    const rd = readinessRule({ as_of: m.date, now: m.now, nights: w.nights, dailies: w.dailies, sessions: w.sessions });

    const weekStart = addDays(m.date, -(BRIEF_DAYS - 1));
    const weekNights = w.nights.filter((n) => n.wake_date >= weekStart && n.wake_date <= m.date);
    const weekSessions = w.sessions.filter((s) => dateOf(s.start) >= weekStart && dateOf(s.start) <= m.date);
    const shown = weekSessions.slice(-BRIEF_MAX_SESSIONS);

    for (const n of weekNights) this.absorb(work, n.flags, nightRef(n), n.provenance.steps);
    for (const s of shown) this.absorb(work, s.flags, sessionRef(s), s.provenance.steps);
    work.flag(rd.flags);
    work.step(tr.steps);
    work.step(rec.steps);
    work.step(rd.how_built);

    const hard = weekSessions.filter((s) => isHardSession(s)).length;
    const data = {
      date: m.date,
      tz: this.tz,
      last_night: ln.night ? nightFull(ln.night) : null,
      last_night_status: ln.night ? "synced" : "not_synced",
      trend_7n: {
        ...trendSummary(tr),
        nights: weekNights.map(nightRow),
      },
      sessions_7d: {
        from: weekStart,
        count: weekSessions.length,
        hard_count: hard,
        omitted: weekSessions.length > shown.length ? weekSessions.length - shown.length : null,
        items: shown.map((s) => sessionBrief(s, isHardSession(s))),
      },
      readiness: readinessSummary(rd),
      recovery: recoverySummary(rec),
    };
    return work.envelope(data, m.now);
  }

  async readiness(date?: LocalDate) {
    const work = new Work();
    const m = this.moment(date, work);
    const w = await this.readinessWindows(m, work);
    const ln = lastNight(w.nights, m.date);
    work.flag(tag(ln.flags, `night ${m.date}`));
    const rec = recoveryStatus(w.sessions, m.now);
    const rd = readinessRule({ as_of: m.date, now: m.now, nights: w.nights, dailies: w.dailies, sessions: w.sessions });
    work.flag(rd.flags);
    work.step(rec.steps);
    work.step(rd.how_built);
    return work.envelope({ date: m.date, ...readinessSummary(rd), recovery: recoverySummary(rec) }, m.now);
  }

  async nights(start: LocalDate, end: LocalDate) {
    const work = new Work();
    const range = this.range(start, end, MAX_NIGHTS_DAYS, "nights");
    const nights = await this.fetchNights(range, work);
    for (const n of nights) this.absorb(work, n.flags, nightRef(n), n.provenance.steps);
    const have = new Set(nights.map((n) => n.wake_date));
    const missing: LocalDate[] = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) if (!have.has(d)) missing.push(d);
    const data = {
      start: range.start,
      end: range.end,
      count: nights.length,
      missing_nights: missing,
      nights: nights.map(nightFull),
    };
    return work.envelope(data, this.clock());
  }

  async sessions(start: LocalDate, end: LocalDate, type?: SessionType) {
    const work = new Work();
    const range = this.range(start, end, MAX_SESSIONS_DAYS, "sessions");
    // One extra day so a session saved in parts across midnight is still joined.
    const merged = await this.fetchSessions({ start: range.start, end: addDays(range.end, 1) }, work);
    const inRange = merged.filter((s) => dateOf(s.start) >= range.start && dateOf(s.start) <= range.end);
    const picked = type ? inRange.filter((s) => s.type === type) : inRange;
    if (type) work.step([{ rule: "filter_type", detail: `Kept only ${type} sessions.` }]);
    for (const s of picked) this.absorb(work, s.flags, sessionRef(s), s.provenance.steps);

    const hardOf = new Map(picked.map((s) => [s.id, isHardSession(s)]));
    const data = {
      start: range.start,
      end: range.end,
      type: type ?? null,
      // Totals computed here so the assistant never has to add up rows itself.
      totals: totalsByType(picked, hardOf),
      sessions: picked.map((s) => sessionRow(s, hardOf.get(s.id) ?? false)),
    };
    return work.envelope(data, this.clock());
  }

  async sessionDetail(sessionId: string, includeSamples = false) {
    const work = new Work();
    const first = await this.fetchDetail(sessionId);
    if (!first) throw new EngineInputError(`No session with id ${sessionId}. Use get_sessions to find ids.`);

    // Find the merged session this record belongs to, then fetch every part.
    const day = dateOf(first.session.start);
    const merged = await this.fetchSessions({ start: addDays(day, -1), end: addDays(day, 1) }, work);
    const session = merged.find((s) => s.parts.includes(sessionId) || s.id === sessionId) ?? first.session;
    const parts: SessionDetail[] = [first];
    for (const pid of session.parts) {
      if (pid === first.session.id) continue;
      const d = await this.fetchDetail(pid);
      if (d) parts.push(d);
      else work.flag([{ code: "partial", severity: "warn", message: `Detail for part ${pid} is missing; laps and zones cover only the other parts.`, on: sessionRef(session) }]);
    }
    parts.sort((a, b) => Date.parse(a.session.start) - Date.parse(b.session.start));

    this.absorb(work, session.flags, sessionRef(session), session.provenance.steps);
    for (const p of parts) this.absorb(work, p.flags, sessionRef(session), p.provenance.steps);

    // Spikes per part: the jump across a gap between parts is not a spike.
    for (const p of parts) work.flag(tag(detectHrSpikes(p.samples), sessionRef(session)));
    work.step([{ rule: "hr_spike_check", detail: "Checked the heart-rate samples for physiologically implausible jumps." }]);

    const laps = parts.flatMap((p) => p.laps).map((l, i) => lapRow({ ...l, index: i + 1 }));
    const zones = sumZones(parts);
    const samples = joinSamples(parts, session.start);
    let sampleData: SampleTable | null = null;
    if (includeSamples && samples.length > 0) {
      sampleData = sampleTable(samples);
      if (sampleData.every > 1) {
        work.step([{ rule: "downsample", detail: `Kept every ${sampleData.every}th of ${sampleData.of} samples (${sampleData.points} points).` }]);
      }
    }
    const data = {
      session: sessionFull(session, isHardSession(session)),
      laps,
      zones,
      samples_available: samples.length,
      samples: sampleData,
    };
    return work.envelope(data, this.clock());
  }

  // ----------------------------------------------------------- internals

  private moment(date: LocalDate | undefined, work: Work): Moment {
    const now = this.clock();
    const today = dateOf(now);
    if (date === undefined || date === today) return { date: today, now };
    if (!isLocalDate(date)) throw new EngineInputError(`Date ${date} is not a YYYY-MM-DD calendar date.`);
    if (date > today) throw new EngineInputError(`Date ${date} is in the future; today is ${today}.`);
    work.step([{ rule: "historical_as_of", detail: `Asked about ${date}, so recovery is judged as of the end of that day.` }]);
    return { date, now: referenceInstant(date, now) };
  }

  private range(start: LocalDate, end: LocalDate, maxDays: number, what: string): DateRange {
    for (const d of [start, end]) {
      if (!isLocalDate(d)) throw new EngineInputError(`Date ${d} is not a YYYY-MM-DD calendar date.`);
    }
    if (start > end) throw new EngineInputError(`start ${start} is after end ${end}.`);
    const n = daysInclusive(start, end);
    if (n > maxDays) {
      throw new EngineInputError(`Asked for ${n} days of ${what}; the limit is ${maxDays} per call. Split the range into smaller calls.`);
    }
    return { start, end };
  }

  /** The windows readiness needs (SPEC §8): 60 nights, 31 days of dailies, 8 days of merged sessions. */
  private async readinessWindows(m: Moment, work: Work) {
    const [nights, dailies, sessions] = await Promise.all([
      this.fetchNights({ start: addDays(m.date, -(NIGHTS_WINDOW - 1)), end: m.date }, work),
      this.fetchDailies({ start: addDays(m.date, -(DAILIES_WINDOW - 1)), end: m.date }, work),
      this.fetchSessions({ start: addDays(m.date, -(SESSIONS_WINDOW - 1)), end: m.date }, work),
    ]);
    return { nights, dailies, sessions };
  }

  private async fetchNights(range: DateRange, work: Work): Promise<Night[]> {
    const lists = await Promise.all(this.adapters.map((a) => a.nights(range)));
    const nights = firstWins(lists, (n) => n.wake_date).sort((a, b) => a.wake_date.localeCompare(b.wake_date));
    work.step([{ rule: "fetch_nights", detail: `Read ${nights.length} of ${daysInclusive(range.start, range.end)} nights waking ${range.start} to ${range.end} (${this.vendors()}).` }]);
    return nights;
  }

  private async fetchDailies(range: DateRange, work: Work): Promise<Daily[]> {
    const lists = await Promise.all(this.adapters.map((a) => a.dailies(range)));
    const dailies = firstWins(lists, (d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
    work.step([{ rule: "fetch_dailies", detail: `Read ${dailies.length} daily summaries ${range.start} to ${range.end} (${this.vendors()}).` }]);
    return dailies;
  }

  /** Fetch, sort, and merge split sessions: nothing downstream sees unmerged parts. */
  private async fetchSessions(range: DateRange, work: Work): Promise<Session[]> {
    const lists = await Promise.all(this.adapters.map((a) => a.sessions(range)));
    const raw = lists.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const merged = mergeSplitSessions(raw);
    const joined = raw.length - merged.length;
    work.step([{
      rule: "fetch_sessions",
      detail: `Read ${raw.length} activity records started ${range.start} to ${range.end} (${this.vendors()})${joined > 0 ? `; joined parts saved separately, leaving ${merged.length} sessions` : ""}.`,
    }]);
    return merged;
  }

  private async fetchDetail(vendorId: string): Promise<SessionDetail | null> {
    for (const a of this.adapters) {
      const d = await a.sessionDetail(vendorId);
      if (d) return d;
    }
    return null;
  }

  private absorb(work: Work, flags: TaggedFlag[], on: string, steps: Step[]): void {
    work.flag(tag(flags, on));
    work.provenance(steps);
  }

  private vendors(): string {
    return [...new Set(this.adapters.map((a) => a.vendor))].join(", ");
  }
}

// ----------------------------------------------------------------- helpers

/** Same record from two adapters: the first adapter listed wins. */
function firstWins<T>(lists: T[][], key: (x: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const list of lists) for (const x of list) if (!seen.has(key(x))) seen.set(key(x), x);
  return [...seen.values()];
}

function trendSummary(t: Trend) {
  return {
    hrv_last_ms: r0(t.hrv_last_ms),
    hrv_7d_mean_ms: r0(t.hrv_7d_mean_ms),
    hrv_60d_mean_ms: r0(t.hrv_60d_mean_ms),
    hrv_baseline_ms:
      t.hrv_baseline_low_ms != null && t.hrv_baseline_high_ms != null
        ? `${r0(t.hrv_baseline_low_ms)}-${r0(t.hrv_baseline_high_ms)}`
        : null,
    resting_hr_last_bpm: r0(t.resting_hr_last_bpm),
    resting_hr_30d_mean_bpm: r1(t.resting_hr_30d_mean_bpm),
    missing_nights: t.missing_nights.length > 0 ? t.missing_nights : null,
  };
}

function readinessSummary(r: Readiness) {
  return {
    colour: r.colour,
    based_on: r.based_on,
    checks: r.checks.map((c) => ({ name: c.name, result: c.result, value: c.value, rule: c.rule })),
    failed: r.failed,
    missing: r.missing,
  };
}

function recoverySummary(r: RecoveryStatus) {
  const s = r.last_hard;
  return {
    last_hard: s ? { id: s.id, type: s.type, end: s.end } : null,
    hours_since: r1(r.hours_since),
    remaining_h: r1(r.remaining_h),
    basis: r.basis,
  };
}

function totalsByType(sessions: Session[], hardOf: Map<string, boolean>) {
  const by: Record<string, { count: number; duration_min: number; distance_km: number | null }> = {};
  for (const s of sessions) {
    const t = (by[s.type] ??= { count: 0, duration_min: 0, distance_km: null });
    t.count += 1;
    t.duration_min += s.duration_min;
    if (s.distance_km != null) t.distance_km = (t.distance_km ?? 0) + s.distance_km;
  }
  return {
    count: sessions.length,
    hard_count: sessions.filter((s) => hardOf.get(s.id)).length,
    by_type: Object.fromEntries(
      Object.entries(by).map(([k, v]) => [k, { count: v.count, duration_min: r0(v.duration_min), distance_km: r2(v.distance_km) }]),
    ),
  };
}

function sumZones(parts: SessionDetail[]) {
  const by = new Map<number, { zone: number; low_bpm: number; minutes: number }>();
  for (const p of parts) {
    for (const z of p.zones) {
      const cur = by.get(z.zone);
      if (cur) cur.minutes += z.minutes;
      else by.set(z.zone, { ...z });
    }
  }
  return [...by.values()].sort((a, b) => a.zone - b.zone).map(zoneRow);
}

/** All parts' samples on one clock: elapsed seconds from the session's first start. */
function joinSamples(parts: SessionDetail[], start: LocalDateTime): Sample[] {
  if (parts.length === 1) return parts[0]?.samples ?? [];
  const t0 = Date.parse(start);
  return parts
    .flatMap((p) => p.samples)
    .map((s) => ({ ...s, elapsed_s: r0((Date.parse(s.t) - t0) / 1000) ?? s.elapsed_s }))
    .sort((a, b) => a.elapsed_s - b.elapsed_s);
}
