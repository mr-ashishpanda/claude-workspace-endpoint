# Slack Sender Prefix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a mapping tag every prompt sent to Claude with `[Slack: <sender>]` so a
workspace's own `CLAUDE.md`/`slack.md` can detect Slack-originated messages and reply
accordingly, plus ship reference `slack.md`/`CLAUDE.md`-snippet templates users can
adopt in their own mapped workspace repos.

**Architecture:** A new boolean `Mapping.slackPrefix` field gates a small prompt-text
transform applied in the existing handler pipeline, right after the existing
"nothing actionable" skip check and right before the existing image-prompt augmentation.
The sender's display name is resolved via a new, independently-cacheable
`UserResolver` wrapping Slack's `users.info`, following the same injectable-Web-API-client
pattern already used by `channel-check.ts`.

**Tech Stack:** TypeScript (strict, ESM), vitest, `@slack/web-api` (already a
dependency, used by `channel-check.ts`).

## Global Constraints

- TypeScript strict; no unjustified `any`.
- ESM imports with `.js` extensions on relative imports (NodeNext resolution).
- One logger; mapping identity always available via `logger.withIdentity`.
- Fixed prefix format only: `[Slack: <name>]` — no user-configurable template/wording.
- Enable/disable (`slackPrefix: boolean`) is the only per-mapping knob for this feature.
- `validateMapping` must default any new field so pre-existing `mappings.json` files
  (written before this field existed) still load without error.
- The bridge never writes into a mapped workspace directory — reference templates
  live only under this repo's `docs/templates/`.
- No reinstall/migration messaging needed anywhere (new installation, no existing
  customers) — just ship the manifest with the correct scopes.
- Naming: "the bridge", never "agent", in code/logs/docs.

---

### Task 1: `Mapping.slackPrefix` field + validation default

**Files:**

- Modify: `src/config/types.ts` (add field to `Mapping` interface)
- Modify: `src/config/mappings.ts` (`validateMapping`)
- Test: `src/config/mappings.test.ts`

**Interfaces:**

- Produces: `Mapping.slackPrefix: boolean` — every later task that touches a
  `Mapping` (handler, CLI) reads this field.

- [ ] **Step 1: Write the failing tests**

Add to `src/config/mappings.test.ts`, inside `describe("validateMapping", ...)`:

```ts
it("defaults slackPrefix to false when absent", () => {
  expect(validateMapping(base).slackPrefix).toBe(false);
});

it("preserves an explicit slackPrefix=true", () => {
  expect(validateMapping({ ...base, slackPrefix: true }).slackPrefix).toBe(true);
});
```

Add to `describe("MappingStore CRUD + persistence", ...)`:

```ts
it("round-trips slackPrefix", () => {
  const store = MappingStore.load(home);
  store.add({ ...base, slackPrefix: true });
  expect(MappingStore.load(home).get("auth-investigator")?.slackPrefix).toBe(true);
});
```

Extend the existing legacy-mapping test (`"loads legacy mappings without the new
fields (defaults applied)"`) with one more assertion right after the
`skipPermissions` one:

```ts
expect(reloaded?.slackPrefix).toBe(false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/config/mappings.test.ts`
Expected: FAIL — `slackPrefix` is `undefined`, not `false`/`true` (property doesn't
exist on `Mapping` yet, so TypeScript itself will also fail to compile the test file).

- [ ] **Step 3: Add the field to the `Mapping` interface**

In `src/config/types.ts`, inside `export interface Mapping { ... }`, add after
`skipPermissions`:

```ts
/** Prepend `[Slack: <sender>]` to every prompt sent to Claude for this mapping. */
slackPrefix: boolean;
```

- [ ] **Step 4: Default it in `validateMapping`**

In `src/config/mappings.ts`, right after the existing `skipPermissions` line:

```ts
const skipPermissions = input.skipPermissions ?? false;
```

add:

```ts
const slackPrefix = input.slackPrefix ?? false;
```

Then add `slackPrefix,` to the object `validateMapping` returns (next to
`skipPermissions,`):

```ts
return {
  identity,
  channel,
  workspace,
  scope,
  trigger,
  model,
  skipPermissions,
  slackPrefix,
  ...(claudeConfigDir ? { claudeConfigDir } : {}),
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/config/mappings.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms every other file constructing/reading a `Mapping`
still compiles — none do yet, since no other file has been touched).

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts src/config/mappings.ts src/config/mappings.test.ts
git commit -m "feat: add slackPrefix field to Mapping"
```

---

### Task 2: Carry the Slack sender id onto `InboundMessage`

**Files:**

- Modify: `src/slack/router.ts` (`InboundMessage` interface)
- Modify: `src/slack/app.ts` (`RawMessage`, `normalizeMessage`)
- Test: `src/slack/app.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `InboundMessage.user?: string` — Task 5 (handler) reads `msg.user` to
  resolve the sender's display name.

- [ ] **Step 1: Write the failing test**

Add to `src/slack/app.test.ts`, inside `describe("normalizeMessage", ...)`:

```ts
it("carries the sender's Slack user id", () => {
  const m = normalizeMessage({ channel: "C1", ts: "1", text: "hi", user: "U555" }, BOT);
  expect(m?.user).toBe("U555");
});

it("omits user when the raw event has none", () => {
  const m = normalizeMessage({ channel: "C1", ts: "1", text: "hi" }, BOT);
  expect(m?.user).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/slack/app.test.ts`
Expected: FAIL — first assertion gets `undefined` instead of `"U555"`.

- [ ] **Step 3: Add `user` to `InboundMessage`**

In `src/slack/router.ts`, inside `export interface InboundMessage extends MessageContext { ... }`, add after `text`:

```ts
  /** Slack user id of the sender (absent for message subtypes without one). */
  user?: string;
```

- [ ] **Step 4: Populate it in `normalizeMessage`**

In `src/slack/app.ts`, `RawMessage` already declares `user?: string;` (used today
only for `bot_id`/loop-safety context — check it's present; it is, at line 57). In
`normalizeMessage`, change the returned object from:

```ts
return {
  channel: raw.channel,
  ts: raw.ts,
  threadTs: raw.thread_ts,
  text,
  mentionsBot: mentionsUser(text, botUserId),
  fromBot: Boolean(raw.bot_id),
  // Omit the key entirely when there are no attachments (keeps plain messages clean).
  ...(files.length > 0 ? { files } : {}),
};
```

to:

```ts
return {
  channel: raw.channel,
  ts: raw.ts,
  threadTs: raw.thread_ts,
  text,
  mentionsBot: mentionsUser(text, botUserId),
  fromBot: Boolean(raw.bot_id),
  // Omit the key entirely when there are no attachments (keeps plain messages clean).
  ...(files.length > 0 ? { files } : {}),
  ...(raw.user ? { user: raw.user } : {}),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/slack/app.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add src/slack/router.ts src/slack/app.ts src/slack/app.test.ts
git commit -m "feat: carry the Slack sender id onto InboundMessage"
```

---

### Task 3: `withSlackPrefix` helper

**Files:**

- Create: `src/slack/slack-prefix.ts`
- Test: `src/slack/slack-prefix.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  `withSlackPrefix(text: string, userId: string | undefined, resolveUser: ((userId: string) => Promise<string>) | undefined): Promise<string>`
  — Task 5 (handler) calls this to build the prefixed prompt.

- [ ] **Step 1: Write the failing tests**

Create `src/slack/slack-prefix.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withSlackPrefix } from "./slack-prefix.js";

describe("withSlackPrefix", () => {
  it("prepends the resolved name when a resolver is provided", async () => {
    const resolveUser = async (id: string) => `name-for-${id}`;
    const result = await withSlackPrefix("deploy failed", "U1", resolveUser);
    expect(result).toBe("[Slack: name-for-U1] deploy failed");
  });

  it("falls back to the raw user id when no resolver is provided", async () => {
    const result = await withSlackPrefix("deploy failed", "U1", undefined);
    expect(result).toBe("[Slack: U1] deploy failed");
  });

  it("falls back to 'unknown' when there is no user id at all", async () => {
    const result = await withSlackPrefix("deploy failed", undefined, undefined);
    expect(result).toBe("[Slack: unknown] deploy failed");
  });

  it("returns the bare tag (no trailing space) when text is empty", async () => {
    const result = await withSlackPrefix("", "U1", undefined);
    expect(result).toBe("[Slack: U1]");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/slack/slack-prefix.test.ts`
Expected: FAIL — module `./slack-prefix.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/slack/slack-prefix.ts`:

```ts
/**
 * Prepend a `[Slack: <sender>]` tag to a prompt, so a workspace's own CLAUDE.md
 * can detect the message came from Slack. The sender is resolved via
 * `resolveUser` when both it and `userId` are present, else the raw Slack user
 * id is used, else "unknown". Fixed format — not user-templatable.
 */
export async function withSlackPrefix(
  text: string,
  userId: string | undefined,
  resolveUser: ((userId: string) => Promise<string>) | undefined,
): Promise<string> {
  const label = userId ? (resolveUser ? await resolveUser(userId) : userId) : "unknown";
  const tag = `[Slack: ${label}]`;
  return text ? `${tag} ${text}` : tag;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/slack/slack-prefix.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/slack/slack-prefix.ts src/slack/slack-prefix.test.ts
git commit -m "feat: add withSlackPrefix helper"
```

---

### Task 4: `UserResolver` (Slack `users.info` lookup + in-memory cache)

**Files:**

- Create: `src/slack/user-lookup.ts`
- Test: `src/slack/user-lookup.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `UserLookupClient` interface (`users.info(args: { user: string }): Promise<{...}>`)
  - `UserResolver` class with `resolve(userId: string): Promise<string>`
  - `createUserResolver(botToken: string, client?: UserLookupClient): UserResolver`
  - Task 6 (bridge wiring) constructs a `UserResolver` via `createUserResolver` and
    calls `.resolve(id)`.

- [ ] **Step 1: Write the failing tests**

Create `src/slack/user-lookup.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { UserResolver, UserLookupClient } from "./user-lookup.js";

function fakeClient(impl: UserLookupClient["users"]["info"]): UserLookupClient {
  return { users: { info: impl } };
}

describe("UserResolver", () => {
  it("prefers profile.display_name", async () => {
    const client = fakeClient(async () => ({
      user: { profile: { display_name: "jane.doe" }, real_name: "Jane Doe", name: "jane" },
    }));
    const resolver = new UserResolver(client);
    expect(await resolver.resolve("U1")).toBe("jane.doe");
  });

  it("falls back to real_name when display_name is blank", async () => {
    const client = fakeClient(async () => ({
      user: { profile: { display_name: "" }, real_name: "Jane Doe", name: "jane" },
    }));
    const resolver = new UserResolver(client);
    expect(await resolver.resolve("U1")).toBe("Jane Doe");
  });

  it("falls back to name, then the raw id, when nothing else is set", async () => {
    const client = fakeClient(async () => ({ user: { name: "jane" } }));
    expect(await new UserResolver(client).resolve("U1")).toBe("jane");

    const emptyClient = fakeClient(async () => ({ user: {} }));
    expect(await new UserResolver(emptyClient).resolve("U1")).toBe("U1");
  });

  it("caches a successful lookup — the client is called only once per user id", async () => {
    const info = vi.fn(async () => ({ user: { profile: { display_name: "jane.doe" } } }));
    const resolver = new UserResolver({ users: { info } });
    await resolver.resolve("U1");
    await resolver.resolve("U1");
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw id on a lookup failure, without caching it", async () => {
    let calls = 0;
    const info = async () => {
      calls += 1;
      throw new Error("rate_limited");
    };
    const resolver = new UserResolver({ users: { info } });
    expect(await resolver.resolve("U1")).toBe("U1");
    expect(await resolver.resolve("U1")).toBe("U1");
    expect(calls).toBe(2); // not cached — retried on the second call
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/slack/user-lookup.test.ts`
Expected: FAIL — module `./user-lookup.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/slack/user-lookup.ts`:

```ts
import { WebClient } from "@slack/web-api";

/** The slice of the Slack Web client user-lookup needs. */
export interface UserLookupClient {
  users: {
    info(args: { user: string }): Promise<{
      user?: { real_name?: string; name?: string; profile?: { display_name?: string } };
    }>;
  };
}

/**
 * Resolves a Slack user id to a human-readable display name, for the
 * `[Slack: <name>]` prefix. Caches successful lookups in memory for the
 * process lifetime (Slack user ids and their display names are effectively
 * static for a running bridge). A lookup that throws (rate limit, missing
 * `users:read` scope, network error) falls back to the raw id and is
 * deliberately NOT cached, so a transient failure self-heals on the next
 * message instead of sticking for the bridge's uptime.
 */
export class UserResolver {
  private readonly cache = new Map<string, string>();

  constructor(private readonly client: UserLookupClient) {}

  async resolve(userId: string): Promise<string> {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    try {
      const res = await this.client.users.info({ user: userId });
      const name =
        res.user?.profile?.display_name?.trim() ||
        res.user?.real_name?.trim() ||
        res.user?.name?.trim() ||
        userId;
      this.cache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }
}

/** Real-world factory: a `UserResolver` backed by the Slack Web API. */
export function createUserResolver(
  botToken: string,
  client: UserLookupClient = new WebClient(botToken),
): UserResolver {
  return new UserResolver(client);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/slack/user-lookup.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/slack/user-lookup.ts src/slack/user-lookup.test.ts
git commit -m "feat: add UserResolver for Slack sender display-name lookup"
```

---

### Task 5: Wire the prefix into `handleInbound`

**Files:**

- Modify: `src/slack/handler.ts`
- Test: `src/slack/handler.test.ts`

**Interfaces:**

- Consumes: `Mapping.slackPrefix` (Task 1), `InboundMessage.user` (Task 2),
  `withSlackPrefix` (Task 3).
- Produces: `HandlerDeps.resolveUser?: (userId: string) => Promise<string>` — Task 6
  (bridge wiring) supplies the real implementation.

- [ ] **Step 1: Write the failing tests**

Add to `src/slack/handler.test.ts`. First, extend the `setup()` helper's mapping
config so tests can turn the flag on per-test — add a `slackPrefix` override:

```ts
function setup(
  over: Partial<{
    scope: "channel" | "thread";
    trigger: "mention" | "auto";
    slackPrefix: boolean;
  }> = {},
) {
  const mappings = MappingStore.load(home);
  mappings.add({
    identity: "auth-investigator",
    channel: "C1",
    workspace: "/repos/auth",
    scope: over.scope ?? "channel",
    trigger: over.trigger ?? "auto",
    slackPrefix: over.slackPrefix ?? false,
  });
  // ...unchanged below this line
```

(Only the `mappings.add({...})` call's `scope`/`trigger` lines and the new
`slackPrefix` line change; everything else in `setup()` stays as-is.)

Then add a new `describe` block:

```ts
describe("Slack sender prefix", () => {
  it("does not prefix the prompt when slackPrefix is disabled", async () => {
    const { deps, invokes } = setup({ trigger: "auto", slackPrefix: false });
    await handleInbound(deps, msg({ text: "deploy failed", user: "U1" }));
    expect(invokes[0]!.prompt).toBe("deploy failed");
  });

  it("prefixes with the raw Slack id when no resolveUser dep is provided", async () => {
    const { deps, invokes } = setup({ trigger: "auto", slackPrefix: true });
    await handleInbound(deps, msg({ text: "deploy failed", user: "U1" }));
    expect(invokes[0]!.prompt).toBe("[Slack: U1] deploy failed");
  });

  it("prefixes with the resolved display name when resolveUser is provided", async () => {
    const { deps, invokes } = setup({ trigger: "auto", slackPrefix: true });
    deps.resolveUser = async (id) => `name-for-${id}`;
    await handleInbound(deps, msg({ text: "deploy failed", user: "U1" }));
    expect(invokes[0]!.prompt).toBe("[Slack: name-for-U1] deploy failed");
  });

  it("prefixes an image-only message with the bare tag before the image note", async () => {
    const { deps, invokes } = setup({ trigger: "auto", slackPrefix: true });
    await handleInbound(deps, msg({ text: "", user: "U1", files: [image()] }));
    expect(invokes[0]!.prompt.startsWith("[Slack: U1]")).toBe(true);
    expect(invokes[0]!.prompt).toContain("diagram.png");
  });

  it("still skips invocation for an unsupported-only upload even with slackPrefix on", async () => {
    const { deps, invokes, posts } = setup({ trigger: "auto", slackPrefix: true });
    await handleInbound(
      deps,
      msg({
        text: "",
        user: "U1",
        files: [image({ id: "P", name: "report.pdf", mimetype: "application/pdf" })],
      }),
    );
    expect(invokes).toHaveLength(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.text).toContain("not supported");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/slack/handler.test.ts`
Expected: FAIL on the 3 prefix-producing tests (prompt has no `[Slack: ...]` tag);
the disabled and unsupported-only tests should already pass since behavior there is
unchanged.

- [ ] **Step 3: Add `resolveUser` to `HandlerDeps`**

In `src/slack/handler.ts`, inside `export interface HandlerDeps { ... }`, add after
the `download` field:

```ts
  /**
   * Resolves a Slack user id to a display name for the `[Slack: <name>]` tag.
   * Absent ⇒ the raw Slack user id is used as-is.
   */
  resolveUser?: (userId: string) => Promise<string>;
```

- [ ] **Step 4: Apply the prefix after the actionable check**

In `src/slack/handler.ts`, `runOneInvocation` currently reads:

```ts
const prompt = buildImagePrompt(decision.prompt ?? "", imagePaths);
// Nothing Claude can act on (e.g. only unsupported files): the notice was
// already posted, so don't create a session or invoke.
if (!prompt.trim() && imagePaths.length === 0) {
  log.info(`no actionable content for session ${key}; not invoking`);
  return;
}
```

Replace it with:

```ts
const rawPrompt = decision.prompt ?? "";
// Nothing Claude can act on (e.g. only unsupported files): the notice was
// already posted, so don't create a session or invoke. Checked on the raw
// prompt, before any Slack-prefix tag, so a bare tag never counts as
// "actionable" on its own.
if (!rawPrompt.trim() && imagePaths.length === 0) {
  log.info(`no actionable content for session ${key}; not invoking`);
  return;
}

const taggedPrompt = mapping.slackPrefix
  ? await withSlackPrefix(rawPrompt, msg.user, deps.resolveUser)
  : rawPrompt;
const prompt = buildImagePrompt(taggedPrompt, imagePaths);
```

Add the import at the top of the file, alongside the existing `./files.js` import:

```ts
import { withSlackPrefix } from "./slack-prefix.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/slack/handler.test.ts`
Expected: PASS (every test in the file, old and new).

- [ ] **Step 6: Typecheck + full test suite**

Run: `npm run typecheck && npm run test`
Expected: no errors; every existing test still passes (confirms nothing else
constructing a `Mapping` fixture broke — `handler.test.ts`'s other `mappings.add`
calls at lines ~160 and ~313 and ~413 don't pass `slackPrefix`, which is fine since
Task 1 defaults it).

- [ ] **Step 7: Commit**

```bash
git add src/slack/handler.ts src/slack/handler.test.ts
git commit -m "feat: apply the Slack sender prefix to prompts when a mapping enables it"
```

---

### Task 6: Wire `UserResolver` into the running bridge

**Files:**

- Modify: `src/bridge.ts`

**Interfaces:**

- Consumes: `createUserResolver` (Task 4), `HandlerDeps.resolveUser` (Task 5).
- Produces: nothing new for later tasks — this is the final wiring point.

- [ ] **Step 1: Import and construct the resolver**

In `src/bridge.ts`, add the import alongside the existing `createFileDownloader`
import:

```ts
import { createUserResolver } from "./slack/user-lookup.js";
```

Right after the existing line:

```ts
const download = createFileDownloader(creds.botToken);
```

add:

```ts
const userResolver = createUserResolver(creds.botToken);
```

- [ ] **Step 2: Pass `resolveUser` into the deps object**

Change:

```ts
const app = createSlackApp(
  creds,
  { mappings, sessions, logger, claudeBin: claudeBin(), serializer, media, download },
  logger,
);
```

to:

```ts
const app = createSlackApp(
  creds,
  {
    mappings,
    sessions,
    logger,
    claudeBin: claudeBin(),
    serializer,
    media,
    download,
    resolveUser: (id) => userResolver.resolve(id),
  },
  logger,
);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS (this file has no dedicated unit tests — `bridge.ts` is thin wiring
exercised end-to-end by `run-bridge`; the check here is that nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add src/bridge.ts
git commit -m "feat: wire the Slack user resolver into the running bridge"
```

---

### Task 7: CLI prompts for `map add` / `map edit` / `map list`

**Files:**

- Modify: `src/cli/index.ts`

**Interfaces:**

- Consumes: `Mapping.slackPrefix` (Task 1).
- Produces: nothing new for later tasks — this is CLI-only, not unit tested (the
  file has no existing test suite; `Prompter`'s own tests already cover `confirm`).

- [ ] **Step 1: Add the prompt to `cmdMapAdd`**

In `src/cli/index.ts`, inside `cmdMapAdd`, right after the existing line:

```ts
const claudeConfigDir = await p.ask("Custom CLAUDE_CONFIG_DIR (blank = bridge default)");
```

add:

```ts
const slackPrefix = await p.confirm(
  'Tag messages to Claude with the Slack sender, e.g. "[Slack: jane.doe] ..."?',
);
```

Then add `slackPrefix,` to the `store.add({...})` call right below it:

```ts
const mapping = store.add({
  identity,
  channel,
  workspace,
  scope,
  trigger,
  model,
  skipPermissions,
  claudeConfigDir,
  slackPrefix,
});
```

And extend the confirmation line so it's visible immediately after adding:

```ts
process.stdout.write(
  `Added mapping [${mapping.identity}] → ${mapping.workspace} ` +
    `(${mapping.scope}/${mapping.trigger}, model=${mapping.model}` +
    `${mapping.skipPermissions ? ", skip-permissions" : ""}` +
    `${mapping.slackPrefix ? ", slack-prefix" : ""}).\n`,
);
```

- [ ] **Step 2: Add the prompt to `cmdMapEdit`**

Right after the existing line:

```ts
const claudeConfigDir = await p.ask(
  "Custom CLAUDE_CONFIG_DIR (blank = bridge default)",
  current.claudeConfigDir,
);
```

add:

```ts
const slackPrefix = await p.confirm(
  'Tag messages to Claude with the Slack sender, e.g. "[Slack: jane.doe] ..."?',
  current.slackPrefix,
);
```

Then add `slackPrefix,` to the `store.edit(identity, {...})` call right below it:

```ts
const updated = store.edit(identity, {
  channel,
  workspace,
  scope,
  trigger,
  model,
  skipPermissions,
  claudeConfigDir,
  slackPrefix,
});
```

- [ ] **Step 3: Show it in `cmdMapList`**

Change:

```ts
process.stdout.write(
  `[${m.identity}]\n` +
    `  channel:     ${m.channel}\n` +
    `  workspace:   ${m.workspace}\n` +
    `  scope:       ${m.scope}\n` +
    `  trigger:     ${m.trigger}\n` +
    `  model:       ${m.model}\n` +
    `  permissions: ${m.skipPermissions ? "skipped (dangerous)" : "enforced"}\n` +
    `  config dir:  ${m.claudeConfigDir ?? "(bridge default)"}\n`,
);
```

to:

```ts
process.stdout.write(
  `[${m.identity}]\n` +
    `  channel:     ${m.channel}\n` +
    `  workspace:   ${m.workspace}\n` +
    `  scope:       ${m.scope}\n` +
    `  trigger:     ${m.trigger}\n` +
    `  model:       ${m.model}\n` +
    `  permissions: ${m.skipPermissions ? "skipped (dangerous)" : "enforced"}\n` +
    `  slack tag:   ${m.slackPrefix ? "enabled" : "disabled"}\n` +
    `  config dir:  ${m.claudeConfigDir ?? "(bridge default)"}\n`,
);
```

- [ ] **Step 4: Typecheck + full test suite**

Run: `npm run typecheck && npm run test`
Expected: no errors; no regressions (this file has no dedicated automated tests, so
this step is verifying nothing else broke).

- [ ] **Step 5: Manual verification**

Run `npm run build && node dist/cli/index.js map list` against a scratch
`SLACK_CLAUDE_HOME` to confirm the new `slack tag:` line renders. (A full interactive
`map add`/`map edit` walk-through with real prompts requires a TTY or piped input —
if you can't drive that interactively, note it explicitly rather than skipping
verification silently.)

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add slack-prefix prompt to map add/edit and map list"
```

---

### Task 8: Slack app manifest scope

**Files:**

- Modify: `docs/slack-app-manifest.yml`

- [ ] **Step 1: Add the `users:read` scope**

In `docs/slack-app-manifest.yml`, change:

```yaml
oauth_config:
  scopes:
    bot:
      - app_mentions:read # receive app-mention events
      - channels:history # read public channel messages
      - channels:read # read public channel metadata
      - groups:history # read private channel messages
      - groups:read # read private channel metadata
      - chat:write # post messages
      - files:read # download image attachments users upload
      - reactions:write # add/remove progress reactions (:eyes: / :white_check_mark:) on triggering messages
```

to:

```yaml
oauth_config:
  scopes:
    bot:
      - app_mentions:read # receive app-mention events
      - channels:history # read public channel messages
      - channels:read # read public channel metadata
      - groups:history # read private channel messages
      - groups:read # read private channel metadata
      - chat:write # post messages
      - files:read # download image attachments users upload
      - reactions:write # add/remove progress reactions (:eyes: / :white_check_mark:) on triggering messages
      - users:read # resolve the sender's display name for the optional Slack-prefix tag
```

- [ ] **Step 2: Verify the YAML is well-formed**

Run: `node -e "console.log(require('yaml').parse(require('fs').readFileSync('docs/slack-app-manifest.yml','utf8')).oauth_config.scopes.bot)"`

If the `yaml` package isn't installed (it likely isn't — this repo doesn't parse its
own manifest), instead just visually confirm the indentation matches the surrounding
list items exactly (2-space list-item indent under `bot:`), since a manifest with bad
YAML fails at Slack's "Create from manifest" step, not in this repo's tooling.

Expected: the new line has the same indentation as `reactions:write` above it.

- [ ] **Step 3: Commit**

```bash
git add docs/slack-app-manifest.yml
git commit -m "docs: add users:read scope for the Slack sender prefix feature"
```

---

### Task 9: Reference templates + final verification

**Files:**

- Create: `docs/templates/slack.md`
- Create: `docs/templates/claude-md-slack-snippet.md`

- [ ] **Step 1: Write `docs/templates/slack.md`**

Create `docs/templates/slack.md`:

```markdown
# Slack reply rules

Copy this file into your mapped workspace repo (e.g. as `slack.md` at the repo
root) if you enable the bridge's Slack-sender-prefix option. It's referenced from
`CLAUDE.md` — see `claude-md-slack-snippet.md` in this same directory for the
snippet to add there.

When a message came from Slack (see the CLAUDE.md snippet for how to detect this),
reply differently than you would for a normal terminal session:

- **Be concise.** Slack messages are read on a phone as often as a desktop. Lead
  with the answer; put supporting detail after.
- **Use Slack `mrkdwn`, not GitHub-flavored markdown:**
  - Bold: `*bold*` (single asterisks, not double).
  - Italic: `_italic_`.
  - Inline code: `` `code` ``.
  - Links: `<https://example.com|link text>`, not `[link text](https://example.com)`.
- **Avoid tables and headers.** Slack doesn't render markdown tables or `#`
  headers — they show up as literal punctuation. Use short bullet lists instead.
- **Keep code blocks short.** Paste only the relevant few lines inside a fenced
  code block; for anything longer, summarize the change and offer to paste more on
  request rather than dumping a full file.
- **No nested/deeply indented lists.** Slack's rendering of nested bullets is
  unreliable — prefer a flat list, or short prose.
```

- [ ] **Step 2: Write `docs/templates/claude-md-slack-snippet.md`**

Create `docs/templates/claude-md-slack-snippet.md`:

```markdown
# CLAUDE.md snippet: detecting Slack-originated messages

This is **not** a drop-in `CLAUDE.md` file — it's a section to merge into the
`CLAUDE.md` already at the root of your mapped workspace repo. It pairs with
`slack.md` in this same directory (copy that one in as-is) and with the bridge's
per-mapping "Tag messages to Claude with the Slack sender" option
(`slack-claude map add` / `map edit`).

Add a section like this to your workspace's `CLAUDE.md`:

    ## Messages from Slack

    If an inbound user message starts with a `[Slack: <name>]` tag, it arrived
    through the Slack-Claude bridge, not a local terminal session. Load `slack.md`
    at the repo root and follow its reply rules for this response — Slack
    `mrkdwn` formatting, concise replies, no tables/headers.

    The `[Slack: <name>]` tag itself is metadata, not part of the user's actual
    request — don't quote it back or comment on it in your reply.

The tag only appears when the mapping routing this channel/thread has the
Slack-sender-prefix option enabled; workspaces mapped without it never see the tag,
so this section is a no-op for them.
```

- [ ] **Step 3: Full verification pass**

Run: `npm run verify`
Expected: typecheck, lint, and the full test suite all pass.

- [ ] **Step 4: Commit**

```bash
git add docs/templates/slack.md docs/templates/claude-md-slack-snippet.md
git commit -m "docs: add slack.md and CLAUDE.md-snippet reference templates"
```

---

## Final checklist (re-verify after Task 9)

- [ ] `npm run verify` passes (typecheck + lint + full test suite).
- [ ] `npm run test -- src/config/mappings.test.ts src/slack/app.test.ts src/slack/slack-prefix.test.ts src/slack/user-lookup.test.ts src/slack/handler.test.ts` all green.
- [ ] `docs/slack-app-manifest.yml` has `users:read` alongside the existing scopes.
- [ ] `docs/templates/slack.md` and `docs/templates/claude-md-slack-snippet.md` exist and cross-reference each other and the bridge's CLI option correctly.
- [ ] `slack-claude map list` output includes a `slack tag:` line for every mapping.
