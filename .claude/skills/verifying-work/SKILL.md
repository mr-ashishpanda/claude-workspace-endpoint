---
name: verifying-work
description: The required verification discipline for the Slack-Claude Bridge — run, test, and observe a change end-to-end before marking it done; if no test/integration path exists, build it autonomously or ask for the human-only inputs needed. Use before claiming any feature or fix is complete, fixed, or passing.
---

# Verifying your work

A change is **not done until you have run, tested, and verified it end-to-end.** Mandatory, not
aspirational. Report evidence (command output, log lines), never bare assertions.

## The loop — close it before reporting complete

1. **Build / type-check** — `npm run verify` passes (or the relevant subset: `npm run typecheck`,
   `npm run lint`, `npm run test`).
2. **Run it** — start the bridge and confirm it boots without throwing. See the **`run-bridge`**
   skill for how to start it and tail `logs/bridge.log`.
3. **Observe output** — confirm the expected events in the log: Slack connection, event received,
   workspace routed, Claude invoked, response posted — each prefixed with the mapping identity.
4. **Integration** — exercise the path end-to-end where feasible (a test, a mock Slack event, or a
   real message in a dev channel) and confirm the response lands in the correct location
   (channel vs thread, per session scope).
5. **Report evidence** — quote the output / log lines that prove it.

Aligns with the `superpowers:verification-before-completion` discipline.

## No untested "done" — build the verification path if it is missing

If there is **no complete way to exercise the change** — no test, no runnable entry point, no mock
event, no way to observe the result — then **creating that path is part of the task**:

1. **Build the missing tooling autonomously.** Add the unit/integration test, a fixture or mock
   Slack event, a local harness/script, a fake workspace, a log assertion — whatever lets the
   behavior be exercised and observed without manual guesswork. This is expected work, not a
   follow-up.
2. **Escalate only what genuinely needs a human.** If verification truly requires something you
   cannot create or obtain — real Slack credentials, a workspace/channel only the user controls, a
   paid resource, an external approval — **stop and ask the user for that specific input or help.**
   Be precise about what you need and why.
3. **Never mark done on assumption.** If a step still cannot be verified after building tooling and
   asking, say exactly which step is unverified and why — never imply success.

Default posture: _if it can be automated, automate it and verify; if it needs a human, ask._
"There was no way to test it" is not an acceptable reason to skip verification — making a way to
test it is the job.
