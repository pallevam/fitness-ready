/**
 * The vendor seam. An adapter turns one vendor's data into the canonical model
 * (model.ts), and owns everything vendor-specific: field names, units, scales,
 * timezones and the vendor's quirks. Rules in meaning/ never see vendor data.
 *
 * Adapters do not store anything. They read from a `RawSource` (the official
 * API, or recorded snapshots in development) and return records.
 */

import type { DateRange, Daily, Night, Session, SessionDetail, Vendor } from "./model.ts";

export interface Adapter {
  readonly vendor: Vendor;
  /** Nights whose wake_date falls in the range. */
  nights(range: DateRange): Promise<Night[]>;
  /** Activities that started in the range, one per vendor record (unmerged). */
  sessions(range: DateRange): Promise<Session[]>;
  dailies(range: DateRange): Promise<Daily[]>;
  /** Laps, zones, samples and device-file values for one vendor record. */
  sessionDetail(vendorId: string): Promise<SessionDetail | null>;
}

/**
 * Where an adapter's raw responses come from. One implementation per transport:
 * recorded snapshots on disk for development and tests, the vendor's official
 * API in production. Keys are vendor-specific (e.g. "sleep/2026-11-05").
 */
export interface RawSource {
  json(key: string): Promise<unknown | null>;
  bytes(key: string): Promise<Uint8Array | null>;
}
