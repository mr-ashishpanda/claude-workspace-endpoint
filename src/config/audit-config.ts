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
