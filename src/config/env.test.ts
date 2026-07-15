import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { configEnvPath } from "./env.js";

describe("configEnvPath", () => {
  it("points at .env inside the per-user config dir (linux)", () => {
    const path = configEnvPath({ XDG_CONFIG_HOME: "/cfg" });
    expect(path).toBe(join("/cfg", "slack-claude", ".env"));
  });

  it("is absolute regardless of environment", () => {
    const path = configEnvPath({});
    expect(path.endsWith(join("slack-claude", ".env"))).toBe(true);
  });
});
