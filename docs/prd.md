# Product Requirements Document (PRD)

## Product Name

Slack-Claude Bridge

## Objective

Build a local agent that integrates Slack with Claude Code, allowing Claude Code to participate in Slack conversations while operating within configured local workspaces.

The product must allow Slack channels to be mapped to local working directories containing source code, documentation, scripts, and a `CLAUDE.md` file. Claude Code will be invoked within the mapped workspace and respond back to Slack according to the configured behavior.

This is a local-first product. No server-side components, coordinators, relays, cloud services, or hosted control planes are part of V1.

---

# Scope

## In Scope

- Single Slack App
- Single local agent process
- Multiple channel mappings
- Multiple workspace mappings
- Public Slack channels
- Private Slack channels
- Claude Code integration
- Channel-scoped sessions
- Thread-scoped sessions
- Mention-triggered execution
- Auto-triggered execution
- Persistent session management
- CLI-based configuration
- Claude identity per mapping
- Slack status command

## Out of Scope

- Multiple agent coordination
- Multi-machine deployments
- Event relays
- Hosted services
- Centralized control plane
- Repository auto-discovery
- Vector databases
- Memory compression
- Multiple Claude personas
- Human approval workflows
- Load balancing
- Agent orchestration
- Session summarization
- Session reset commands
- Session termination commands
- Any Slack commands other than `@claude status`

---

# Architecture

```text
Slack Workspace
       │
       ▼
Single Slack App
       │
       ▼
Single Local Agent
       │
       ├── Mapping A
       ├── Mapping B
       ├── Mapping C
       └── Claude Code
```

The local agent owns:

- Slack event processing
- Session management
- Workspace routing
- Claude invocation
- Slack response publishing

---

# Workspace Requirements

Each mapping points to a local workspace directory.

Example:

```text
/repos/auth-service
```

Expected contents:

```text
CLAUDE.md
README.md
docs/
scripts/
source code
```

The agent must invoke Claude Code from within the mapped workspace.

Example:

```bash
cd /repos/auth-service
claude
```

No additional indexing, memory systems, or repository ingestion are required.

---

# Mapping Definition

A mapping consists of:

- Claude Identity
- Slack Channel
- Workspace Directory
- Session Scope
- Trigger Mode

Example:

```yaml
identity: auth-investigator

channel: inc-auth-outage

workspace: /repos/auth-service

scope: channel

trigger: auto
```

---

# Claude Identity

Every mapping must have a unique identity.

Examples:

- auth-investigator
- platform-reviewer
- backend-assistant

The identity must be included in:

- Slack responses
- Logs
- Status output

Example:

```text
[auth-investigator]

Current hypothesis:
Database connection pool exhaustion.
```

---

# Session Scope

## Channel Scope

Session Key:

```text
channel_id
```

Behavior:

- One Claude session per Slack channel
- First triggering message creates session
- All subsequent messages reuse session
- Claude responses are posted directly to the channel
- Responses are not posted as thread replies

Use Cases:

- Incidents
- War rooms
- Release channels
- Migration channels

---

## Thread Scope

Session Key:

```text
channel_id + thread_ts
```

Behavior:

- One Claude session per Slack thread
- First triggering message creates session
- All subsequent thread messages reuse session
- Claude responses are posted into the same Slack thread

Use Cases:

- Engineering discussions
- Troubleshooting
- Design reviews
- Code reviews

---

# Trigger Modes

## Mention Trigger

Claude is invoked only when explicitly mentioned.

Example:

```text
@claude investigate this issue
```

Messages without a Claude mention must be ignored.

---

## Auto Trigger

Claude is invoked automatically for every message received within the configured scope.

Examples:

- Every channel message
- Every thread reply

depending on session scope.

---

# Supported Configuration Matrix

| Session Scope | Trigger Mode |
| ------------- | ------------ |
| Thread        | Mention      |
| Thread        | Auto         |
| Channel       | Mention      |
| Channel       | Auto         |

All four combinations must be supported.

---

# Session Persistence

Sessions must persist across messages.

The implementation must maintain session state and reuse existing Claude sessions according to the configured scope.

Session data should survive agent restarts where technically feasible.

Local persistence is acceptable.

---

# Slack Commands

## Supported Commands

### @claude status

Returns:

- Claude Identity
- Workspace Directory
- Session Scope
- Trigger Mode
- Session Identifier
- Messages Processed
- Session Creation Timestamp

Example:

```text
Identity: auth-investigator

Workspace:
/repos/auth-service

Session Scope:
Channel

Trigger Mode:
Auto

Session ID:
sess_12345

Messages Processed:
42

Started:
2026-06-29 14:10 UTC
```

No other Slack commands are required in V1.

---

# CLI Requirements

## Initialize Agent

```bash
slack-claude init
```

Configure:

- Slack credentials
- Local storage location

---

## Add Mapping

```bash
slack-claude map add
```

Interactive prompts:

- Identity
- Slack Channel
- Workspace Directory
- Session Scope
- Trigger Mode

---

## List Mappings

```bash
slack-claude map list
```

Display all configured mappings.

---

## Edit Mapping

```bash
slack-claude map edit <identity>
```

---

## Remove Mapping

```bash
slack-claude map remove <identity>
```

---

# Slack Permissions

The Slack App must support:

- Public channels
- Private channels
- Message reading
- Message posting
- App mentions

Required capabilities include:

- Read channel history
- Read private channel history
- Read channel metadata
- Post messages
- Receive app mention events

---

# Expected User Workflow

1. Install Slack App into workspace.
2. Install local Slack-Claude agent.
3. Run `slack-claude init`.
4. Create one or more mappings.
5. Start agent.
6. Agent listens for Slack events.
7. Matching events are routed to the configured workspace.
8. Claude Code executes within that workspace.
9. Claude response is published back to Slack according to configured session scope.

---

# Definition of Done

The product is considered complete when:

1. A user can install the Slack App.
2. A user can install the local agent.
3. A user can create multiple channel-to-workspace mappings.
4. Claude Code is invoked within the mapped workspace.
5. Public and private Slack channels are supported.
6. Thread and channel session scopes work correctly.
7. Mention and auto trigger modes work correctly.
8. Claude responses are published to the correct Slack location.
9. Session state is maintained and reused.
10. `@claude status` returns accurate runtime information.
11. No server-side components are required.
12. The system operates entirely through a single local agent process.
