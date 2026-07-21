# Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only, time-partitioned audit trail of Claude invocations keyed by Slack user — metadata + token usage always, an optional Claude-generated summary — queryable via a read-only CLI, with a self-describing `audit/CLAUDE.md`.

**Architecture:** A new `src/audit/` module owns the record type, partitioned append-only store, summarizer, and recorder. The handler fires a fire-and-forget `AuditRecorder.record()` at each invocation's terminal point, after the reply is posted. Global config (`audit.enabled`/`audit.summary`) lives in a new `AuditConfigStore`; per-mapping overrides live on `Mapping.audit`. The summarizer runs through the user's existing `claude` CLI (no SDK, no API key) in an isolated temp cwd.

**Tech Stack:** Node ≥20, TypeScript (strict, ESM/NodeNext), vitest, eslint, prettier. `@slack/web-api` (already a dep) for name resolution. Node built-ins (`node:zlib` for gzip) — no new runtime deps.

## Global Constraints

- **Design spec:** `docs/dev/specs/2026-07-21-audit-trail-design.md` — authoritative; this plan implements it.
- **ESM/NodeNext:** all intra-repo imports use `.js` extensions.
- **TypeScript strict; no unjustified `any`.** Small, single-purpose modules mirroring `src/` layout.
- **Local-first:** storage is files under `SLACK_CLAUDE_HOME`; no hosted relay/coordinator; the summarizer uses the user's `claude` CLI. No new Slack command.
- **Secret safety:** no new secret required; nothing secret logged; summarizer instructed to omit credentials/PII.
- **Naming:** "the bridge" in code/logs/docs; `audit/CLAUDE.md` is written only into the bridge's own `audit/` dir, never into a mapped workspace.
- **Outcome values:** `AuditRecord.outcome` is `"success" | "error"` (the design's "failure" is folded into "error").
- **Every commit message ends with the trailer** (shown once, applies to all commit steps):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- **Verify gate:** `npm run verify` (typecheck + lint + test) must pass before each commit. Baseline at plan start: 215 tests passing.
- **Work on branch `feature/audit-trail`** in the worktree at `.worktrees/audit-trail`.

## File structure

**Create:**

- `src/audit/record.ts` — `AuditRecord`, `TokenUsage` types + `serializeRecord`/`parseRecordLine`.
- `src/audit/partition.ts` — partition path helpers + `AuditStore` (append + range read across `.jsonl`/`.jsonl.gz`).
- `src/audit/channel-lookup.ts` — `ChannelResolver` (mirror of `user-lookup.ts`). _(placed in `audit/`? No — Slack concern; see Task 5: it goes in `src/slack/channel-lookup.ts`.)_
- `src/audit/summarize.ts` — `buildSummaryArgs` + `summarizeActivity`.
- `src/audit/recorder.ts` — `ActivityInput`, `AuditRecorder`, `deriveSessionRef`.
- `src/audit/claude-md.ts` — `AUDIT_CLAUDE_MD` content + `writeAuditClaudeMd`.
- `src/audit/maintenance.ts` — `compact`, `rollup`, `prune`.
- `src/slack/channel-lookup.ts` — `ChannelResolver`, `createChannelResolver`.
- `src/config/audit-config.ts` — `AuditConfigStore`.
- `src/cli/audit.ts` — `runAudit` (query) + `runAuditMaintenance`.
- Tests colocated: `*.test.ts` next to each new module.

**Modify:**

- `src/config/types.ts` — add `AuditConfig`, `DEFAULT_AUDIT_CONFIG`, `MappingAuditOverride`, `Mapping.audit?`.
- `src/config/paths.ts` — `auditDir`, `auditConfigPath`, `auditPartitionPath`.
- `src/config/mappings.ts` — `validateMapping` handles `audit` override.
- `src/claude/invoke.ts` — `ClaudeResult.usage`; `parseClaudeOutput` extracts usage.
- `src/slack/handler.ts` — `HandlerDeps.audit?`; capture hook + timing.
- `src/bridge.ts` — construct `ChannelResolver` + `AuditRecorder`; pass into deps.
- `src/cli/index.ts` — init audit prompts; map add/edit/list audit override; `audit` dispatch + usage.
- `docs/slack-app-manifest.yml` — add `channels:read`, `groups:read`.

---

### Task 1: Audit path helpers

**Files:**

- Modify: `src/config/paths.ts`
- Test: `src/config/paths.test.ts`

**Interfaces:**

- Produces: `auditDir(home): string` → `<home>/audit`; `auditConfigPath(home): string` → `<home>/audit-config.json`; `auditPartitionPath(home, date: Date): string` → `<home>/audit/YYYY/MM/YYYY-MM-DD.jsonl` (UTC).

- [ ] **Step 1: Write the failing test** (append to `paths.test.ts`)

```ts
import { auditDir, auditConfigPath, auditPartitionPath } from "./paths.js";

describe("audit paths", () => {
  it("derives audit dir and config path under home", () => {
    expect(auditDir("/home")).toBe(resolve("/home", "audit"));
    expect(auditConfigPath("/home")).toBe(resolve("/home", "audit-config.json"));
  });
  it("partitions by UTC year/month/day", () => {
    const d = new Date("2026-07-21T23:30:00.000Z");
    expect(auditPartitionPath("/home", d)).toBe(
      resolve("/home", "audit", "2026", "07", "2026-07-21.jsonl"),
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/config/paths.test.ts`) with "auditDir is not a function".

- [ ] **Step 3: Implement** (append to `paths.ts`)

```ts
/** Root directory for the audit trail (partitions + CLAUDE.md). */
export function auditDir(home: string): string {
  return resolve(home, "audit");
}

/** Global audit settings file (sibling of the audit/ data dir). */
export function auditConfigPath(home: string): string {
  return resolve(home, "audit-config.json");
}

/** Daily audit partition path, `audit/YYYY/MM/YYYY-MM-DD.jsonl` (UTC). */
export function auditPartitionPath(home: string, date: Date): string {
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return resolve(auditDir(home), y, m, `${y}-${m}-${d}.jsonl`);
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(audit): add audit storage path helpers`.

---

### Task 2: Audit config types + store

**Files:**

- Modify: `src/config/types.ts`
- Create: `src/config/audit-config.ts`, `src/config/audit-config.test.ts`

**Interfaces:**

- Produces: `AuditConfig { enabled: boolean; summary: boolean; retention: { compactAfterDays: number; pruneAfterDays: number } }`; `DEFAULT_AUDIT_CONFIG`; `AuditConfigStore.load(home)`, `.get(): AuditConfig`, `.set(patch: Partial<AuditConfig>): AuditConfig`.

- [ ] **Step 1: Add types** to `src/config/types.ts`

```ts
/** Global audit-trail settings (per-mapping overrides live on `Mapping.audit`). */
export interface AuditConfig {
  /** Record audit records at all. */
  enabled: boolean;
  /** Generate a Claude summary per record (the only token-costing part). */
  summary: boolean;
  /** Retention thresholds used by the `audit` maintenance commands. */
  retention: { compactAfterDays: number; pruneAfterDays: number };
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  enabled: false,
  summary: false,
  retention: { compactAfterDays: 90, pruneAfterDays: 1095 },
};
```

- [ ] **Step 2: Write the failing test** (`audit-config.test.ts`)

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditConfigStore } from "./audit-config.js";
import { DEFAULT_AUDIT_CONFIG } from "./types.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "audit-cfg-"));
}

it("returns defaults when no file exists", () => {
  expect(AuditConfigStore.load(tmp()).get()).toEqual(DEFAULT_AUDIT_CONFIG);
});

it("persists and reloads a patch, merging retention", () => {
  const home = tmp();
  AuditConfigStore.load(home).set({ enabled: true, summary: true });
  const cfg = AuditConfigStore.load(home).get();
  expect(cfg.enabled).toBe(true);
  expect(cfg.summary).toBe(true);
  expect(cfg.retention).toEqual(DEFAULT_AUDIT_CONFIG.retention);
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** `audit-config.ts`

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AuditConfig, DEFAULT_AUDIT_CONFIG } from "./types.js";
import { auditConfigPath, resolveHome } from "./paths.js";

/** Local-file store for the single global {@link AuditConfig}. */
export class AuditConfigStore {
  private constructor(
    private readonly file: string,
    private config: AuditConfig,
  ) {}

  static load(home: string = resolveHome()): AuditConfigStore {
    const file = auditConfigPath(home);
    if (!existsSync(file)) return new AuditConfigStore(file, { ...DEFAULT_AUDIT_CONFIG });
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AuditConfig>;
      return new AuditConfigStore(file, {
        enabled: raw.enabled ?? DEFAULT_AUDIT_CONFIG.enabled,
        summary: raw.summary ?? DEFAULT_AUDIT_CONFIG.summary,
        retention: { ...DEFAULT_AUDIT_CONFIG.retention, ...(raw.retention ?? {}) },
      });
    } catch {
      // Corrupt config falls back to safe defaults rather than crashing the bridge.
      return new AuditConfigStore(file, { ...DEFAULT_AUDIT_CONFIG });
    }
  }

  get(): AuditConfig {
    return { ...this.config, retention: { ...this.config.retention } };
  }

  set(patch: Partial<AuditConfig>): AuditConfig {
    this.config = {
      ...this.config,
      ...patch,
      retention: { ...this.config.retention, ...(patch.retention ?? {}) },
    };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.config, null, 2) + "\n");
    return this.get();
  }
}
```

- [ ] **Step 5: Run — expect PASS. Commit** — `feat(audit): add global audit config store`.

---

### Task 3: Token usage in Claude invocation

**Files:**

- Modify: `src/claude/invoke.ts`
- Test: `src/claude/invoke.test.ts`

**Interfaces:**

- Produces: `TokenUsage` (import from `../config/types.js` — add there), `ClaudeResult.usage: TokenUsage`. `parseClaudeOutput` populates it from the envelope's `usage.input_tokens`/`output_tokens`; missing ⇒ `{ input: 0, output: 0 }`.

- [ ] **Step 1: Add `TokenUsage` to `src/config/types.ts`**

```ts
/** Input/output token counts for one Claude call. */
export interface TokenUsage {
  input: number;
  output: number;
}
```

- [ ] **Step 2: Write failing tests** (append to `invoke.test.ts`)

```ts
it("extracts token usage from the JSON envelope", () => {
  const out = JSON.stringify({
    result: "hi",
    session_id: "s1",
    usage: { input_tokens: 1200, output_tokens: 88 },
  });
  const r = parseClaudeOutput(out);
  expect(r.usage).toEqual({ input: 1200, output: 88 });
});

it("defaults usage to zeros when absent", () => {
  expect(parseClaudeOutput(JSON.stringify({ result: "x" })).usage).toEqual({ input: 0, output: 0 });
  expect(parseClaudeOutput("not json").usage).toEqual({ input: 0, output: 0 });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** — edit `invoke.ts`:

Import type and extend `ClaudeResult`:

```ts
import { ClaudeModel, TokenUsage } from "../config/types.js";

export interface ClaudeResult {
  text: string;
  sessionId: string | null;
  usage: TokenUsage;
}
```

Replace `parseClaudeOutput` body:

```ts
export function parseClaudeOutput(stdout: string): ClaudeResult {
  const trimmed = stdout.trim();
  const zero: TokenUsage = { input: 0, output: 0 };
  if (!trimmed) return { text: "", sessionId: null, usage: zero };
  try {
    const parsed = JSON.parse(trimmed) as {
      result?: unknown;
      session_id?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const text = typeof parsed.result === "string" ? parsed.result : trimmed;
    const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : null;
    const usage: TokenUsage = {
      input: typeof parsed.usage?.input_tokens === "number" ? parsed.usage.input_tokens : 0,
      output: typeof parsed.usage?.output_tokens === "number" ? parsed.usage.output_tokens : 0,
    };
    return { text, sessionId, usage };
  } catch {
    return { text: trimmed, sessionId: null, usage: zero };
  }
}
```

- [ ] **Step 5: Fix compile fallout** — any test/code constructing a `ClaudeResult` literal (e.g. fake `invoke` in `handler.test.ts`) now needs `usage`. Add `usage: { input: 0, output: 0 }` to those literals.

- [ ] **Step 6: Run `npm run verify` — expect PASS. Commit** — `feat(audit): capture token usage from claude output`.

---

### Task 4: Audit record type + partitioned store

**Files:**

- Modify: `src/config/types.ts`
- Create: `src/audit/record.ts`, `src/audit/partition.ts`, `src/audit/partition.test.ts`

**Interfaces:**

- Consumes: `auditDir`, `auditPartitionPath` (Task 1), `TokenUsage` (Task 3).
- Produces: `AuditRecord` (in `types.ts`); `serializeRecord(r): string`, `parseRecordLine(line): AuditRecord | null` (`record.ts`); `AuditStore { append(record): void; read(filter?: { since?: Date; until?: Date }): AuditRecord[] }` (`partition.ts`).

- [ ] **Step 1: Add `AuditRecord` to `types.ts`**

```ts
/** One audited Claude invocation. */
export interface AuditRecord {
  id: string;
  ts: string;
  slackTs: string;
  durationMs: number;
  user: string | null;
  userName: string | null;
  channel: string;
  channelName: string | null;
  threadTs: string | null;
  identity: string;
  workspace: string;
  sessionId: string | null;
  sessionRef: string | null;
  outcome: "success" | "error";
  error: string | null;
  tokens: TokenUsage;
  summaryTokens: TokenUsage | null;
  summary: string | null;
  summaryError: string | null;
}
```

- [ ] **Step 2: Implement `record.ts`** (no test needed on its own — exercised via partition + recorder)

```ts
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
```

- [ ] **Step 3: Write failing test** (`partition.test.ts`)

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditStore } from "./partition.js";
import { AuditRecord } from "../config/types.js";

function tmp() {
  return mkdtempSync(join(tmpdir(), "audit-part-"));
}
function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "aud_1",
    ts: "2026-07-21T10:00:00.000Z",
    slackTs: "1",
    durationMs: 5,
    user: "U1",
    userName: "Ann",
    channel: "C1",
    channelName: "#c",
    threadTs: null,
    identity: "id1",
    workspace: "/w",
    sessionId: "s1",
    sessionRef: null,
    outcome: "success",
    error: null,
    tokens: { input: 1, output: 2 },
    summaryTokens: null,
    summary: null,
    summaryError: null,
    ...over,
  };
}

it("appends to the day partition and reads it back", () => {
  const home = tmp();
  const store = new AuditStore(home);
  store.append(rec({ id: "a", ts: "2026-07-21T10:00:00.000Z" }));
  store.append(rec({ id: "b", ts: "2026-07-21T11:00:00.000Z" }));
  const all = store.read();
  expect(all.map((r) => r.id)).toEqual(["a", "b"]);
});

it("skips malformed lines", () => {
  const home = tmp();
  const store = new AuditStore(home);
  store.append(rec({ id: "good", ts: "2026-07-21T10:00:00.000Z" }));
  // Corrupt the partition by appending junk directly.
  const { appendFileSync } = await import("node:fs");
  appendFileSync(auditPartitionPath(home, new Date("2026-07-21T10:00:00Z")), "{ broken\n");
  expect(store.read().map((r) => r.id)).toEqual(["good"]);
});

it("filters by since/until across days and reads gzipped partitions", () => {
  const home = tmp();
  const store = new AuditStore(home);
  store.append(rec({ id: "jun", ts: "2026-06-30T10:00:00.000Z" }));
  store.append(rec({ id: "jul", ts: "2026-07-21T10:00:00.000Z" }));
  // gzip the June partition in place, then confirm it's still read.
  const { readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { gzipSync } = await import("node:zlib");
  const junPath = auditPartitionPath(home, new Date("2026-06-30T10:00:00Z"));
  writeFileSync(junPath + ".gz", gzipSync(readFileSync(junPath)));
  rmSync(junPath);
  expect(
    store
      .read()
      .map((r) => r.id)
      .sort(),
  ).toEqual(["jul", "jun"]);
  expect(store.read({ since: new Date("2026-07-01T00:00:00Z") }).map((r) => r.id)).toEqual(["jul"]);
});
```

(Add `import { auditPartitionPath } from "../config/paths.js";` at the top; the dynamic `await import` lines require the test bodies to be `async`.)

- [ ] **Step 4: Run — expect FAIL.**

- [ ] **Step 5: Implement `partition.ts`**

```ts
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
```

- [ ] **Step 6: Run — expect PASS. Commit** — `feat(audit): add partitioned append-only audit store`.

---

### Task 5: Channel name resolver

**Files:**

- Create: `src/slack/channel-lookup.ts`, `src/slack/channel-lookup.test.ts`

**Interfaces:**

- Produces: `ChannelResolver.resolve(channelId): Promise<string>` (returns `#name`, falls back to raw id, does not cache failures); `createChannelResolver(botToken, logger?, client?)`.

- [ ] **Step 1: Write failing test** (mirror `user-lookup.test.ts`)

```ts
import { ChannelResolver } from "./channel-lookup.js";

it("resolves #name and caches success", async () => {
  let calls = 0;
  const r = new ChannelResolver({
    conversations: {
      info: async () => {
        calls++;
        return { channel: { name: "eng" } };
      },
    },
  });
  expect(await r.resolve("C1")).toBe("#eng");
  expect(await r.resolve("C1")).toBe("#eng");
  expect(calls).toBe(1);
});

it("falls back to the raw id on error, without caching", async () => {
  let calls = 0;
  const r = new ChannelResolver({
    conversations: {
      info: async () => {
        calls++;
        throw { data: { error: "channel_not_found" } };
      },
    },
  });
  expect(await r.resolve("C9")).toBe("C9");
  expect(await r.resolve("C9")).toBe("C9");
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `channel-lookup.ts`** (mirror `user-lookup.ts`)

```ts
import { WebClient } from "@slack/web-api";
import { Logger } from "../logger.js";

export interface ChannelLookupClient {
  conversations: {
    info(args: { channel: string }): Promise<{ channel?: { name?: string } }>;
  };
}

/**
 * Resolves a Slack channel id to `#name` for audit records. Same cache/fallback
 * discipline as {@link UserResolver}: successes cached for the process lifetime,
 * failures fall back to the raw id and are not cached (self-heal next call).
 */
export class ChannelResolver {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly client: ChannelLookupClient,
    private readonly logger?: Logger,
  ) {}

  async resolve(channelId: string): Promise<string> {
    const cached = this.cache.get(channelId);
    if (cached) return cached;
    try {
      const res = await this.client.conversations.info({ channel: channelId });
      const name = res.channel?.name?.trim();
      const label = name ? `#${name}` : channelId;
      if (name) this.cache.set(channelId, label);
      return label;
    } catch (err) {
      const slackError =
        typeof err === "object" && err !== null && "data" in err
          ? (err as { data?: { error?: string } }).data?.error
          : undefined;
      const reason = slackError ?? (err instanceof Error ? err.message : String(err));
      this.logger?.warn(`failed to resolve channel name for ${channelId}: ${reason}`);
      return channelId;
    }
  }
}

export function createChannelResolver(
  botToken: string,
  logger?: Logger,
  client: ChannelLookupClient = new WebClient(botToken),
): ChannelResolver {
  return new ChannelResolver(client, logger);
}
```

- [ ] **Step 4: Run — expect PASS. Commit** — `feat(audit): add Slack channel name resolver`.

---

### Task 6: Summarizer (lightweight `claude` call)

**Files:**

- Create: `src/audit/summarize.ts`, `src/audit/summarize.test.ts`

**Interfaces:**

- Consumes: `ProcessRunner`, `parseClaudeOutput` (`../claude/invoke.js`), `TokenUsage`.
- Produces: `buildSummaryArgs(): string[]`; `summarizeActivity(deps): Promise<{ summary: string; tokens: TokenUsage }>` where `deps = { bin, prompt, response, runner, cwd? }`.

> **Verification during this task:** confirm the exact context-stripping flags for the installed `claude` via the `claude-code-guide` agent. The isolated temp `cwd` already prevents project `CLAUDE.md`/settings/MCP discovery; add any further supported strip flags (e.g. settings-source / tool-disable) to `buildSummaryArgs` once confirmed. The task's tests use an injected runner and do not spawn `claude`.

- [ ] **Step 1: Write failing test**

```ts
import { buildSummaryArgs, summarizeActivity } from "./summarize.js";

it("builds a haiku, json, print-mode arg list", () => {
  const args = buildSummaryArgs();
  expect(args).toContain("-p");
  expect(args).toEqual(
    expect.arrayContaining(["--output-format", "json", "--model", "claude-haiku-4-5"]),
  );
});

it("runs the summarizer and returns summary + tokens", async () => {
  let seen: { args: string[]; cwd: string; input: string } | null = null;
  const runner = {
    run: async (_bin: string, args: string[], cwd: string, input: string) => {
      seen = { args, cwd, input };
      return {
        stdout: JSON.stringify({
          result: "Ann asked X; the bridge did Y.",
          usage: { input_tokens: 40, output_tokens: 12 },
        }),
        stderr: "",
        code: 0,
      };
    },
  };
  const out = await summarizeActivity({
    bin: "claude",
    prompt: "why fail?",
    response: "because Z",
    runner,
  });
  expect(out.summary).toBe("Ann asked X; the bridge did Y.");
  expect(out.tokens).toEqual({ input: 40, output: 12 });
  expect(seen!.input).toContain("why fail?");
  expect(seen!.input).toContain("because Z");
  expect(seen!.cwd).not.toContain("audit"); // never runs inside audit/
});

it("throws on non-zero exit", async () => {
  const runner = { run: async () => ({ stdout: "", stderr: "boom", code: 1 }) };
  await expect(
    summarizeActivity({ bin: "claude", prompt: "p", response: "r", runner }),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `summarize.ts`**

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { ProcessRunner, defaultProcessRunner, parseClaudeOutput } from "../claude/invoke.js";
import { TokenUsage } from "../config/types.js";

const SYSTEM = [
  "You write a 1-2 sentence audit summary of a Slack-to-Claude interaction.",
  "Say what the user asked and what was done. Be concise and factual.",
  "Never include credentials, API keys, tokens, or personal data — omit or redact them.",
].join(" ");

/**
 * Args for the lightweight summarizer call. Print mode, JSON output, Haiku.
 * Run in an isolated temp cwd (see {@link summarizeActivity}) so no project
 * CLAUDE.md / settings / MCP are discovered. Additional strip flags confirmed
 * against the installed `claude` during implementation.
 */
export function buildSummaryArgs(): string[] {
  return ["-p", "--output-format", "json", "--model", "claude-haiku-4-5"];
}

export interface SummarizeDeps {
  bin: string;
  prompt: string;
  response: string;
  runner?: ProcessRunner;
  /** Override cwd (tests). Default: a fresh temp dir with no Claude project context. */
  cwd?: string;
}

export async function summarizeActivity(
  deps: SummarizeDeps,
): Promise<{ summary: string; tokens: TokenUsage }> {
  const runner = deps.runner ?? defaultProcessRunner;
  const cwd = deps.cwd ?? mkdtempSync(`${tmpdir()}/audit-sum-`);
  const input = [
    SYSTEM,
    "",
    "USER REQUEST:",
    deps.prompt,
    "",
    "ASSISTANT RESPONSE:",
    deps.response,
    "",
    "Write the 1-2 sentence summary now.",
  ].join("\n");
  const { stdout, stderr, code } = await runner.run(deps.bin, buildSummaryArgs(), cwd, input);
  if (code !== 0) throw new Error(`summarizer claude exited with code ${code}: ${stderr}`);
  const parsed = parseClaudeOutput(stdout);
  return { summary: parsed.text.trim(), tokens: parsed.usage };
}
```

- [ ] **Step 4: Run — expect PASS. Commit** — `feat(audit): add lightweight claude summarizer`.

---

### Task 7: Session-ref derivation

**Files:**

- Create: `src/audit/session-ref.ts`, `src/audit/session-ref.test.ts`

**Interfaces:**

- Produces: `deriveSessionRef(opts: { sessionId: string | null; workspace: string; claudeConfigDir?: string }): string | null` — returns the transcript path if it exists on disk, else `null`.

> **Open-question mitigation (spec §8):** best-effort. Claude stores transcripts under `<configDir|~/.claude>/projects/<cwd-with-slashes-as-dashes>/<sessionId>.jsonl`. If the derived path doesn't exist, return `null` and rely on `sessionId` for drill-down. **Confirm the encoding scheme against a real `claude` session during implementation** and adjust `encodeProjectDir` if needed.

- [ ] **Step 1: Write failing test**

```ts
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSessionRef } from "./session-ref.js";

it("returns null when session id is null", () => {
  expect(deriveSessionRef({ sessionId: null, workspace: "/w" })).toBeNull();
});

it("returns the transcript path when it exists under the config dir", () => {
  const cfg = mkdtempSync(join(tmpdir(), "cfg-"));
  const proj = join(cfg, "projects", "-Users-x-repo");
  mkdirSync(proj, { recursive: true });
  const file = join(proj, "sess-1.jsonl");
  writeFileSync(file, "{}");
  expect(
    deriveSessionRef({ sessionId: "sess-1", workspace: "/Users/x/repo", claudeConfigDir: cfg }),
  ).toBe(file);
});

it("returns null when the transcript file is absent", () => {
  const cfg = mkdtempSync(join(tmpdir(), "cfg-"));
  expect(
    deriveSessionRef({ sessionId: "nope", workspace: "/Users/x/repo", claudeConfigDir: cfg }),
  ).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `session-ref.ts`**

```ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Encode an absolute workspace path the way Claude Code names its project dir. */
function encodeProjectDir(workspace: string): string {
  return workspace.replace(/\//g, "-");
}

/**
 * Best-effort path to the full Claude transcript for a session, for audit
 * drill-down. Returns null when unknown (caller falls back to sessionId).
 */
export function deriveSessionRef(opts: {
  sessionId: string | null;
  workspace: string;
  claudeConfigDir?: string;
}): string | null {
  if (!opts.sessionId) return null;
  const base = opts.claudeConfigDir ?? join(homedir(), ".claude");
  const candidate = join(
    base,
    "projects",
    encodeProjectDir(opts.workspace),
    `${opts.sessionId}.jsonl`,
  );
  return existsSync(candidate) ? candidate : null;
}
```

- [ ] **Step 4: Run — expect PASS. Commit** — `feat(audit): derive claude transcript path for drill-down`.

---

### Task 8: Audit recorder

**Files:**

- Create: `src/audit/recorder.ts`, `src/audit/recorder.test.ts`

**Interfaces:**

- Consumes: `AuditConfig`, `MappingAuditOverride`, `AuditRecord`, `TokenUsage`; `AuditStore` (Task 4); `deriveSessionRef` (Task 7).
- Produces:
  ```ts
  interface ActivityInput {
    slackTs: string;
    user?: string;
    channel: string;
    threadTs?: string;
    identity: string;
    workspace: string;
    sessionId: string | null;
    claudeConfigDir?: string;
    durationMs: number;
    outcome: "success" | "error";
    error?: string;
    tokens: TokenUsage;
    prompt: string;
    response?: string;
    auditOverride?: MappingAuditOverride;
  }
  interface AuditRecorderDeps {
    config: AuditConfig;
    store: { append(r: AuditRecord): void };
    logger: Logger;
    resolveUser?: (id: string) => Promise<string>;
    resolveChannel?: (id: string) => Promise<string>;
    summarize?: (a: {
      prompt: string;
      response: string;
    }) => Promise<{ summary: string; tokens: TokenUsage }>;
    now?: () => Date;
    genId?: () => string;
  }
  class AuditRecorder {
    record(a: ActivityInput): void;
    drain(): Promise<void>;
  }
  ```
- `record()` is fire-and-forget (never throws); `drain()` awaits in-flight writes (tests).

- [ ] **Step 1: Write failing tests**

```ts
import { AuditRecorder } from "./recorder.js";
import { DEFAULT_AUDIT_CONFIG, AuditRecord } from "../config/types.js";

function harness(configOver = {}, over = {}) {
  const written: AuditRecord[] = [];
  const rec = new AuditRecorder({
    config: { ...DEFAULT_AUDIT_CONFIG, ...configOver },
    store: { append: (r) => written.push(r) },
    logger: { withIdentity: () => ({ warn() {}, error() {}, info() {}, debug() {} }) } as any,
    resolveUser: async () => "Ann",
    resolveChannel: async () => "#eng",
    summarize: async () => ({ summary: "did a thing", tokens: { input: 5, output: 3 } }),
    now: () => new Date("2026-07-21T10:00:00.000Z"),
    genId: () => "aud_test",
    ...over,
  });
  return { rec, written };
}

const base = {
  slackTs: "1",
  user: "U1",
  channel: "C1",
  identity: "id1",
  workspace: "/w",
  sessionId: "s1",
  durationMs: 10,
  outcome: "success" as const,
  tokens: { input: 100, output: 20 },
  prompt: "why fail?",
  response: "because Z",
};

it("records nothing when audit disabled globally and no override", async () => {
  const { rec, written } = harness();
  rec.record(base);
  await rec.drain();
  expect(written).toHaveLength(0);
});

it("records metadata (no summary) when enabled but summary off", async () => {
  const { rec, written } = harness({ enabled: true, summary: false });
  rec.record(base);
  await rec.drain();
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({
    id: "aud_test",
    userName: "Ann",
    channelName: "#eng",
    tokens: { input: 100, output: 20 },
    summary: null,
    summaryTokens: null,
  });
});

it("generates a summary when summary on and outcome success", async () => {
  const { rec, written } = harness({ enabled: true, summary: true });
  rec.record(base);
  await rec.drain();
  expect(written[0]).toMatchObject({
    summary: "did a thing",
    summaryTokens: { input: 5, output: 3 },
  });
});

it("per-map override enables recording when global is off", async () => {
  const { rec, written } = harness({ enabled: false }, {});
  rec.record({ ...base, auditOverride: { enabled: true } });
  await rec.drain();
  expect(written).toHaveLength(1);
});

it("never generates a summary for an error outcome", async () => {
  const { rec, written } = harness({ enabled: true, summary: true });
  rec.record({ ...base, outcome: "error", error: "boom", response: undefined });
  await rec.drain();
  expect(written[0]).toMatchObject({ outcome: "error", error: "boom", summary: null });
});

it("writes summaryError and still records when summarizer throws", async () => {
  const { rec, written } = harness(
    { enabled: true, summary: true },
    {
      summarize: async () => {
        throw new Error("rate limited");
      },
    },
  );
  rec.record(base);
  await rec.drain();
  expect(written[0]).toMatchObject({
    summary: null,
    summaryError: expect.stringContaining("rate limited"),
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `recorder.ts`**

```ts
import { Logger } from "../logger.js";
import { AuditConfig, AuditRecord, MappingAuditOverride, TokenUsage } from "../config/types.js";
import { deriveSessionRef } from "./session-ref.js";

export interface ActivityInput {
  slackTs: string;
  user?: string;
  channel: string;
  threadTs?: string;
  identity: string;
  workspace: string;
  sessionId: string | null;
  claudeConfigDir?: string;
  durationMs: number;
  outcome: "success" | "error";
  error?: string;
  tokens: TokenUsage;
  prompt: string;
  response?: string;
  auditOverride?: MappingAuditOverride;
}

export interface AuditRecorderDeps {
  config: AuditConfig;
  store: { append(r: AuditRecord): void };
  logger: Logger;
  resolveUser?: (id: string) => Promise<string>;
  resolveChannel?: (id: string) => Promise<string>;
  summarize?: (a: {
    prompt: string;
    response: string;
  }) => Promise<{ summary: string; tokens: TokenUsage }>;
  now?: () => Date;
  genId?: () => string;
}

let counter = 0;
function defaultId(now: Date): string {
  counter = (counter + 1) % 1e6;
  return `aud_${now.getTime().toString(36)}_${counter.toString(36)}`;
}

/**
 * Writes audit records off the hot path. `record()` is fire-and-forget and
 * never throws; failures are logged with the mapping identity. `drain()` lets
 * tests await in-flight writes.
 */
export class AuditRecorder {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: AuditRecorderDeps) {}

  record(activity: ActivityInput): void {
    const p = this.write(activity)
      .catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        this.deps.logger.withIdentity(activity.identity).error(`audit write failed: ${m}`);
      })
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async write(a: ActivityInput): Promise<void> {
    const enabled = a.auditOverride?.enabled ?? this.deps.config.enabled;
    if (!enabled) return;
    const wantSummary =
      a.outcome === "success" &&
      a.response != null &&
      (a.auditOverride?.summary ?? this.deps.config.summary) &&
      this.deps.summarize != null;

    const now = (this.deps.now ?? (() => new Date()))();
    const [userName, channelName] = await Promise.all([
      a.user && this.deps.resolveUser
        ? this.deps.resolveUser(a.user)
        : Promise.resolve(a.user ?? null),
      this.deps.resolveChannel ? this.deps.resolveChannel(a.channel) : Promise.resolve(null),
    ]);

    let summary: string | null = null;
    let summaryTokens: TokenUsage | null = null;
    let summaryError: string | null = null;
    if (wantSummary) {
      try {
        const out = await this.deps.summarize!({ prompt: a.prompt, response: a.response! });
        summary = out.summary;
        summaryTokens = out.tokens;
      } catch (err) {
        summaryError = err instanceof Error ? err.message : String(err);
      }
    }

    const record: AuditRecord = {
      id: (this.deps.genId ?? (() => defaultId(now)))(),
      ts: now.toISOString(),
      slackTs: a.slackTs,
      durationMs: a.durationMs,
      user: a.user ?? null,
      userName: userName ?? null,
      channel: a.channel,
      channelName: channelName ?? null,
      threadTs: a.threadTs ?? null,
      identity: a.identity,
      workspace: a.workspace,
      sessionId: a.sessionId,
      sessionRef: deriveSessionRef({
        sessionId: a.sessionId,
        workspace: a.workspace,
        claudeConfigDir: a.claudeConfigDir,
      }),
      outcome: a.outcome,
      error: a.error ?? null,
      tokens: a.tokens,
      summaryTokens,
      summary,
      summaryError,
    };
    this.deps.store.append(record);
  }
}
```

- [ ] **Step 4: Run — expect PASS. Commit** — `feat(audit): add audit recorder orchestration`.

---

### Task 9: Mapping audit override (config + validation)

**Files:**

- Modify: `src/config/types.ts`, `src/config/mappings.ts`
- Test: `src/config/mappings.test.ts`

**Interfaces:**

- Produces: `MappingAuditOverride { enabled?: boolean; summary?: boolean }`; `Mapping.audit?: MappingAuditOverride`. `validateMapping` preserves a provided partial override and omits the field when absent/empty.

- [ ] **Step 1: Add types** to `types.ts`

```ts
/** Per-mapping override of the global {@link AuditConfig}. Absent fields inherit. */
export interface MappingAuditOverride {
  enabled?: boolean;
  summary?: boolean;
}
```

Add to `Mapping`:

```ts
  /** Per-mapping audit override; absent fields inherit the global audit config. */
  audit?: MappingAuditOverride;
```

- [ ] **Step 2: Write failing tests** (append to `mappings.test.ts`)

```ts
it("defaults audit override to absent for mappings without it", () => {
  const m = validateMapping({
    identity: "a",
    channel: "C1",
    workspace: "/w",
    scope: "channel",
    trigger: "mention",
  });
  expect(m.audit).toBeUndefined();
});

it("round-trips an audit override", () => {
  const m = validateMapping({
    identity: "a",
    channel: "C1",
    workspace: "/w",
    scope: "channel",
    trigger: "mention",
    audit: { enabled: true, summary: false },
  });
  expect(m.audit).toEqual({ enabled: true, summary: false });
});

it("omits an empty audit override object", () => {
  const m = validateMapping({
    identity: "a",
    channel: "C1",
    workspace: "/w",
    scope: "channel",
    trigger: "mention",
    audit: {},
  });
  expect(m.audit).toBeUndefined();
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** in `validateMapping` (before the `return`)

```ts
// Per-mapping audit override: keep only booleans that are actually set, and
// drop an empty object so "inherit global" stays the default representation.
const auditIn = input.audit ?? {};
const audit: MappingAuditOverride = {};
if (typeof auditIn.enabled === "boolean") audit.enabled = auditIn.enabled;
if (typeof auditIn.summary === "boolean") audit.summary = auditIn.summary;
const hasAudit = Object.keys(audit).length > 0;
```

Add to the returned object literal:

```ts
    ...(hasAudit ? { audit } : {}),
```

(Import `MappingAuditOverride` in the types import list.)

- [ ] **Step 5: Run — expect PASS. Commit** — `feat(audit): add per-mapping audit override`.

---

### Task 10: Handler capture hook

**Files:**

- Modify: `src/slack/handler.ts`
- Test: `src/slack/handler.test.ts`

**Interfaces:**

- Consumes: `ActivityInput` (Task 8).
- Produces: `HandlerDeps.audit?: { record(a: ActivityInput): void }`. The handler times the invocation and calls `deps.audit?.record(...)` at the success and both error terminal points, after the reply is posted. No audit call on the "no actionable content" path.

- [ ] **Step 1: Write failing tests** (append to `handler.test.ts`, using the existing fake-invoke pattern)

```ts
it("records a success audit activity after replying", async () => {
  const recorded: any[] = [];
  await handleInbound(
    {
      ...baseDeps,
      audit: { record: (a) => recorded.push(a) },
      invoke: async () => ({ text: "reply", sessionId: "s1", usage: { input: 7, output: 3 } }),
    },
    inboundMention("hello"),
  );
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({
    outcome: "success",
    identity: "id1",
    channel: "C1",
    tokens: { input: 7, output: 3 },
    prompt: "hello",
    response: "reply",
    sessionId: "s1",
  });
  expect(typeof recorded[0].durationMs).toBe("number");
});

it("records an error audit activity when invocation fails", async () => {
  const recorded: any[] = [];
  await handleInbound(
    {
      ...baseDeps,
      audit: { record: (a) => recorded.push(a) },
      invoke: async () => {
        throw new Error("boom");
      },
    },
    inboundMention("hello"),
  );
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ outcome: "error", error: expect.stringContaining("boom") });
});

it("does not record when there is no actionable content", async () => {
  const recorded: any[] = [];
  await handleInbound(
    { ...baseDeps, audit: { record: (a) => recorded.push(a) } },
    inboundMention(""), // empty prompt, no files
  );
  expect(recorded).toHaveLength(0);
});
```

(Reuse/define `baseDeps`, `inboundMention` per the existing test file's helpers; ensure the fake `invoke` returns `usage`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** in `handler.ts`

Add the import and dep field:

```ts
import { ActivityInput } from "../audit/recorder.js";
```

In `HandlerDeps`:

```ts
  /** Records an audit activity per invocation (fire-and-forget). Absent ⇒ no auditing. */
  audit?: { record(activity: ActivityInput): void };
```

In `runOneInvocation`, capture the raw user prompt and time the work. After the actionable check (line ~166) add:

```ts
const auditPrompt = rawPrompt;
const startedAt = Date.now();
const auditBase = {
  slackTs: msg.ts,
  user: msg.user,
  channel: msg.channel,
  threadTs: decision.replyThreadTs,
  identity: mapping.identity,
  workspace: mapping.workspace,
  claudeConfigDir: mapping.claudeConfigDir,
  prompt: auditPrompt,
  auditOverride: mapping.audit,
};
const recordError = (message: string): void =>
  deps.audit?.record({
    ...auditBase,
    durationMs: Date.now() - startedAt,
    outcome: "error",
    error: message,
    sessionId: null,
    tokens: { input: 0, output: 0 },
  });
```

In the two error `return` points (after posting the `:warning:` message), add `recordError(message)` / `recordError(message2)` respectively, before `return`.

After the successful reply (`log.info(\`replied to session ${key}\`); succeeded = true;`), add:

```ts
deps.audit?.record({
  ...auditBase,
  durationMs: Date.now() - startedAt,
  outcome: "success",
  sessionId: result.sessionId,
  tokens: result.usage,
  response: result.text,
});
```

- [ ] **Step 4: Run `npm run verify` — expect PASS. Commit** — `feat(audit): record invocations from the handler`.

---

### Task 11: `audit/CLAUDE.md` generator

**Files:**

- Create: `src/audit/claude-md.ts`, `src/audit/claude-md.test.ts`

**Interfaces:**

- Produces: `AUDIT_CLAUDE_MD: string` (the guide content); `writeAuditClaudeMd(home): void` (writes `audit/CLAUDE.md`, creating dirs; idempotent overwrite).

- [ ] **Step 1: Write failing test**

```ts
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUDIT_CLAUDE_MD, writeAuditClaudeMd } from "./claude-md.js";
import { auditDir } from "../config/paths.js";

it("documents the partition layout, schema, drill-down, and read-only rule", () => {
  expect(AUDIT_CLAUDE_MD).toMatch(/YYYY-MM-DD\.jsonl/);
  expect(AUDIT_CLAUDE_MD).toMatch(/sessionRef/);
  expect(AUDIT_CLAUDE_MD).toMatch(/rollup/i);
  expect(AUDIT_CLAUDE_MD).toMatch(/read-only|never modify/i);
});

it("writes CLAUDE.md into the audit dir", () => {
  const home = mkdtempSync(join(tmpdir(), "audit-md-"));
  writeAuditClaudeMd(home);
  const file = join(auditDir(home), "CLAUDE.md");
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, "utf8")).toBe(AUDIT_CLAUDE_MD);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `claude-md.ts`** — export `AUDIT_CLAUDE_MD` as a template string covering: what this dir is; the `YYYY/MM/YYYY-MM-DD.jsonl` layout + `.jsonl.gz` (read with `rg -z`) + `MM.rollup.json`; the `AuditRecord` schema (list each field); efficient-scan rules (narrow by date → open only relevant partitions; use rollups for long ranges); common recipes (`rg`/`jq` one-liners for by-user/by-channel/by-date/token-spend); drill-down (read the `sessionRef` path, else use `sessionId`); and a read-only guardrail. Then:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditDir } from "../config/paths.js";

export const AUDIT_CLAUDE_MD = `# Audit trail — query guide
... (full content per the design §9) ...
`;

export function writeAuditClaudeMd(home: string): void {
  const dir = auditDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), AUDIT_CLAUDE_MD);
}
```

- [ ] **Step 4: Run — expect PASS. Commit** — `feat(audit): add self-describing audit CLAUDE.md`.

---

### Task 12: Maintenance — compact / rollup / prune

**Files:**

- Create: `src/audit/maintenance.ts`, `src/audit/maintenance.test.ts`

**Interfaces:**

- Consumes: `AuditStore` partition layout; `auditDir`.
- Produces: `compact(home, olderThanDays, now?): string[]` (gzip `.jsonl` older than cutoff → `.jsonl.gz`, delete original; returns compacted paths); `rollup(home, month: string /* "YYYY-MM" */): string` (write `audit/YYYY/MM.rollup.json` aggregate; returns path); `prune(home, olderThanDays, now?): string[]` (delete raw `.jsonl`/`.jsonl.gz` partitions older than cutoff; returns removed paths).

- [ ] **Step 1: Write failing tests** — create dated partitions with an injected `now`, assert: `compact` gzips only files older than the cutoff and removes the originals; `rollup` emits per-user/per-channel counts and token totals for the month; `prune` removes only partitions older than the cutoff. (Write concrete assertions mirroring Task 4's setup.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `maintenance.ts`** — walk `auditDir(home)`; parse the date from each partition filename (`YYYY-MM-DD`); compare to `now - olderThanDays`; `compact` uses `gzipSync` + `rmSync`; `rollup` reads the month's partitions via a shared read helper and reduces into `{ month, byUser: {id: {count, input, output}}, byChannel: {...}, firstTs, lastTs }`; `prune` `rmSync`s matched partitions. Reuse `AuditStore.read` filtering where practical; keep functions pure w.r.t. an injected `now`.

- [ ] **Step 4: Run — expect PASS. Commit** — `feat(audit): add compact/rollup/prune maintenance`.

---

### Task 13: Bridge wiring

**Files:**

- Modify: `src/bridge.ts`
- Test: covered indirectly (bridge has no unit test; verify via typecheck + Task 17 manual run).

**Interfaces:**

- Consumes: `AuditConfigStore`, `AuditStore`, `AuditRecorder`, `createChannelResolver`, `summarizeActivity`, `writeAuditClaudeMd`, `claudeBin`.

- [ ] **Step 1: Implement** — in `runBridge`, after the existing `userResolver` line:

```ts
const auditConfig = AuditConfigStore.load(home).get();
const channelResolver = createChannelResolver(creds.botToken, logger);
const auditStore = new AuditStore(home);
writeAuditClaudeMd(home); // keep the query guide current
const bin = claudeBin();
const auditRecorder = new AuditRecorder({
  config: auditConfig,
  store: auditStore,
  logger,
  resolveUser: (id) => userResolver.resolve(id),
  resolveChannel: (id) => channelResolver.resolve(id),
  summarize: ({ prompt, response }) => summarizeActivity({ bin, prompt, response }),
});
```

Pass `audit: { record: (a) => auditRecorder.record(a) }` into the `createSlackApp` deps object (alongside `resolveUser`). Add the imports.

- [ ] **Step 2: Run `npm run verify` — expect PASS (typecheck confirms wiring). Commit** — `feat(audit): wire audit recorder into the bridge`.

---

### Task 14: CLI — audit query + maintenance commands

**Files:**

- Create: `src/cli/audit.ts`, `src/cli/audit.test.ts`
- Modify: `src/cli/index.ts`

**Interfaces:**

- Produces: `runAudit(args: string[]): void` (parses `--user/--channel/--identity/--since/--until/--json/--csv`, reads via `AuditStore`, prints one-liners or export); `runAuditMaintenance(sub: string, args: string[]): void` (`compact`/`rollup`/`prune`, `prune` requires `--yes`).

- [ ] **Step 1: Write failing tests** for the pure formatting/filtering helpers (factor a `filterRecords(records, opts)` and `formatLine(record)` so they're testable without stdout): filter by user/channel/date; one-liner includes name, identity, outcome, tokens, and truncated summary; CSV row escaping. Assert `prune` without `--yes` is a no-op that prints a warning (inject a fake maintenance fn or a temp home).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `audit.ts`** — parse flags; `AuditStore.load`-style read (construct `new AuditStore(resolveHome())`); apply `filterRecords`; default output = `formatLine` per record (`<ts> · <userName|user> · <identity> · <channelName|channel> · <outcome> · <in>/<out> tok · "<summary…>"`); `--json` prints the array; `--csv` prints header + rows. Maintenance dispatches to `compact`/`rollup`/`prune` from Task 12, reading retention defaults from `AuditConfigStore` when `--older-than` is omitted.

- [ ] **Step 4: Wire into `index.ts`** — add `import { runAudit, runAuditMaintenance } from "./audit.js";`; add an `else if (cmd === "audit")` branch:

```ts
    } else if (cmd === "audit") {
      if (sub === "compact" || sub === "rollup" || sub === "prune") {
        runAuditMaintenance(sub, process.argv.slice(4));
      } else {
        runAudit(process.argv.slice(3));
      }
```

Add usage lines to `usage()`:

```ts
      "  slack-claude audit [--user U] [--channel C] [--since D]  Show the audit trail",
      "  slack-claude audit compact|rollup|prune                  Audit retention maintenance",
```

- [ ] **Step 5: Run `npm run verify` — expect PASS. Commit** — `feat(audit): add audit query and maintenance CLI`.

---

### Task 15: CLI — init + map prompts for the audit toggle

**Files:**

- Modify: `src/cli/index.ts`
- Test: exercised via `mappings.test.ts` (override round-trip, Task 9) + manual (Task 17).

**Interfaces:**

- Consumes: `AuditConfigStore`, `Prompter` (`confirm`).

- [ ] **Step 1: Implement init prompts** — in `cmdInit`, after the existing questions, add (with the info note):

```ts
const auditEnabled = await p.confirm("Enable the audit trail (records who did what)?", false);
let auditSummary = false;
if (auditEnabled) {
  auditSummary = await p.confirm(
    "Generate Claude summaries for each audit record?\n" +
      "  Note: summaries invoke Claude and consume tokens.",
    false,
  );
}
AuditConfigStore.load(resolve(home)).set({ enabled: auditEnabled, summary: auditSummary });
```

(Import `AuditConfigStore`. `home` here is the answer to the storage-location question.)

- [ ] **Step 2: Implement map add/edit override prompts** — add a shared constant and prompts:

```ts
const AUDIT_OVERRIDE_PROMPT =
  "Override audit for this mapping? (No = inherit global audit settings)";
```

In `cmdMapAdd` (and `cmdMapEdit` with current values as defaults), after `slackPrefix`:

```ts
const auditOverride = await p.confirm(AUDIT_OVERRIDE_PROMPT, false);
let audit: { enabled?: boolean; summary?: boolean } | undefined;
if (auditOverride) {
  const enabled = await p.confirm("  Record audit for this mapping?", true);
  const summary = enabled
    ? await p.confirm("  Generate summaries for this mapping? (consumes tokens)", false)
    : false;
  audit = { enabled, summary };
}
```

Pass `audit` into `store.add({ ... , audit })` / `store.edit(identity, { ... , audit })`.

- [ ] **Step 3: Update `cmdMapList`** — add a line:

```ts
        `  audit:       ${m.audit ? `override (record=${m.audit.enabled ?? "inherit"}, summary=${m.audit.summary ?? "inherit"})` : "inherit global"}\n` +
```

- [ ] **Step 4: Run `npm run verify` — expect PASS. Commit** — `feat(audit): add CLI toggles for audit trail`.

---

### Task 16: Slack manifest scopes + docs

**Files:**

- Modify: `docs/slack-app-manifest.yml`
- Modify: `CLAUDE.md` (Skills & config / scope note, if a scope list exists) — otherwise skip.

- [ ] **Step 1:** Add `channels:read` and `groups:read` to the bot scopes in `docs/slack-app-manifest.yml`, each with a one-line comment: `# audit: resolve channel id → #name`.
- [ ] **Step 2:** If `docs/` documents required scopes anywhere (e.g. `AGENT-SETUP.md`), add the two scopes with the same one-line rationale.
- [ ] **Step 3: Commit** — `docs(audit): add channels:read/groups:read scopes for audit`.

---

### Task 17: End-to-end verification

**Files:** none (verification only). Uses the `run-bridge` and `verifying-work` skills.

- [ ] **Step 1:** `npm run verify` — all green (target: 215 baseline + new tests).
- [ ] **Step 2:** In a scratch `SLACK_CLAUDE_HOME`, `slack-claude init` with audit enabled + summary enabled; add a mapping; confirm `audit-config.json` written.
- [ ] **Step 3:** Start the bridge (`run-bridge` skill), send a mention in the mapped channel, and confirm a record lands in `audit/YYYY/MM/YYYY-MM-DD.jsonl` with resolved `userName`/`channelName`, `tokens`, and a `summary`.
- [ ] **Step 4:** `slack-claude audit --user <id>` shows the one-liner; `--json` exports.
- [ ] **Step 5:** Open a `claude` session inside `audit/` and confirm the `CLAUDE.md` lets it answer "who did what today" and drill into a `sessionRef`.
- [ ] **Step 6:** Confirm the summarizer flags are lightweight (verified against `claude-code-guide` in Task 6) and it does not run inside `audit/`.
- [ ] **Step 7:** Toggle a per-map override off; confirm that mapping stops summarizing while another keeps recording.

---

## Self-review

**Spec coverage:** storage/partitioning (T1,T4,T12) · record schema incl. tokens + names + sessionRef (T3,T4,T7,T8) · capture hook (T10) · summarizer no-SDK (T6) · name resolution + scope (T5,T16) · config split global+per-map (T2,T9,T15) · access CLI (T14) · audit/CLAUDE.md (T11) · wiring (T13) · retention/maintenance (T12,T14). All spec sections map to a task.

**Placeholder scan:** the two spec-flagged unknowns (summarizer strip flags, sessionRef encoding) are implemented with a working best-effort default plus an explicit in-task verification step — not deferred blanks.

**Type consistency:** `ClaudeResult.usage: TokenUsage` (T3) is consumed as `result.usage` (T10) and stored as `tokens` (T8). `ActivityInput` (T8) matches the object the handler builds (T10). `AuditRecorder` deps `store.append` matches `AuditStore.append` (T4). `MappingAuditOverride` (T9) matches `ActivityInput.auditOverride` and the recorder's `auditOverride?.enabled/summary` reads.
