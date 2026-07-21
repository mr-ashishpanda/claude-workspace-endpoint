import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { AuditRecord } from "../config/types.js";
import { auditDir, auditPartitionPath } from "../config/paths.js";
import { parseRecordLine, serializeRecord } from "./record.js";

/** Append-only, day-partitioned JSONL store for audit records. */
export class AuditStore {
  constructor(
    private readonly home: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  append(record: AuditRecord): void {
    const path = auditPartitionPath(this.home, this.now());
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, serializeRecord(record) + "\n");
  }

  /** Read records across hot (.jsonl) and warm (.jsonl.gz) partitions, filtered by ts. */
  read(filter: { since?: Date; until?: Date } = {}): AuditRecord[] {
    const out: AuditRecord[] = [];
    for (const file of this.partitionFiles()) {
      const buf = readFileSync(file);
      const text = file.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
      for (const line of text.split("\n")) {
        const r = parseRecordLine(line);
        if (!r) continue;
        const ts = Date.parse(r.ts);
        if (filter.since && ts < filter.since.getTime()) continue;
        if (filter.until && ts > filter.until.getTime()) continue;
        out.push(r);
      }
    }
    return out.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  /** All partition files (.jsonl / .jsonl.gz) under audit/, recursively. */
  private partitionFiles(): string[] {
    const root = auditDir(this.home);
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.gz"))
          files.push(full);
      }
    };
    walk(root);
    return files.sort();
  }
}
