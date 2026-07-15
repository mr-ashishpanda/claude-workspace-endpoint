import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { platformDirs } from "./platform.js";

const home = homedir();

describe("platformDirs", () => {
  it("uses XDG dirs on linux, honoring overrides", () => {
    const dirs = platformDirs({ XDG_CONFIG_HOME: "/cfg", XDG_STATE_HOME: "/state" }, "linux");
    expect(dirs.config).toBe(join("/cfg", "slack-claude"));
    expect(dirs.data).toBe(join("/state", "slack-claude"));
    expect(dirs.log).toBe(join("/state", "slack-claude", "logs"));
  });

  it("falls back to ~/.config and ~/.local/state on linux without XDG vars", () => {
    const dirs = platformDirs({}, "linux");
    expect(dirs.config).toBe(join(home, ".config", "slack-claude"));
    expect(dirs.data).toBe(join(home, ".local", "state", "slack-claude"));
    expect(dirs.log).toBe(join(home, ".local", "state", "slack-claude", "logs"));
  });

  it("uses APPDATA / LOCALAPPDATA on windows", () => {
    const dirs = platformDirs({ APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local" }, "win32");
    expect(dirs.config).toBe(join("C:\\Roaming", "slack-claude", "Config"));
    expect(dirs.data).toBe(join("C:\\Local", "slack-claude", "Data"));
    expect(dirs.log).toBe(join("C:\\Local", "slack-claude", "Log"));
  });

  it("falls back to ~/AppData on windows without env vars", () => {
    const dirs = platformDirs({}, "win32");
    expect(dirs.config).toBe(join(home, "AppData", "Roaming", "slack-claude", "Config"));
    expect(dirs.data).toBe(join(home, "AppData", "Local", "slack-claude", "Data"));
  });

  it("uses ~/Library dirs on macOS", () => {
    const dirs = platformDirs({}, "darwin");
    expect(dirs.config).toBe(join(home, "Library", "Application Support", "slack-claude"));
    expect(dirs.data).toBe(join(home, "Library", "Application Support", "slack-claude"));
    expect(dirs.log).toBe(join(home, "Library", "Logs", "slack-claude"));
  });

  it("treats blank env values as unset", () => {
    const dirs = platformDirs({ XDG_CONFIG_HOME: "   " }, "linux");
    expect(dirs.config).toBe(join(home, ".config", "slack-claude"));
  });

  it("always returns absolute paths", () => {
    for (const platform of ["linux", "darwin", "win32"] as NodeJS.Platform[]) {
      const dirs = platformDirs({}, platform);
      expect(isAbsolute(dirs.config)).toBe(true);
      expect(isAbsolute(dirs.data)).toBe(true);
      expect(isAbsolute(dirs.log)).toBe(true);
    }
  });
});
