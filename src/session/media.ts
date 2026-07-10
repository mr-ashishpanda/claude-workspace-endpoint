import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { mediaDir, resolveHome } from "../config/paths.js";

/** Replace path separators and traversal so a segment stays one directory deep. */
function safeSegment(input: string): string {
  const flat = basename(input).replace(/[/\\]/g, "_").replace(/\.\.+/g, "_");
  return flat.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
}

/**
 * Caches Slack image downloads under `<SLACK_CLAUDE_HOME>/media/<key>/` so the
 * bridge can hand headless `claude` an absolute path it can read. Kept out of
 * the mapped workspace to avoid polluting the user's repo (local-first).
 */
export class MediaStore {
  private readonly root: string;

  constructor(home: string = resolveHome()) {
    this.root = mediaDir(home);
  }

  /**
   * Write `data` for `filename` under a directory named for `key` (e.g. the
   * message ts). Returns the absolute path. Key and filename are sanitized so
   * they cannot escape the media directory; same-name files get a numeric
   * suffix rather than clobbering each other.
   */
  save(key: string, filename: string, data: Buffer): string {
    const dir = join(this.root, safeSegment(key));
    mkdirSync(dir, { recursive: true });

    const safeName = safeSegment(filename);
    let target = join(dir, safeName);
    if (existsSync(target)) {
      const dot = safeName.lastIndexOf(".");
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
      const ext = dot > 0 ? safeName.slice(dot) : "";
      let n = 1;
      do {
        target = join(dir, `${stem}-${n}${ext}`);
        n += 1;
      } while (existsSync(target));
    }
    writeFileSync(target, data);
    return target;
  }
}
