import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MappingStore, validateMapping, MappingValidationError } from "./mappings.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "scb-map-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const base = {
  identity: "auth-investigator",
  channel: "C1",
  workspace: "/repos/auth",
  scope: "channel" as const,
  trigger: "auto" as const,
};

describe("validateMapping", () => {
  it("rejects bad identities", () => {
    expect(() => validateMapping({ ...base, identity: "Bad Name" })).toThrow(
      MappingValidationError,
    );
  });
  it("rejects unknown scope/trigger", () => {
    expect(() => validateMapping({ ...base, scope: "global" as never })).toThrow();
    expect(() => validateMapping({ ...base, trigger: "always" as never })).toThrow();
  });
  it("resolves workspace to an absolute path", () => {
    const m = validateMapping({ ...base, workspace: "relative/dir" });
    expect(m.workspace.startsWith("/")).toBe(true);
  });

  it("defaults model to 'default' and skipPermissions to false when absent", () => {
    const m = validateMapping(base);
    expect(m.model).toBe("default");
    expect(m.skipPermissions).toBe(false);
  });

  it("accepts each supported model family", () => {
    for (const model of ["default", "sonnet", "opus", "haiku"] as const) {
      expect(validateMapping({ ...base, model }).model).toBe(model);
    }
  });

  it("rejects an unknown model family", () => {
    expect(() => validateMapping({ ...base, model: "gpt" as never })).toThrow(
      MappingValidationError,
    );
  });

  it("preserves an explicit skipPermissions=true", () => {
    expect(validateMapping({ ...base, skipPermissions: true }).skipPermissions).toBe(true);
  });
});

describe("MappingStore CRUD + persistence", () => {
  it("adds, persists, and reloads", () => {
    const store = MappingStore.load(home);
    store.add(base);
    expect(existsSync(join(home, "mappings.json"))).toBe(true);
    const reloaded = MappingStore.load(home);
    expect(reloaded.get("auth-investigator")?.channel).toBe("C1");
  });

  it("enforces unique identity", () => {
    const store = MappingStore.load(home);
    store.add(base);
    expect(() => store.add(base)).toThrow(MappingValidationError);
  });

  it("edits an existing mapping (identity immutable)", () => {
    const store = MappingStore.load(home);
    store.add(base);
    const updated = store.edit("auth-investigator", { trigger: "mention" });
    expect(updated.trigger).toBe("mention");
    expect(updated.identity).toBe("auth-investigator");
  });

  it("removes a mapping", () => {
    const store = MappingStore.load(home);
    store.add(base);
    expect(store.remove("auth-investigator")).toBe(true);
    expect(MappingStore.load(home).list()).toHaveLength(0);
  });

  it("filters by channel", () => {
    const store = MappingStore.load(home);
    store.add(base);
    store.add({ ...base, identity: "other", channel: "C2" });
    expect(store.forChannel("C1").map((m) => m.identity)).toEqual(["auth-investigator"]);
  });

  it("round-trips model and skipPermissions", () => {
    const store = MappingStore.load(home);
    store.add({ ...base, model: "opus", skipPermissions: true });
    const reloaded = MappingStore.load(home).get("auth-investigator");
    expect(reloaded?.model).toBe("opus");
    expect(reloaded?.skipPermissions).toBe(true);
  });

  it("loads legacy mappings without the new fields (defaults applied)", () => {
    const store = MappingStore.load(home);
    store.add(base);
    // Simulate a pre-existing file written before the new fields existed.
    const file = join(home, "mappings.json");
    const legacy = [
      {
        identity: "legacy",
        channel: "C9",
        workspace: "/repos/x",
        scope: "thread",
        trigger: "mention",
      },
    ];
    writeFileSync(file, JSON.stringify(legacy));
    const reloaded = MappingStore.load(home).get("legacy");
    expect(reloaded?.model).toBe("default");
    expect(reloaded?.skipPermissions).toBe(false);
  });
});
