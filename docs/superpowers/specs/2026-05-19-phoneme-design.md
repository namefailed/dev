# Phoneme — Voice Notes Desktop App

**Status:** Design approved
**Date:** 2026-05-19
**Target:** v1.0 (Windows-only); cross-platform deferred to future release
**Author:** Matt Grey

---

## Overview

A Windows desktop app for local-first voice notes. Press a hotkey, speak, release. Audio is captured locally, transcribed by a local LLM (Gemma 4 E4B via llama-server's OpenAI-compatible API), and emitted as JSON to a user-owned hook script. Recordings can be browsed, played, edited, and re-transcribed through a Tauri GUI; a CLI mirrors every operation for scripting and external hotkey daemon integration (Kanata, AHK, WHKD).

**Core principle:** The app does not touch your journal. It transcribes. You decide where transcripts go via the hook script.

---

## Goals

1. **Local-first, private-by-default.** No telemetry, no cloud sync, no update pings. All audio and transcripts stay on the user's machine.
2. **Reliable capture under pressure.** A misfired hotkey or a downed llama-server must never lose audio. The queue + crash-recovery semantics are load-bearing.
3. **Hooks as the universal output.** Phoneme commits to one output mechanism: JSON on stdin to a user-owned subprocess. This is the seam that keeps the app agnostic to where transcripts go.
4. **Three install modes for three audiences.** "I run my own llama-server" / "I have my own model file" / "Download a model for me" — all three accessible via a runtime mode switch, not a build-time configuration.
5. **CLI is a peer, not a fallback.** Every action available in the GUI is available from the CLI. The CLI is what makes external hotkey daemons work.
6. **Designed cross-platform from day one; v1 ships Windows.** Code is platform-agnostic behind small abstractions (IPC transport, default hook shell). macOS and Linux builds are future work, not a rewrite.

## Non-goals (v1.0)

- Cloud sync, accounts, telemetry, auto-update
- Multi-language voice command parsing (a hook can do this)
- Streaming transcription (display partial transcript while speaking)
- Speaker diarization
- Word-level timestamps
- Audio editing (trim, denoise)
- macOS and Linux installers (designed for, but deferred)
- Encrypted-at-rest WAVs
- Bundling a model file in the installer (kept under ~120 MB)

---

## Architecture overview

Three binaries, three shared libraries, one IPC schema crate. Process topology at runtime:

```
                      ┌─────────────────────┐
                      │   phoneme-daemon    │ ◀── owns: audio capture, inbox queue,
                      │   (singleton)       │     SQLite catalog, llama-server lifecycle,
                      └─────────▲───────────┘     hook execution
                                │ named pipe
                                │ \\.\pipe\phoneme-daemon
            ┌───────────────────┼────────────────────┐
            │                   │                    │
  ┌─────────▼────────┐  ┌───────▼─────────┐  ┌──────▼─────────┐
  │ phoneme.exe      │  │ phoneme-tray    │  │ external       │
  │ (CLI, IPC client)│  │ (Tauri GUI)     │  │ (Kanata/AHK/   │
  └──────────────────┘  └─────────────────┘  │  WHKD invoking │
                                              │  phoneme.exe)  │
                                              └────────────────┘

  ┌──────────────────────┐
  │ llama-server.exe     │ ◀── spawned by daemon in modes 2 & 3
  │ (modes 2 & 3 only)   │     external to phoneme in mode 1
  └──────────────────────┘
```

**Cargo workspace:**

```
phoneme/
├── Cargo.toml                              # workspace
├── crates/
│   ├── phoneme-core/                       # library: config, types, queue, transcription, hooks, catalog
│   ├── phoneme-audio/                      # library: CPAL capture + WAV encoding
│   └── phoneme-ipc/                        # library: IPC message types + transport (named pipe)
├── bin/
│   ├── phoneme/                            # CLI binary (thin IPC client)
│   └── phoneme-daemon/                     # headless daemon
├── src-tauri/                              # Tauri desktop app (frontend in TS + Rust backend bridge)
├── frontend/                               # Vite + vanilla TypeScript
├── hooks/                                  # reference hook scripts shipped with installer
├── installer/                              # Wix MSI configuration
└── .github/workflows/                      # CI
```

**Invariants:**

- **Daemon is a singleton.** Enforced by named-pipe ownership plus a PID lockfile at `%LOCALAPPDATA%\phoneme\.lock`. A second daemon attempting startup checks both: if the lockfile's PID is alive and owns the pipe, exit cleanly with a "pipe_in_use" message. If the PID is dead, treat the lockfile as stale and proceed.
- **All state mutations flow through the daemon.** The CLI and the tray never write to the catalog directly. Pure read commands (`phoneme list`, `phoneme show`) may open the SQLite file in read-only WAL mode and skip auto-spawning the daemon — this lets scripts and cron jobs run without waking it up.
- **The daemon exposes a single IPC surface.** Both clients (CLI, tray) use the same `phoneme-ipc` schema. No backdoor APIs.

---

## Daemon internals

The daemon is the brain. It runs five long-running concerns on a single Tokio runtime; cross-concern communication is via `tokio::sync::broadcast` (for events) and `tokio::sync::mpsc` (for command/control).

### Internal modules

| Module | Responsibility |
|---|---|
| `ipc_server` | Listens on `\\.\pipe\phoneme-daemon`. One pipe instance per concurrent client. Routes requests to the right module; emits events on the event bus. |
| `recorder` | Holds at most one `ActiveRecording` (CPAL stream + ring buffer + WAV encoder). Exposes `start()`, `stop()`, `cancel()`. Rejects `start()` when already recording. |
| `queue_worker` | Watches `inbox/pending/` (notify crate + startup scan). FIFO loop: pull oldest → atomic-rename to `processing/` → call `transcriber` → atomic-rename to `done/` or `failed/`. |
| `transcriber` | HTTP client to llama-server's `/v1/audio/transcriptions`. Streams WAV as `multipart/form-data`. 60s configurable timeout. Returns `Result<String, TranscribeError>`. |
| `hook_runner` | Spawns the configured hook subprocess, pipes JSON to stdin, captures stderr to log, kills on `hook_timeout_secs`. Records exit code in catalog. |
| `llm_supervisor` | In modes 2 & 3: spawns `llama-server.exe` as child with `--model {path}`. Health-checks every 10s. Restarts on crash with exponential backoff (30s → 5min cap). Kills cleanly on daemon shutdown. |
| `catalog` | Wraps `sqlx::SqlitePool` in WAL mode. All mutations atomic; queries from tray and `phoneme list` go through here. |
| `event_bus` | `broadcast::channel<DaemonEvent>` of capacity 64. Tray subscribes for live UI; CLI's `watch` command subscribes for streaming output. |

### Recording state machine

```
  [start request] ──▶ Active(id, started_at)
                       │  (atomic insert: catalog row {id, started_at, status=recording})
                       │
                       │ stop / silence / max_duration
                       ▼
                  WAV encoded to {audio_dir}/{YYYY-MM-DD}/{HHmmssMMM}.wav
                       │  (catalog UPDATE: duration_ms, audio_path, status=transcribing)
                       │
                       ▼              (atomic create)
                  inbox/pending/{id}.json
                       │              (atomic rename, picked by queue_worker)
                       ▼
                  inbox/processing/{id}.json
                       │
              ┌────────┴────────┐
              ▼                 ▼
        transcribe OK     transcribe FAIL
              │                 │  catalog status=transcribe_failed
              │                 │  retry: 30s→60s→2min→5min cap
              │                 ▼
              │           inbox/failed/{id}.json
              ▼
        catalog: transcript, status=hook_running
              │
              ▼
        hook_runner spawns
              │
       ┌──────┴──────┐
       ▼             ▼
   exit 0       exit !=0 / timeout
       │             │
       ▼             ▼
   catalog       catalog status=hook_failed
   status=done   (transcript preserved; "Re-fire hook" available)
       │             │
       └─────┬───────┘
             ▼
       inbox/done/{id}.json
```

### Startup reconciliation

On daemon start:

1. Read the lockfile at `%LOCALAPPDATA%\phoneme\.lock`. If present and the PID inside is alive and owns the pipe, exit with `pipe_in_use`. If the PID is dead, delete the stale lockfile.
2. Acquire the named pipe; if acquisition fails, exit with `pipe_in_use`.
3. Write own PID to the lockfile.
4. Open catalog DB (create schema if missing; run migrations to current version).
5. Scan `inbox/processing/` — any files imply a previous crash mid-transcription. Move them back to `inbox/pending/` and mark the matching catalog rows as `transcribing`.
6. Scan `inbox/pending/` — pre-fill the queue worker's queue, ordered oldest-first.
7. Reconcile catalog vs disk: any catalog row in non-terminal status (`transcribing`, `hook_running`) with no matching inbox file → mark as `failed`. Any WAV on disk with no catalog row → log warning, surface in Doctor as "orphaned WAV count: N" with link to `phoneme doctor --rebuild-catalog`.
8. If `llm.mode != "external"`, start `llm_supervisor` (spawns `llama-server.exe`).
9. Open IPC pipe for connections; daemon is ready.

### Shutdown

On SIGINT, IPC `shutdown` command, or tray Quit:

1. Stop accepting new IPC commands (pipe stays open; commands return `shutting_down` error).
2. If `recorder` is active, finalize the current recording — do not lose audio.
3. Drain in-flight transcription (let the active one complete; do not start the next).
4. Send SIGTERM to `llama-server` child (modes 2/3); wait 5s, then SIGKILL.
5. Close catalog (commits WAL).
6. Release pipe; delete lockfile.
7. Exit with code 0.

### Concurrency policy

- **Active recording:** at most one at a time. Second `record_start` request returns `AlreadyRecording`.
- **Transcription:** serial (one at a time, FIFO). Reasoning: a single llama-server instance is GPU- or CPU-bound; parallelism just thrashes the same bottleneck.
- **Hooks:** serial (one at a time). Reasoning: avoid hooks racing to write the same destination file.
- **LLM unreachable:** recordings pile up in `inbox/pending/`. Daemon retries with exponential backoff (30s, 60s, 2min, 5min cap). Tray icon goes amber with badge "N pending".

---

## CLI commands and IPC protocol

### CLI surface

| Command | Behavior |
|---|---|
| `phoneme record` | Push-to-talk: opens pipe, sends `start`, reads stdin until EOF or Enter, sends `stop`. |
| `phoneme record --oneshot` | Start recording; daemon stops on silence or `max_duration`. Blocks until transcription completes, prints transcript to stdout. |
| `phoneme record --duration <secs>` | Record exactly N seconds. Blocks like `--oneshot`. |
| `phoneme record --start` | Non-blocking: send `start`, exit 0. Used by Kanata/AHK on key-down. |
| `phoneme record --stop` | Non-blocking: send `stop`, exit 0. Used by Kanata/AHK on key-up. |
| `phoneme record --cancel` | Discard the active recording without saving. |
| `phoneme list [--limit N] [--since DATE] [--status STATUS] [--json]` | Query catalog. Pretty table by default; JSON-lines with `--json`. |
| `phoneme show <id> [--json] [--audio-path-only]` | Print one recording's details. `--audio-path-only` for shell piping. |
| `phoneme replay <id>` | Re-transcribe from saved WAV (re-queue into inbox/pending). |
| `phoneme delete <id> [--keep-audio]` | Remove from catalog and inbox. Deletes WAV unless `--keep-audio`. |
| `phoneme doctor` | Full health check; prints green/red checklist; exit 0 if all green. |
| `phoneme doctor --rebuild-catalog` | Walk audio_dir + inbox; rebuild SQLite catalog from disk. |
| `phoneme config` | Print resolved config (TOML format). |
| `phoneme config set <key> <value>` | Update one key; writes config.toml. |
| `phoneme config path` | Print config file path. |
| `phoneme daemon` | Run the daemon in the foreground (for development). |
| `phoneme daemon --start` | Spawn daemon detached. |
| `phoneme daemon --stop` | Send shutdown IPC. |
| `phoneme daemon --status` | Print daemon state (running, pid, uptime, queue depth). |
| `phoneme watch` | Subscribe to event stream; print events as JSON lines. |
| `phoneme hook test` | Run the configured hook with a sample JSON payload. |
| `phoneme version` | Print version + commit hash. |

### Auto-spawn

Commands that need the daemon:

1. Try to connect to `\\.\pipe\phoneme-daemon`.
2. If the pipe is absent or refuses, spawn `phoneme-daemon.exe` detached (`Command::spawn` with `CREATE_NEW_PROCESS_GROUP`).
3. Poll the pipe up to 3 seconds for it to come up.
4. If still not up after 3s, exit with `daemon_not_reachable` and point at the log path.

Pure-read commands (`list`, `show` against existing catalog with no in-flight mutations) skip auto-spawn and open the SQLite file directly in read-only WAL mode.

### IPC protocol

Newline-delimited JSON over the named pipe. Each connection is a single request/response, except `SubscribeEvents` which is a streaming response.

**Request types** (defined in `phoneme-ipc::Request`):

```rust
pub enum Request {
  // Recording control
  RecordStart { mode: RecordMode },              // hold | oneshot | duration(secs)
  RecordStop,
  RecordCancel,
  RecordStatus,                                  // is there an active recording?

  // Catalog queries
  ListRecordings { filter: ListFilter },
  GetRecording { id: String },
  DeleteRecording { id: String, keep_audio: bool },

  // Queue operations
  ReplayRecording { id: String },
  RefireHook { id: String },
  UpdateTranscript { id: String, text: String },

  // Daemon control
  DaemonStatus,
  Shutdown,
  ReloadConfig,                                  // not v1; reserved
  HookTest,

  // Streaming
  SubscribeEvents,                               // response is one DaemonEvent JSON per line
}
```

**Response shape:**

```rust
pub enum Response {
  Ok(serde_json::Value),
  Err { kind: ErrorKind, message: String },
}

pub enum ErrorKind {
  AlreadyRecording, NotRecording, NotFound, InvalidConfig,
  LlmUnreachable, LlmTimeout, HookFailed, DaemonNotRunning,
  PipeInUse, ShuttingDown, Io, Internal,
}
```

**Streaming events** (for `SubscribeEvents`):

```rust
pub enum DaemonEvent {
  RecordingStarted { id, started_at },
  RecordingStopped { id, duration_ms, audio_path },
  TranscriptionStarted { id },
  TranscriptionDone { id, transcript },
  TranscriptionFailed { id, error },
  HookStarted { id },
  HookDone { id, exit_code },
  HookFailed { id, error },
  QueueDepthChanged { pending, processing, failed },
  LlmStatusChanged { reachable: bool },
  RecordingDeleted { id },
  TranscriptUpdated { id },
}
```

### CLI exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure (stderr describes) |
| 2 | Usage error (invalid args) |
| 3 | Daemon not reachable |
| 4 | LLM unreachable / timeout |
| 5 | Hook failed |
| 6 | Invalid config |
| 7 | Not found (id doesn't exist) |

External scripts (Kanata, AHK, GTD integrations) branch on these.

---

## GUI views

The Tauri app has four views plus the tray menu. All views are TypeScript components under `frontend/src/components/`. All data flows through `services/ipc.ts`, which wraps Tauri commands that bridge to the daemon's named pipe.

### View hierarchy

```
App.ts
├── HeaderBar              (always visible: search, filter pills, status badge, settings ⚙)
└── RouterOutlet
    ├── RecordingsView     (default)
    │   ├── RecordingsList     (left pane, multi-column table)
    │   └── RecordingDetail    (right pane; collapsible Ctrl+\)
    ├── SettingsView
    ├── DoctorView
    └── FirstRunWizard     (opens automatically when config is missing)
```

### RecordingsView — Recordings List + Detail (hybrid layout)

The home view uses a master-detail split (always-visible list left + detail right), with the list as a multi-column table and the detail pane collapsible. When collapsed (Ctrl+\), the list expands to full width and exposes extra columns.

**List pane (default, detail visible) columns:**
- Time (relative or absolute, configurable)
- Duration
- Status (colored dot: green=done, yellow=pending, red=failed)
- Transcript preview (truncated)

**List pane (detail collapsed) extra columns:**
- Hook status (exit code or "—")
- Inline actions (▶ Play, ↻ Re-transcribe, 📋 Copy, ⋯ More)

**Resizable splitter** between list and detail. Width preference persists.

**Detail pane content:**
- Header: timestamp (relative + absolute on hover), duration, status pill
- Waveform player (wavesurfer.js, ~30 KB MIT) — clickable to seek, plays the WAV via HTML5 audio
- Action row: Play/Pause · Re-transcribe · Copy transcript · Copy as JSON · Reveal in Explorer · Re-fire hook · Delete
- Transcript editor: autosize `<textarea>`. Dirty indicator + Save button when modified. `Ctrl+S` saves; on save, calls `UpdateTranscript`, which writes both the catalog row and the JSON file in `inbox/done/` for consistency.
- Hook log expander (collapsed by default): last hook invocation's exit code and stderr tail.
- Metadata footer: id, audio file path (clickable to reveal), model used, hook script that ran.

**Keyboard shortcuts:**
- `↑` / `↓` — navigate list
- `Space` — play/pause selected
- `Enter` — focus transcript editor
- `Esc` — exit transcript edit
- `Ctrl+S` — save transcript
- `Ctrl+R` — re-transcribe
- `Delete` — delete (with confirm)
- `Ctrl+\` — toggle detail pane
- `/` — focus search

**Bulk selection:** Shift-click range, Ctrl-click toggle. Bulk actions: delete, replay, export to JSON.

**Empty state:** "No recordings yet. Press your hotkey or run `phoneme record --oneshot` to capture one."

**Live updates:** subscribed to `SubscribeEvents`; new recordings prepend to the list; in-flight ones show a spinner in the Status column.

### SettingsView

Single-page, scrollable, grouped sections (no tabs). Save button at top right; settings persist on Save (no auto-save).

| Section | Fields |
|---|---|
| LLM | Mode picker (BYO / Bundled+model / Download[v1.1]); URL field (mode 1); model GGUF picker (mode 2/3); test-transcribe button |
| Recording | Microphone picker (CPAL enumeration) + Refresh + live level meter; silence threshold (dBFS); silence window (ms); max duration |
| Hotkey | Enable global hotkey (checkbox, default off); combo picker (KeyboardEvent capture); mode (hold / toggle) |
| Hook | Command path + Browse; timeout; test-run button; "Open hooks folder" |
| Storage | Audio directory picker; "Open data folder" |
| Tray | Show on startup; minimize to tray; start at login (writes Run reg key on save) |
| Advanced | Daemon log level; "Open daemon.log"; "Open config.toml"; "Rebuild catalog" |

### DoctorView

Green/red checklist with a single "fix it" affordance per row.

```
✓ Daemon              running · pid 4521 · up 2h 14m         [Restart] [Stop]
✓ IPC pipe            \\.\pipe\phoneme-daemon                [Test]
─────────────────────────────────────────────────────────
✓ LLM mode            bundled_model
✓ LLM endpoint        http://127.0.0.1:5809 · 24ms           [Test transcribe]
✓ Bundled server      llama-server.exe · pid 4612 · 1.8GB    [Restart]
✓ Model file          gemma-4-E4B.Q5_K_M.gguf · 3.2 GB
─────────────────────────────────────────────────────────
✓ Microphone          Realtek USB Audio (default)            [Test 3s recording]
✓ Audio directory     ~/Documents/phoneme/audio · 142GB free
─────────────────────────────────────────────────────────
✓ Hook command        powershell -File …/to-org-journal.ps1  [Run hook test]
✓ Hook file exists    %APPDATA%/phoneme/hooks/to-org-journal.ps1
─────────────────────────────────────────────────────────
✓ Config file         %APPDATA%/phoneme/config.toml          [Open in editor]
✓ Catalog DB          14,217 recordings · last 12 min ago    [Rebuild from disk]
⚠ Recent failures     3 in inbox/failed/                     [View failed →]
✓ Disk space          142 GB free at audio_dir

                                              [Re-run all checks]
```

Wizard failures and tray error states deep-link here.

### Tray icon states

| State | Icon | Tooltip |
|---|---|---|
| Idle | gray mic | "Phoneme — ready" |
| Recording | red mic with pulsing dot | "Recording… {Xs}" |
| Transcribing | amber mic with spinner | "Transcribing {n}" |
| Catch-up backlog | amber mic with badge "N" | "{N} pending — LLM unreachable" |
| LLM error | red exclamation overlay | "LLM unreachable — click to open Doctor" |
| Hook failed (last) | gray mic + small red dot | "Last hook failed — click to view" |

### Tray menu (right-click)

```
  ● Record / ◼ Stop                   [contextual; primary action]
  ─────────
  Show window                          Ctrl+Alt+Shift+Space
  Last recording…                     [submenu: copy / replay / open]
  ─────────
  Doctor                               (red dot if any failure)
  Settings
  ─────────
  Pause hotkey                         [if global hotkey enabled]
  Quit
```

Left-click on tray: if recording, stop; else toggle window. Double-click: always open window.

---

## First-run wizard

Linear 7-step wizard that opens automatically when `config.toml` is missing. State persists between steps (back/forward navigation does not lose entries). Esc or window-close at any point prompts "Quit setup? You can run it again from Settings → Re-run setup." A "Skip setup" button jumps to defaults (mode 1, URL `http://127.0.0.1:5809`, hotkey off, hook to stdout).

The final step writes `config.toml` atomically — either a complete config or none.

| Step | Content |
|---|---|
| 1. Welcome | What Phoneme does ("press a hotkey, speak, get a transcript"); Continue / Quit |
| 2. LLM mode | Three options: BYO server (mode 1) · Bundled server + my model (mode 2, **recommended**) · Download a model (mode 3, **disabled with "v1.1" badge**) |
| 3. Configure mode | Mode 1: URL field + Test connection (probes the OpenAI-compatible API root with a GET). Mode 2: GGUF file picker + Test transcribe (prompts user to say a short phrase, records 3s, attempts transcription, shows the returned text or a specific error) |
| 4. Microphone | Device picker (CPAL enumeration) with refresh, live level meter, "Test (3-sec recording)" button that plays the recording back |
| 5. Hook | "How should Phoneme deliver your transcripts?" — options: stdout-only (default), browse for script, "I'll set this up later" (defaults to `to-stdout.ps1`) |
| 6. Hotkey | "Want a global hotkey for hold-to-talk?" — opt-in checkbox + KeyboardEvent capture; clear note: "If you use Kanata/AHK/WHKD to bind this externally, leave this off." |
| 7. Done | "You're set up. Try saying something now." + a giant Record button + a link to Doctor |

---

## Storage layout and configuration

**OS-convention paths** (config dir, data dir, log dir) resolve through the `directories` crate. **User-configured paths** in `config.toml` (audio_dir, hook command, model_path) additionally support `~` and `%VAR%` expansion via the `shellexpand` crate at load time. On Windows the resolved locations are:

```
%APPDATA%\phoneme\                          (config — user-editable)
├── config.toml
└── hooks\
    ├── to-stdout.ps1                       (default; copied from hooks-templates on first run)
    ├── to-org-journal.ps1                  (reference)
    └── to-markdown-daily.ps1               (reference)

%LOCALAPPDATA%\phoneme\                     (data — Phoneme-managed)
├── catalog.db                              (SQLite, WAL mode)
├── catalog.db-wal
├── catalog.db-shm
├── inbox\
│   ├── pending\{id}.json
│   ├── processing\{id}.json
│   ├── done\{id}.json
│   └── failed\{id}.json
├── llm\                                    (modes 2 & 3 only)
│   ├── llama-server.exe
│   └── models\                             (mode 3 downloads land here; mode 2 user can browse to anywhere)
├── logs\
│   ├── daemon.log                          (JSON lines, 10MB × 5)
│   ├── hook.log                            (text, 10MB × 3)
│   ├── llama-server.log                    (passthrough, 10MB × 3)
│   └── recordings.log                      (JSON lines, audit trail, 10MB × 5)
└── .lock                                   (daemon singleton PID)

{user-chosen audio_dir}\                    (default: %USERPROFILE%\Documents\phoneme\audio)
└── 2026-05-19\
    ├── 143500823.wav                       (filename = HHmmssMMM, matches the id's time portion)
    ├── 144122014.wav
    └── …
```

**Why config vs data is split:** Config is user-editable, small, and reasonable to back up or sync. Data churns constantly and should not be backed up wholesale. The `directories` crate's `config_dir()` and `data_local_dir()` make the distinction.

**Path expansion in config values:** Values like `audio_dir` and `hook.command` support `~` (home) and Windows-style `%VAR%` environment variable expansion via the `shellexpand` crate at load time. The wizard writes already-expanded literal paths; manual edits get the convenience of variables.

### `id` format

`YYYYMMDDTHHmmssMMM` (e.g., `20260519T143500823`). Sortable, unique-enough, no hyphens to escape in shells. Collisions would require two recordings starting in the same millisecond; the daemon serializes start requests, so this cannot happen.

### Inbox JSON shape

The same struct that gets piped to the hook:

```json
{
  "id": "20260519T143500823",
  "started_at": "2026-05-19T14:35:00.823-05:00",
  "duration_ms": 8470,
  "audio_path": "C:\\Users\\matt\\Documents\\phoneme\\audio\\2026-05-19\\143500823.wav",
  "transcript": "Reminder to email Sarah about the contract review by Friday.",
  "model": "gemma-4-E4B.Q5_K_M",
  "status": "done",
  "hook": {
    "command": "powershell -File ~\\AppData\\Roaming\\phoneme\\hooks\\to-org-journal.ps1",
    "exit_code": 0,
    "stderr_tail": null,
    "duration_ms": 142
  },
  "error": null
}
```

In `inbox/pending/` or `inbox/processing/`, `transcript` and `hook` are `null`. In `inbox/failed/`, `error` is an `{ kind, message }` object.

### SQLite catalog schema (v1)

```sql
CREATE TABLE recordings (
  id              TEXT PRIMARY KEY,
  started_at      TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  audio_path      TEXT NOT NULL,
  transcript      TEXT,
  model           TEXT,
  status          TEXT NOT NULL,
    -- recording | transcribing | hook_running | done | transcribe_failed | hook_failed
  error_kind      TEXT,
  error_message   TEXT,
  hook_command    TEXT,
  hook_exit_code  INTEGER,
  hook_duration_ms INTEGER,
  transcribed_at  TEXT,
  hook_ran_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recordings_started_at ON recordings(started_at DESC);
CREATE INDEX idx_recordings_status ON recordings(status);

CREATE VIRTUAL TABLE recordings_fts USING fts5(
  id UNINDEXED, transcript, content='recordings', content_rowid='rowid'
);

CREATE TRIGGER recordings_ai AFTER INSERT ON recordings BEGIN
  INSERT INTO recordings_fts(rowid, id, transcript) VALUES (new.rowid, new.id, new.transcript);
END;
CREATE TRIGGER recordings_au AFTER UPDATE ON recordings BEGIN
  UPDATE recordings_fts SET transcript = new.transcript WHERE rowid = new.rowid;
END;
CREATE TRIGGER recordings_ad AFTER DELETE ON recordings BEGIN
  DELETE FROM recordings_fts WHERE rowid = old.rowid;
END;

CREATE TABLE schema_meta (version INTEGER NOT NULL);
INSERT INTO schema_meta VALUES (1);
```

**Migrations:** `phoneme-core::catalog::migrate()` reads `schema_meta.version` and applies `migrations/{N}_to_{N+1}.sql` files in order. v1.0 ships with version 1.

**FTS5 rationale:** Tens of thousands of recordings remain searchable with negligible overhead. `phoneme list --search "sarah email"` and the GUI search box both use the FTS table.

**`phoneme doctor --rebuild-catalog`:** walks `inbox/done/`, `inbox/failed/`, and `audio_dir/`; re-creates rows for any WAV+JSON pair; logs any orphans.

### Config (`config.toml`)

```toml
# Phoneme configuration
# Edit and save, then restart phoneme-daemon (Doctor → Restart daemon).

[llm]
mode = "bundled_model"
  # "external"        — point at user's own llama-server (mode 1)
  # "bundled_model"   — daemon spawns bundled llama-server.exe with user-provided GGUF (mode 2)
  # "bundled_download" — same as above, model was downloaded by Phoneme (mode 3; v1.1)
external_url = "http://127.0.0.1:5809"
model_path = "C:/Users/matt/models/gemma-4-E4B.Q5_K_M.gguf"
bundled_server_port = 5809
bundled_server_args = []
timeout_secs = 60
system_prompt = "Transcribe the user's speech and clean it into a single line."

[recording]
audio_dir = "%USERPROFILE%/Documents/phoneme/audio"
sample_rate = 16000
channels = 1
silence_threshold_dbfs = -45
silence_window_ms = 3000
max_duration_secs = 300
input_device = "default"

[hook]
command = "powershell -File %APPDATA%/phoneme/hooks/to-stdout.ps1"
timeout_secs = 30

[hotkey]
enabled = false
combo = "Ctrl+Alt+Space"
mode = "hold"             # "hold" | "toggle"

[tray]
show_on_startup = true
minimize_to_tray = true
start_at_login = false

[daemon]
log_level = "info"        # error | warn | info | debug | trace
log_max_size_mb = 10
log_max_files = 5
pipe_name = "phoneme-daemon"
```

**Validation:** Loaded via `toml` + `serde` with explicit defaults. Schema-incompatible config aborts daemon startup with a clear error pointing at the offending key.

---

## Hook contract and reference hooks

### The contract

| Channel | Direction | Content |
|---|---|---|
| `stdin` | daemon → hook | One JSON object terminated by EOF. |
| `stdout` | hook → daemon | Ignored by the daemon. Captured to `hook.log` for the user's own debugging; not surfaced in UI. |
| `stderr` | hook → daemon | Captured to `hook.log`. On non-zero exit, the last 4 KB are stored in the catalog row as `error_message` and shown in the Recording Detail hook expander. |
| exit code | hook → daemon | `0` = success; non-zero = failure (any value; daemon doesn't interpret specific codes). |
| timeout | daemon enforces | `hook.timeout_secs` (default 30). On timeout, daemon sends SIGTERM, waits 2s, sends SIGKILL. Exit recorded as `null`, `error_kind = "hook_timeout"`. |
| working dir | daemon sets | `%USERPROFILE%`. Predictable; lets hooks use relative paths. |
| env vars | daemon sets | Inherits parent env + adds `PHONEME_ID`, `PHONEME_AUDIO_PATH`, `PHONEME_TRANSCRIPT` for hooks that prefer env vars over JSON parsing. |

### The JSON payload

```json
{
  "id": "20260519T143500823",
  "timestamp": "2026-05-19T14:35:00.823-05:00",
  "transcript": "Reminder to email Sarah about the contract review by Friday.",
  "audio_path": "C:\\Users\\matt\\Documents\\phoneme\\audio\\2026-05-19\\143500823.wav",
  "duration_ms": 8470,
  "model": "gemma-4-E4B.Q5_K_M",
  "metadata": {
    "phoneme_version": "1.0.0",
    "hook_version": 1
  }
}
```

`metadata.hook_version` is a stability commitment: while it stays `1`, the surrounding fields don't rename or disappear. v1.1 may add fields. v2 may bump and break.

### Hook discovery

Hooks are not on PATH. The full command string from `config.toml` is invoked via the system shell:
- `.ps1` → `powershell -ExecutionPolicy Bypass -File <path> <args>`
- `.exe`, `.bat`, `.cmd` → invoked directly
- Anything else → invoked directly (user responsibility to ensure it's runnable)

Extension detection happens once at command parse time.

### Reference hooks shipped with the installer

Installed to `Program Files\Phoneme\hooks-templates\` (read-only); on first run, copied to `%APPDATA%\phoneme\hooks\` (user-editable). Installer never overwrites the user's `%APPDATA%` copies.

**`to-stdout.ps1`** — default:
```powershell
$payload = $input | Out-String | ConvertFrom-Json
Write-Output $payload.transcript
```

**`to-org-journal.ps1`** — appends to `~/Documents/org/journal.org` under today's date heading.

**`to-markdown-daily.ps1`** — appends to `~/Documents/notes/YYYY-MM-DD.md`.

**`to-denote.ps1`** — creates a Denote-flavored note file with `:voice:` tag in `~/Documents/org/notes/`. (Tailored to Matt's PKM stack.)

Full source for each hook lives in `hooks/` in the repo and is documented in `docs/hooks.md`.

### `phoneme hook test`

Runs the configured hook with a sample payload (`id=test-1`, generic transcript). Prints exit code, duration, stdout, and stderr. Used by the wizard's hook step and by users to validate setup.

---

## Error handling, doctor, observability

### Error taxonomy

| Kind | Surfaces |
|---|---|
| `audio_device_unavailable` | Tray notification + Doctor red row |
| `audio_permission_denied` | Wizard + Doctor; links to Windows Settings → Privacy → Microphone |
| `llm_unreachable` | Tray amber + Doctor + per-recording status |
| `llm_timeout` | Per-recording row ("timed out — retry") |
| `llm_error_4xx_5xx` | Per-recording row + log |
| `model_file_missing` | Wizard + Doctor + daemon startup error |
| `bundled_server_crashed` | Tray amber + Doctor (offers manual restart) |
| `hook_failed` | Recording detail (red "Re-fire hook" + stderr expander) |
| `hook_timeout` | Same as above |
| `disk_full` | Tray red; daemon pauses recording |
| `catalog_corrupted` | Daemon refuses to start; tells user to run `--rebuild-catalog` |
| `config_invalid` | Daemon refuses to start with line/column |
| `pipe_in_use` | Daemon refuses to start; tells user how to stop the existing one |

### Doctor

Doctor is the canonical "what's wrong" surface. Wizard failure paths and tray error states deep-link here. Every row has a single "fix it" affordance — a button or "Reveal in Explorer" target. Full layout in **GUI views → DoctorView**.

### Logs

| File | Format | Rotation |
|---|---|---|
| `daemon.log` | JSON lines via `tracing` | 10 MB × 5 |
| `hook.log` | Plain text, one block per invocation | 10 MB × 3 |
| `llama-server.log` | Passthrough of child stderr | 10 MB × 3 (modes 2/3 only) |
| `recordings.log` | JSON line per state transition (audit trail) | 10 MB × 5 |

**Structured log example:**

```json
{"timestamp":"2026-05-19T14:35:02.103-05:00","level":"INFO","module":"queue_worker","event":"transcription_started","recording_id":"20260519T143500823","model":"gemma-4-E4B"}
{"timestamp":"2026-05-19T14:35:11.448-05:00","level":"INFO","module":"queue_worker","event":"transcription_done","recording_id":"20260519T143500823","duration_ms":9345,"transcript_chars":78}
{"timestamp":"2026-05-19T14:35:11.502-05:00","level":"WARN","module":"hook_runner","event":"hook_nonzero_exit","recording_id":"20260519T143500823","exit_code":2,"stderr_tail":"Cannot write to journal.org: permission denied"}
```

### Telemetry

None. Phoneme is local-first. The only network calls are (a) to the configured llama-server endpoint and (b) optionally Hugging Face during the v1.1 model-download wizard if the user clicks the download button. No update checks, no usage pings, no crash reports. README states this explicitly.

---

## Testing strategy

### Crate-level (unit + property tests)

| Crate | Coverage |
|---|---|
| `phoneme-core` | Config parse/validate, queue state transitions, hook payload serde, error type round-trips, catalog migrations |
| `phoneme-core::queue` | Property tests (`proptest`) — random sequences of "start / stop / crash / restart" must always converge to a valid state |
| `phoneme-audio` | WAV header correctness, silence detection algorithm, sample-rate conversion |
| `phoneme-ipc` | Request/response serde round-trip; protocol versioning |

### Daemon integration tests

Run the daemon binary in a temp directory with a stubbed `llama-server` (small Hyper server on a random port returning canned transcriptions) and a test-controlled CPAL input. Located in `bin/phoneme-daemon/tests/`.

| Test | Scenario |
|---|---|
| `test_basic_flow` | Start → record → stop → transcribe → hook → done |
| `test_llm_unreachable_queues` | Stub returns 503; multiple recordings pile up; queue depth event emitted; recovery when stub comes back |
| `test_hook_timeout` | Hook script sleeps 60s; daemon kills at 30s; catalog marked `hook_failed` |
| `test_crash_during_processing` | Spawn daemon, start recording mid-transcription, SIGKILL daemon, spawn new daemon, verify it recovers `inbox/processing/` |
| `test_concurrent_record_rejected` | Second `record_start` while recording returns `AlreadyRecording` |
| `test_pipe_singleton` | Second daemon exits cleanly with `pipe_in_use` |
| `test_replay_works` | Mark failed; call `replay`; verify success |
| `test_event_stream` | Subscribe to events; verify expected order |
| `test_rebuild_catalog` | Delete catalog.db; run `--rebuild-catalog`; verify all WAVs + inbox entries reappear |

### CLI tests

Snapshot tests via `insta` — every CLI command's output (with `--no-color`, `--frozen-time`) captured to a golden file. Covers all exit codes.

### Tauri frontend tests

Component tests via Vitest for pure-UI logic (transcript editor dirty tracking, search debouncing, status pill rendering). No browser-driven E2E in v1; replaced by a written manual smoke test plan.

### Manual smoke test (10 minutes, before each release)

```
□ Fresh install on clean Windows VM → wizard runs end-to-end (mode 2 happy path)
□ Hotkey hold-to-talk records and transcribes within 10s
□ CLI: phoneme record --oneshot records and prints transcript
□ External: Kanata sends --start/--stop, completes a recording
□ Tray right-click menu items all work; tray icon states change correctly
□ Recordings list: search by text returns matches; date filter works
□ Recording detail: edit transcript, save, reopen → edit persists
□ Doctor: every check has a fix-it action that works
□ Kill llama-server mid-transcription → recording marked failed → replay succeeds
□ Disconnect mic mid-recording → user-visible error, daemon continues running
□ Window close → minimized to tray; double-click → reopens
□ Quit from tray menu → daemon exits cleanly; pipe lock released
```

### CI matrix (GitHub Actions)

- **Every PR + push to main:** `cargo fmt --check`, `cargo clippy --all-targets`, `cargo test --workspace`, `frontend pnpm test`, `frontend pnpm build`. Single job on `windows-latest`.
- **Release tags (`v*`):** all of the above + build MSI installer + sign (if cert configured) + create GitHub Release with the .msi attached + auto-generate changelog from conventional commits.
- **Nightly:** `cargo test --workspace --release` + daemon integration suite (slow, ~5 min).

---

## Build, distribution, milestones, non-goals

### Local dev workflow

```bash
# First-time setup
cargo install tauri-cli@^2
cd frontend && pnpm install
cd ..

# Daily dev (in tmux or split terminals)
pnpm --filter frontend dev               # Vite dev server
cargo run -p phoneme-daemon              # daemon foreground
cargo tauri dev                          # Tauri GUI shell

# CLI iteration
cargo run -p phoneme -- record --oneshot
cargo run -p phoneme -- doctor

# Tests
cargo test --workspace
cargo test -p phoneme-daemon --test integration -- --nocapture
```

### Release build

```bash
cargo tauri build  # produces installer in src-tauri/target/release/bundle/msi/
```

### Installer (Wix MSI, bundled via Tauri)

| Destination | Content |
|---|---|
| `Program Files\Phoneme\` | `phoneme.exe`, `phoneme-daemon.exe`, `phoneme-tray.exe`, `llama-server.exe`, license, README |
| `Program Files\Phoneme\hooks-templates\` | Read-only source for first-run hook copy |
| `%APPDATA%\phoneme\hooks\` | Populated from hooks-templates on first run; never overwritten thereafter |
| Start Menu shortcut | `phoneme-tray.exe` |
| PATH (optional, opt-in at install) | `Program Files\Phoneme\` for shell access |
| Uninstaller | Standard Windows; prompts at uninstall: "Remove your data and config too?" |

**Size target:** ≤ 120 MB total. llama-server CPU build is ~80–100 MB; Phoneme binaries ~15 MB.

### Versioning

SemVer. `hook_version` in the JSON payload is independent of the app version. Tagged releases follow `v1.0.0`, `v1.1.0`, `v1.1.1`. Conventional commits drive automatic changelog generation.

### Release process

1. PR merged to `main` bumping version in workspace `Cargo.toml`
2. Tag `v1.0.0` and push
3. GitHub Actions builds, signs (if cert configured), publishes MSI to GitHub Releases
4. Auto-generated changelog; manually edit Highlights before publishing

### Build order (v1.0 milestones)

| # | Milestone | Done when |
|---|---|---|
| 1 | Scaffold workspace | `cargo build --workspace` succeeds with empty crates |
| 2 | `phoneme-core`: types, config, error taxonomy | Config TOML round-trip unit tests pass |
| 3 | `phoneme-core`: catalog (SQLite + FTS5 + migrations) | `cargo test -p phoneme-core --features catalog` green |
| 4 | `phoneme-core`: queue (inbox state machine + crash recovery) | Property tests on state transitions green |
| 5 | `phoneme-core`: transcription client | Mock-server integration test passes |
| 6 | `phoneme-core`: hook runner | Unit test with sample hook .ps1 passes |
| 7 | `phoneme-audio`: CPAL capture → WAV | Standalone binary records 3s to a WAV that plays back |
| 8 | `phoneme-ipc`: schema + named-pipe transport | Round-trip unit tests; smoke test client↔server |
| 9 | `phoneme-daemon`: wire above together | All integration tests pass |
| 10 | `bin/phoneme`: CLI subcommands | Snapshot tests pass; `phoneme doctor` returns green on a healthy system |
| 11 | `phoneme-daemon`: llama-server supervisor (modes 2/3) | Daemon spawns, restarts on crash, kills cleanly on shutdown |
| 12 | Tauri shell: tray + window + IPC bridge | App opens, tray works, subscribes to events |
| 13 | Frontend: RecordingsView (hybrid list + detail) | Browse, play, edit, save transcripts |
| 14 | Frontend: SettingsView | Save round-trips through daemon |
| 15 | Frontend: DoctorView | All checks display; fix-it actions work |
| 16 | Frontend: FirstRunWizard | Fresh install → wizard → working config → first recording |
| 17 | Reference hooks + docs | All four hooks tested; `docs/hooks.md` published |
| 18 | CI workflows (test + release) | Tag-triggered build produces signed MSI on GitHub Releases |
| 19 | Manual smoke test on clean VM | Checklist passes end-to-end |
| 20 | Public README + repo polish | Screenshots, quickstart, troubleshooting, design doc linked |

### v1.1 (planned, no committed date)

- **Mode 3: Download a model for me** — Hugging Face direct, resumable, checksum-verified, progress UI
- **Webhook target** — `[hook] webhook_url = "..."` POSTs JSON in addition to running the subprocess hook
- **Multiple hooks** — `hooks = ["a.ps1", "b.ps1"]` serial execution
- **`phoneme config reload`** — daemon picks up config changes without restart
- **Tagging** — tags column in catalog; tag filter in GUI search
- **Bulk export** — selected recordings → JSONL or zip of WAVs
- **"Today" view** — filtered home screen

### Future (no committed date)

- **macOS DMG + Linux .deb / AppImage / AUR** — code is cross-platform-ready; this is CI + testing + platform-specific bits (LaunchAgent, XDG autostart, code signing)
- **Streaming transcription** — partial transcript displayed while speaking
- **Intent routing** — default hook with heuristics for "reminder", "add to journal", etc.
- **Speaker diarization**
- **Encrypted-at-rest WAVs** — FileVault-style
- **`phoneme-server` mode** — HTTP API for remote phones (push-to-talk from mobile)

### Cross-platform readiness (designed for, deferred)

The following abstractions exist in v1.0 so the future port is mostly platform-specific bits, not a rewrite:

| Concern | Windows (v1.0) | macOS / Linux (future) |
|---|---|---|
| IPC transport | Named pipe `\\.\pipe\phoneme-daemon` | Unix domain socket `$XDG_RUNTIME_DIR/phoneme-daemon.sock` |
| Default hook shell | `powershell -File ...ps1` | `bash ...sh` |
| Reference hooks | `.ps1` shipped | `.sh` versions shipped |
| Start at login | Registry `Run` key | macOS LaunchAgent plist / Linux XDG `.desktop` |
| Installer | MSI (Wix via Tauri) | DMG + .pkg / .deb + AppImage / AUR PKGBUILD |
| Path resolution | `directories` crate handles all of this | (same) |

### Explicit non-goals for v1.0

- Cloud sync, accounts, telemetry, auto-update
- Word-level timestamps (Gemma doesn't return them; not worth post-processing)
- Audio editing (trim, denoise)
- Multi-language voice command parsing
- macOS / Linux installers
- Encrypted-at-rest WAVs
- Bundling a model file in the installer

---

## Decision log

Brief record of the architectural decisions made during brainstorming, for future-Matt and future-Claude:

| Decision | Choice | Rationale |
|---|---|---|
| Daemon model | **Split**: `phoneme-daemon` separate from CLI and tray | CLI use case is important; tray should be a peer frontend, not the brain. |
| Install modes | **All three available**, v1 ships modes 1 & 2; mode 3 deferred to v1.1 | One binary, runtime switch via wizard. Model file is NOT bundled (keeps installer ≤120 MB). |
| Catalog storage | **JSON inbox + SQLite catalog (with FTS5)** | Inbox JSON gives crash-safe queue via atomic rename; SQLite gives fast search; `--rebuild-catalog` makes DB a derived view. |
| Recording concurrency | Single active recording; serial transcription; serial hooks; exponential-backoff retry on LLM unreachable | Mic is single-owner; one llama-server bottleneck; avoid hook-write races. |
| Hotkey conflict resolution | Tray's global hotkey **disabled by default**. User opts in explicitly. Doc says "tray OR external daemon, not both." | Auto-detection of conflicts is brittle. Explicit choice is reliable. |
| IPC transport | **Named pipes** on Windows, JSON-line protocol | Windows-native; behind a trait so Unix-domain-sockets is a swap. |
| Recordings List layout | **Hybrid master-detail**: split view with multi-column list and collapsible detail (Ctrl+\) | Best of A (always-visible split) and B (full-width table density). |
| Hook payload version | **`metadata.hook_version = 1`** | Stable contract; lets us evolve fields in v1.1 without breaking user hooks. |
| Telemetry | **None, ever** | Local-first. Stated in README. |
| Cross-platform timing | **Designed for cross-platform from day one; ships Windows v1.0** | Three-OS CI front-loads testing work that's mostly orthogonal to building the app. |

---

## Appendix A — Differentiation from Mnemonic (macOS inspiration)

| | Mnemonic | Phoneme |
|---|---|---|
| Platform | macOS only | Windows (cross-platform planned) |
| Output | Writes directly to YYYY-MM-DD.md | Emits JSON, user hook decides |
| Journal format | Markdown only | Any (user-owned hook) |
| Interface | Menu-bar only | CLI-first + optional tray GUI |
| Hotkey | App-owned only | App's tray hotkey OR external daemon (Kanata, AHK) |
| Recording history | Not browsable | Full GUI with search/play/edit/re-transcribe |
| Install modes | Bundled | 3 modes (BYO server / bundled+model / download[v1.1]) |

---

## Appendix B — Open questions for implementation phase

These are explicitly deferred to the implementation plan; flagging them so they're not forgotten:

1. **Audio device hot-swap behavior** — what should `cpal::default_input_device()` do if the user disconnects their primary mic mid-session but the daemon is idle? (Probably: re-resolve on each `record_start`, surface error if missing.)
2. **WAL checkpointing cadence** — SQLite WAL grows unbounded if never checkpointed; pick a sensible interval (every N writes, or every 5 min).
3. **Hook log retention policy** — `hook.log` grows linearly with usage; default 10 MB × 3 may be too small for heavy users. Make configurable in v1.1.
4. **`inbox/done/` pruning** — files there accumulate indefinitely. A Settings option "Prune inbox/done older than N days" is on the v1.1 roadmap.
5. **Windows code signing** — getting a code-signing cert (~$200/yr) is optional but improves SmartScreen UX. Decision deferred.
6. **wavesurfer.js memory for very long recordings** — works fine for typical voice notes (< 5 min); test with a 30-min stress case.

---

## End of design
