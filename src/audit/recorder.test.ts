import { expect, it } from "vitest";
import { AuditRecorder, type AuditRecorderDeps, type ActivityInput } from "./recorder.js";
import { DEFAULT_AUDIT_CONFIG, AuditRecord } from "../config/types.js";
import { Logger } from "../logger.js";

function harness(configOver = {}, over: Partial<AuditRecorderDeps> = {}) {
  const written: AuditRecord[] = [];
  const rec = new AuditRecorder({
    config: { ...DEFAULT_AUDIT_CONFIG, ...configOver },
    store: { append: (r) => written.push(r) },
    logger: {
      withIdentity: () => ({ warn() {}, error() {}, info() {}, debug() {} }),
    } as unknown as Logger,
    resolveUser: async () => "Ann",
    resolveChannel: async () => "#eng",
    summarize: async () => ({ summary: "did a thing", tokens: { input: 5, output: 3 } }),
    now: () => new Date("2026-07-21T10:00:00.000Z"),
    genId: () => "aud_test",
    ...over,
  });
  return { rec, written };
}

const base: ActivityInput = {
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

it("override summary=true beats global summary=false", async () => {
  const { rec, written } = harness({ enabled: true, summary: false });
  rec.record({ ...base, auditOverride: { summary: true } });
  await rec.drain();
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({
    summary: "did a thing",
    summaryTokens: { input: 5, output: 3 },
  });
});

it("override enabled=false beats global enabled=true (no record)", async () => {
  const { rec, written } = harness({ enabled: true });
  rec.record({ ...base, auditOverride: { enabled: false } });
  await rec.drain();
  expect(written).toHaveLength(0);
});

it("error outcome does not summarize even when response is present", async () => {
  const { rec, written } = harness({ enabled: true, summary: true });
  rec.record({
    ...base,
    outcome: "error",
    error: "boom",
    response: "some response text",
  });
  await rec.drain();
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({ outcome: "error", error: "boom", summary: null });
});
