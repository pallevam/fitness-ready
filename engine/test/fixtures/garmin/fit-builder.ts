/**
 * A tiny FIT writer for synthetic test files. The SDK's Encoder only writes
 * profile messages, and the adapter's key input (message 140) is not in the
 * profile, so tests build files byte by byte: header, one definition + data
 * message per record, CRC. Values are raw (pre-scale) field values.
 */

export const BASE = { enum: 0x00, uint8: 0x02, uint16: 0x84, sint32: 0x85, uint32: 0x86 } as const;
const SIZE: Record<number, number> = { 0x00: 1, 0x02: 1, 0x84: 2, 0x85: 4, 0x86: 4 };

export interface FieldValue {
  num: number;
  type: number;
  /** One value, or an array for array fields. */
  value: number | number[];
}

export interface FitMessage {
  global: number;
  fields: FieldValue[];
}

const FIT_EPOCH_S = 631_065_600;

/** Unix ms -> FIT timestamp (seconds since 1989-12-31). */
export function fitTime(utcMs: number): number {
  return Math.round(utcMs / 1000) - FIT_EPOCH_S;
}

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function crc(bytes: number[]): number {
  let c = 0;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[c & 0xf]!;
    c = (c >> 4) & 0x0fff;
    c = c ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[c & 0xf]!;
    c = (c >> 4) & 0x0fff;
    c = c ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return c;
}

function push(out: number[], value: number, size: number): void {
  for (let i = 0; i < size; i++) out.push((value >>> (8 * i)) & 0xff);
}

export function buildFit(messages: FitMessage[]): Uint8Array {
  const data: number[] = [];
  for (const m of messages) {
    // Definition message, local type 0, little endian.
    data.push(0x40, 0, 0);
    push(data, m.global, 2);
    data.push(m.fields.length);
    for (const f of m.fields) {
      const count = Array.isArray(f.value) ? f.value.length : 1;
      data.push(f.num, SIZE[f.type]! * count, f.type);
    }
    data.push(0x00);
    for (const f of m.fields) {
      for (const v of Array.isArray(f.value) ? f.value : [f.value]) push(data, v, SIZE[f.type]!);
    }
  }
  const header: number[] = [12, 0x20];
  push(header, 2100, 2);
  push(header, data.length, 4);
  header.push(...[...".FIT"].map((c) => c.charCodeAt(0)));
  const body = [...header, ...data];
  push(body, crc(body), 2);
  return new Uint8Array(body);
}

export interface SyntheticFitOptions {
  startUtcMs: number;
  offsetMin: number;
  sport: number; // 1 running, 10 training
  subSport: number; // 0 generic, 20 strength_training
  records: Array<{ s: number; hr: number; distM?: number; speed?: number; altM?: number; cadence?: number }>;
  msg140?: { aerobic10?: number; anaerobic10?: number; recoveryMin?: number; vo2Raw?: number };
  zonesS?: number[]; // 7 values: below z1, z1..z5, above
  zoneBounds?: number[]; // 6 values
  laps?: Array<{ startS: number; timerS: number; distM: number; hr: number; maxHr: number; cadence: number }>;
}

/** A small, invented activity file: file_id, records, laps, session, time-in-zone, activity, msg 140. */
export function syntheticFit(o: SyntheticFitOptions): Uint8Array {
  const t = (s: number) => fitTime(o.startUtcMs + s * 1000);
  const last = o.records.at(-1)?.s ?? 0;
  const msgs: FitMessage[] = [{ global: 0, fields: [{ num: 0, type: BASE.enum, value: 4 }] }];
  for (const r of o.records) {
    const fields: FieldValue[] = [
      { num: 253, type: BASE.uint32, value: t(r.s) },
      { num: 3, type: BASE.uint8, value: r.hr },
      // A position, to prove the adapter never surfaces one.
      { num: 0, type: BASE.sint32, value: 123456789 },
      { num: 1, type: BASE.sint32, value: 987654321 },
    ];
    if (r.distM !== undefined) fields.push({ num: 5, type: BASE.uint32, value: Math.round(r.distM * 100) });
    if (r.speed !== undefined) fields.push({ num: 73, type: BASE.uint32, value: Math.round(r.speed * 1000) });
    if (r.altM !== undefined) fields.push({ num: 78, type: BASE.uint32, value: Math.round((r.altM + 500) * 5) });
    if (r.cadence !== undefined) fields.push({ num: 4, type: BASE.uint8, value: r.cadence });
    msgs.push({ global: 20, fields });
  }
  for (const l of o.laps ?? []) {
    msgs.push({ global: 19, fields: [
      { num: 253, type: BASE.uint32, value: t(l.startS + l.timerS) },
      { num: 2, type: BASE.uint32, value: t(l.startS) },
      { num: 7, type: BASE.uint32, value: l.timerS * 1000 },
      { num: 8, type: BASE.uint32, value: l.timerS * 1000 },
      { num: 9, type: BASE.uint32, value: l.distM * 100 },
      { num: 15, type: BASE.uint8, value: l.hr },
      { num: 16, type: BASE.uint8, value: l.maxHr },
      { num: 17, type: BASE.uint8, value: l.cadence },
    ] });
  }
  const totalDist = o.records.at(-1)?.distM;
  msgs.push({ global: 18, fields: [
    { num: 253, type: BASE.uint32, value: t(last) },
    { num: 2, type: BASE.uint32, value: t(0) },
    { num: 5, type: BASE.enum, value: o.sport },
    { num: 6, type: BASE.enum, value: o.subSport },
    { num: 7, type: BASE.uint32, value: last * 1000 },
    { num: 8, type: BASE.uint32, value: last * 1000 },
    ...(totalDist !== undefined ? [{ num: 9, type: BASE.uint32, value: Math.round(totalDist * 100) }] : []),
    { num: 16, type: BASE.uint8, value: Math.round(o.records.reduce((s, r) => s + r.hr, 0) / Math.max(1, o.records.length)) },
    { num: 17, type: BASE.uint8, value: Math.max(...o.records.map((r) => r.hr)) },
    { num: 11, type: BASE.uint16, value: 111 },
  ] });
  if (o.zonesS && o.zoneBounds) {
    msgs.push({ global: 216, fields: [
      { num: 253, type: BASE.uint32, value: t(last) },
      { num: 0, type: BASE.uint16, value: 18 },
      { num: 1, type: BASE.uint16, value: 0 },
      { num: 2, type: BASE.uint32, value: o.zonesS.map((s) => s * 1000) },
      { num: 6, type: BASE.uint8, value: o.zoneBounds },
    ] });
  }
  msgs.push({ global: 34, fields: [
    { num: 253, type: BASE.uint32, value: t(last) },
    { num: 5, type: BASE.uint32, value: t(last) + o.offsetMin * 60 },
    { num: 1, type: BASE.uint16, value: 1 },
  ] });
  if (o.msg140) {
    const fields: FieldValue[] = [{ num: 253, type: BASE.uint32, value: t(last) }];
    if (o.msg140.aerobic10 !== undefined) fields.push({ num: 4, type: BASE.uint8, value: o.msg140.aerobic10 });
    if (o.msg140.anaerobic10 !== undefined) fields.push({ num: 20, type: BASE.uint8, value: o.msg140.anaerobic10 });
    if (o.msg140.recoveryMin !== undefined) fields.push({ num: 9, type: BASE.uint16, value: o.msg140.recoveryMin });
    if (o.msg140.vo2Raw !== undefined) fields.push({ num: 7, type: BASE.uint32, value: o.msg140.vo2Raw });
    msgs.push({ global: 140, fields });
  }
  return buildFit(msgs);
}
