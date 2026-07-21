import { AuditRecord } from "../config/types.js";

export function serializeRecord(record: AuditRecord): string {
  return JSON.stringify(record);
}

/** Parse one JSONL line; return null (skip) if malformed or not an object. */
export function parseRecordLine(line: string): AuditRecord | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) return null;
    return parsed as AuditRecord;
  } catch {
    return null;
  }
}
