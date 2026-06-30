#!/usr/bin/env bash
# PostToolUse hook: format edited JS/TS/JSON files with Prettier if available.
# Best-effort and silent on missing tooling — never blocks the edit.
set -euo pipefail

input="$(cat)"

path="$(printf '%s' "$input" | node -e '
  let s = "";
  process.stdin.on("data", d => (s += d));
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s);
      const ti = j.tool_input || {};
      process.stdout.write(ti.file_path || "");
    } catch { process.stdout.write(""); }
  });
' 2>/dev/null || true)"

[ -z "$path" ] && exit 0
[ -f "$path" ] || exit 0

case "$path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md) ;;
  *) exit 0 ;;
esac

# Only format if prettier is installed locally; don't trigger a network npx fetch.
if [ -x "node_modules/.bin/prettier" ]; then
  node_modules/.bin/prettier --write --log-level warn "$path" >/dev/null 2>&1 || true
fi

exit 0
