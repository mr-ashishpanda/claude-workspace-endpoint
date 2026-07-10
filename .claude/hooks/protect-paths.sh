#!/usr/bin/env bash
# PreToolUse hook: block edits to secrets and lockfiles.
# Reads the tool-call JSON on stdin; exits 2 to deny with a message on stderr.
set -euo pipefail

input="$(cat)"

# Extract the target file path from tool_input (file_path or notebook_path).
path="$(printf '%s' "$input" | node -e '
  let s = "";
  process.stdin.on("data", d => (s += d));
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s);
      const ti = j.tool_input || {};
      process.stdout.write(ti.file_path || ti.notebook_path || "");
    } catch { process.stdout.write(""); }
  });
' 2>/dev/null || true)"

[ -z "$path" ] && exit 0

base="$(basename "$path")"

case "$base" in
  .env|.env.*)
    # Allow the committed template.
    if [ "$base" != ".env.example" ]; then
      echo "BLOCKED: '$path' holds secrets. Ask the user to edit env files manually." >&2
      exit 2
    fi
    ;;
  package-lock.json|pnpm-lock.yaml|yarn.lock)
    echo "BLOCKED: '$base' is a lockfile. Run the package manager instead of hand-editing." >&2
    exit 2
    ;;
  *.pem|*.key|id_rsa|id_ed25519|*.p12|*.keystore)
    echo "BLOCKED: '$path' looks like a private key / credential. Edit it manually." >&2
    exit 2
    ;;
esac

exit 0
