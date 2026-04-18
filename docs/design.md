# Multi-Agent Group Chat Design

## 1. Goal

Build a local-first web app that feels like a QQ/WeChat group chat, but each participant can be:

- a configurable role backed by a remote LLM API
- a configurable role backed by a local model endpoint
- a special recorder role that summarizes the discussion

The user provides a topic, requirement, project idea, or debate target. The system then orchestrates multiple roles so they speak in short turns like a normal group discussion instead of producing long essays.

## 2. Core Scenarios

### Scenario A: Reviewer vs. Advisor

- Role 1: Reviewer
- Role 2: Advisor
- Recorder: Secretary
- Topic: a research idea or proposal
- Reviewer attacks weaknesses
- Advisor defends and improves the idea
- Recorder extracts key disagreements, revisions, and conclusion

### Scenario B: Open Role Sandbox

- User freely defines multiple roles
- Each role has:
  - display name
  - avatar color
  - system persona
  - behavior rules
  - speaking style constraints
  - provider connection
- Recorder remains optional but recommended

## 3. Product Principles

- Local-first: runs on localhost only
- Human-like chat rhythm: each turn should be short, direct, and conversational
- Configurable roles: user owns persona and constraints
- Provider-agnostic: OpenAI-compatible API and local HTTP endpoints first
- Transparent orchestration: discussion plan and summary are visible
- No forced cloud dependency: remote API is optional

## 4. Architecture

## 4.1 High-Level Structure

- `frontend/`: React + TypeScript + Vite UI
- `backend/`: Node + Express orchestration server
- `data/`: local JSON persistence for rooms, templates, and sessions

## 4.2 Why Frontend + Backend

Frontend-only would expose API keys in the browser and make provider adaptation fragile.
Local backend solves:

- secret storage on local machine only
- unified provider abstraction
- deterministic turn orchestration
- summary generation and discussion state persistence

## 5. Main Modules

## 5.1 Role Management

Each role contains:

- `id`
- `name`
- `kind`: `participant` or `recorder`
- `persona`
- `principles`
- `voiceStyle`
- `goal`
- `provider`
- `model`
- `endpoint`
- `apiKey`
- `temperature`
- `maxTokens`
- `enabled`
- `accentColor`

## 5.2 Discussion Room

Each room contains:

- `id`
- `title`
- `topic`
- `objective`
- `turnsPerRound`
- `maxRounds`
- `roles`
- `messages`
- `status`
- `summary`

## 5.3 Orchestrator

Responsibilities:

- generate speaking order
- build role-specific prompts from room state
- keep each turn concise
- stop on convergence, round limit, or manual stop
- trigger recorder at checkpoint or final round

## 5.4 Provider Adapter Layer

First implementation supports:

- `mock`: local deterministic simulation for offline demo
- `openai-compatible`: standard `POST /v1/chat/completions`
- `custom-http`: user-defined JSON endpoint contract for local agent bridge

Later extension points:

- Ollama native adapter
- LM Studio adapter
- vLLM / FastChat adapter
- local CLI agent bridge

## 5.5 Recorder

Recorder is a special role with different prompt policy:

- never debates
- reads all discussion turns
- extracts points, disagreements, action items, tentative conclusion
- can produce:
  - running notes
  - final meeting minutes

## 6. Turn Orchestration

## 6.1 Prompt Strategy

For each speaking role, send:

- fixed role persona
- role goal
- role behavior rules
- current topic
- recent chat history window
- latest recorder notes
- hard instruction:
  - speak as if in a real group chat
  - one short message
  - no markdown lists unless necessary
  - do not repeat previous points
  - directly respond to the current thread

## 6.2 Speaking Loop

1. User creates room and roles
2. User starts discussion
3. Backend iterates enabled participant roles in order
4. Each role emits a short chat message
5. After one round:
   - recorder may emit checkpoint notes
   - orchestrator evaluates whether to continue
6. Final recorder summary is generated

## 6.3 Stop Conditions

- reached max rounds
- user clicked stop
- recorder judges consensus reached
- orchestrator detects repeated arguments for N turns

## 7. Minimal Viable Feature Set

Phase 1:

- create/edit/delete roles
- create room with topic and goal
- start discussion
- short-turn multi-role chat simulation
- recorder notes panel
- local JSON persistence
- mock provider for immediate demo
- OpenAI-compatible provider support

Phase 2:

- custom local endpoint adapter
- templates for common scenarios
- pause / resume discussion
- export transcript and summary

Phase 3:

- branch discussions
- recorder checkpoints by interval
- side-by-side prompt debugging

## 8. API Design

### `GET /api/health`

Returns server health.

### `GET /api/rooms`

List saved rooms.

### `POST /api/rooms`

Create a room.

### `PUT /api/rooms/:roomId`

Update room metadata and roles.

### `POST /api/rooms/:roomId/start`

Start a fresh discussion run.

### `POST /api/rooms/:roomId/step`

Advance one role turn or one round.

### `POST /api/rooms/:roomId/stop`

Stop current discussion.

### `GET /api/rooms/:roomId`

Fetch full room state.

## 9. Frontend Views

## 9.1 Sidebar

- room list
- new room button
- built-in templates

## 9.2 Role Studio

- role cards
- persona editor
- provider config
- recorder toggle

## 9.3 Chat Stage

- group chat message stream
- status badge for active speaker
- start / step / stop controls
- topic and objective header

## 9.4 Recorder Panel

- live notes
- final conclusion
- export button

## 10. Persistence

Persist in local JSON files:

- `data/rooms.json`
- `data/settings.json`

Reason:

- simplest reliable local-first option
- easy to inspect manually
- enough for single-user desktop workflow

## 11. Risks

- Different providers have inconsistent JSON formats
- Browser-like streaming adds complexity; initial version should use request/response
- Purely remote APIs may still hit CORS if used directly in browser, so backend proxy remains required
- Long debates can drift; the orchestrator must cap context and enforce brevity

## 12. Implementation Decision

This first version will implement:

- React frontend
- Express backend
- local JSON persistence
- mock provider
- OpenAI-compatible provider
- custom HTTP provider
- recorder role
- step and auto-run modes

This is enough to validate the product shape and support later integration with local agents.
