import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  Mapping,
  SESSION_SCOPES,
  TRIGGER_MODES,
  CLAUDE_MODELS,
  SessionScope,
  TriggerMode,
  ClaudeModel,
} from "./types.js";
import { mappingsPath, resolveHome } from "./paths.js";

export class MappingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingValidationError";
  }
}

const IDENTITY_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Validate a raw mapping, normalizing the workspace to an absolute path. */
export function validateMapping(input: Partial<Mapping>): Mapping {
  const identity = input.identity?.trim() ?? "";
  if (!IDENTITY_RE.test(identity)) {
    throw new MappingValidationError(
      `Invalid identity "${identity}": use lowercase letters, digits, and hyphens (e.g. auth-investigator).`,
    );
  }

  const channel = input.channel?.trim() ?? "";
  if (!channel) {
    throw new MappingValidationError("Slack channel is required.");
  }

  const workspaceRaw = input.workspace?.trim() ?? "";
  if (!workspaceRaw) {
    throw new MappingValidationError("Workspace directory is required.");
  }
  const workspace = resolve(workspaceRaw);

  const scope = input.scope as SessionScope;
  if (!SESSION_SCOPES.includes(scope)) {
    throw new MappingValidationError(
      `Invalid scope "${input.scope}": expected one of ${SESSION_SCOPES.join(", ")}.`,
    );
  }

  const trigger = input.trigger as TriggerMode;
  if (!TRIGGER_MODES.includes(trigger)) {
    throw new MappingValidationError(
      `Invalid trigger "${input.trigger}": expected one of ${TRIGGER_MODES.join(", ")}.`,
    );
  }

  // New fields default so mappings written before they existed still load.
  const model = (input.model ?? "default") as ClaudeModel;
  if (!CLAUDE_MODELS.includes(model)) {
    throw new MappingValidationError(
      `Invalid model "${input.model}": expected one of ${CLAUDE_MODELS.join(", ")}.`,
    );
  }

  const skipPermissions = input.skipPermissions ?? false;

  return { identity, channel, workspace, scope, trigger, model, skipPermissions };
}

/**
 * Local-file store of channel-to-workspace mappings. Persisted as JSON under
 * SLACK_CLAUDE_HOME so configuration survives bridge restarts.
 */
export class MappingStore {
  private mappings: Mapping[];

  private constructor(
    private readonly file: string,
    mappings: Mapping[],
  ) {
    this.mappings = mappings;
  }

  /** Load the store from disk (empty if no file exists yet). */
  static load(home: string = resolveHome()): MappingStore {
    const file = mappingsPath(home);
    if (!existsSync(file)) return new MappingStore(file, []);
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return new MappingStore(file, []);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new MappingValidationError(
        `Corrupt mappings file at ${file}: ${(err as Error).message}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new MappingValidationError(`Mappings file at ${file} must contain a JSON array.`);
    }
    const mappings = parsed.map((m) => validateMapping(m as Partial<Mapping>));
    return new MappingStore(file, mappings);
  }

  list(): Mapping[] {
    return [...this.mappings];
  }

  /** All mappings bound to a given Slack channel id. */
  forChannel(channel: string): Mapping[] {
    return this.mappings.filter((m) => m.channel === channel);
  }

  get(identity: string): Mapping | undefined {
    return this.mappings.find((m) => m.identity === identity);
  }

  /** Add a new mapping; identity must be unique. */
  add(input: Partial<Mapping>): Mapping {
    const mapping = validateMapping(input);
    if (this.get(mapping.identity)) {
      throw new MappingValidationError(
        `A mapping with identity "${mapping.identity}" already exists.`,
      );
    }
    this.mappings.push(mapping);
    this.persist();
    return mapping;
  }

  /** Replace an existing mapping's fields (identity itself is immutable). */
  edit(identity: string, changes: Partial<Mapping>): Mapping {
    const idx = this.mappings.findIndex((m) => m.identity === identity);
    if (idx === -1) {
      throw new MappingValidationError(`No mapping found with identity "${identity}".`);
    }
    const current = this.mappings[idx]!;
    const merged = validateMapping({ ...current, ...changes, identity });
    this.mappings[idx] = merged;
    this.persist();
    return merged;
  }

  /** Remove a mapping by identity. Returns true if one was removed. */
  remove(identity: string): boolean {
    const before = this.mappings.length;
    this.mappings = this.mappings.filter((m) => m.identity !== identity);
    const removed = this.mappings.length < before;
    if (removed) this.persist();
    return removed;
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.mappings, null, 2) + "\n");
  }
}
