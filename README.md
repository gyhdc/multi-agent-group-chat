# Multi-Agent Group Chat

Local-first group chat discussion app for multiple AI roles.

## What It Does

- Keeps the transcript as the primary focus, with the configuration studio hideable on the right
- Lets you define multiple roles with explicit persona, goal, strategy, and speaking style
- Saves provider setups as reusable presets so you do not need to re-enter the same API or agent config for every role
- Supports live user intervention during a discussion so you can inject evidence, data, or new constraints mid-stream
- Uses a recorder role to produce checkpoint notes, saved insights, and a final conclusion

## Current Version Scope

- React frontend
- Express backend
- Local JSON persistence
- Mock provider for offline demo
- OpenAI-compatible API support
- Custom HTTP provider adapter
- Local Codex CLI provider support
- Provider preset management
- Saved insight cards with expand/collapse

## Project Layout

- `docs/design.md`: design document
- `docs/provider-contract.md`: custom HTTP agent bridge contract
- `backend/`: orchestration server
- `frontend/`: local web app
- `data/`: JSON storage
- `tests/smoke_test.py`: local smoke test
- `output/smoke-test.png`: verification screenshot output

## Commands

Install dependencies:

- `D:\nodejs\npm.cmd install`

One-click startup on Windows:

- Double-click `start-local-chat.bat`
- Or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-chat.ps1`

One-click stop on Windows:

- Double-click `stop-local-chat.bat`
- Or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local-chat.ps1`

Start frontend + backend together:

- `D:\nodejs\npm.cmd run dev`

Build both sides:

- `D:\nodejs\npm.cmd run build`

Run smoke test:

- `D:\nodejs\npm.cmd run smoke`

## Supported Providers

- `mock`: offline local demo mode
- `openai-compatible`: any `/v1/chat/completions` style endpoint
- `custom-http`: local bridge to your own agent service
- `codex-cli`: launches local Codex through `codex exec`

## Product Notes

- Click `Show Config` / `Hide Config` to collapse the right-side studio and keep the chat transcript centered
- In `Roles`, assign a `Preset` to reuse a saved provider setup instantly
- In `Provider Presets`, duplicate a built-in preset before editing it
- In the chat area, use `Send to Discussion` to inject your own evidence or constraints; subsequent agent turns will see that message
- Use the `Save` chip on checkpoint or final notes to pin important insights
- For Windows Codex setup, if `codex` cannot execute directly, set `Command = npx` and `Launcher Args = -y @openai/codex`

## Local Git Workflow

- This project is intended to live in its own local Git repository rooted at `multi-agent-group-chat`
- Runtime data in `data/*.json` is intentionally excluded from version control
- Use `main` as the stable branch and create new work on `feature/<short-name>`
- Before a larger feature, create a local tag like `pre-<feature-name>-YYYYMMDD` so rollback is one command away
- See `docs/versioning.md` for the local branching and rollback convention

## Local Verification Result

- Build passed for backend and frontend
- Smoke test completed with transcript generation, one user intervention, and final recorder conclusion
- Screenshot output saved to `output/smoke-test.png`
