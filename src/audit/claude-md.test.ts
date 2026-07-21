import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_CLAUDE_MD, writeAuditClaudeMd } from "./claude-md.js";
import { auditDir } from "../config/paths.js";

describe("AUDIT_CLAUDE_MD", () => {
  it("documents the partition layout, schema, drill-down, and read-only rule", () => {
    expect(AUDIT_CLAUDE_MD).toMatch(/YYYY-MM-DD\.jsonl/);
    expect(AUDIT_CLAUDE_MD).toMatch(/sessionRef/);
    expect(AUDIT_CLAUDE_MD).toMatch(/rollup/i);
    expect(AUDIT_CLAUDE_MD).toMatch(/read-only|never modify/i);
  });
});

describe("writeAuditClaudeMd", () => {
  it("writes CLAUDE.md into the audit dir", () => {
    const home = mkdtempSync(join(tmpdir(), "audit-md-"));
    writeAuditClaudeMd(home);
    const file = join(auditDir(home), "CLAUDE.md");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(AUDIT_CLAUDE_MD);
  });
});
