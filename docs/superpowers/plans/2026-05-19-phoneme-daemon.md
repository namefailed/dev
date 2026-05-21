# Phoneme — Plan 3a: `phoneme-daemon`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the three libraries from Plans 1 and 2 into a working headless daemon. At the end of this plan the daemon: owns audio capture and the inbox queue, drives transcription through llama-server (real or stubbed), runs the user's hook script, exposes everything via its IPC surface, recovers cleanly from crashes, and shuts down gracefully.

**Depends on:** Plans 1 and 2 complete.

**Architecture:** Single Tokio-runtime binary at `bin/phoneme-daemon`. Owns the entire pipeline:

```
   IPC server (NamedPipeListener)
        │
        │ accept → per-connection handler task
        ▼
   ┌──────────────────────────────────┐
   │           AppState               │
   │  Catalog | InboxQueue | Config   │
   │  Recorder | EventBus | ...       │
   └──────────────────────────────────┘
        │                  │
        ▼                  ▼
   Queue worker      Recorder
   (transcribe →     (CPAL/synthetic
    hook → done)      → WAV → enqueue)
        │
        ▼
   LLM supervisor (modes 2/3)
```

**Tech stack:** clap for binary args (just `daemon` foreground mode), tokio, tracing + tracing-subscriber + tracing-appender for logs, notify 6 for inbox file-watching, plus everything from Plans 1 and 2.

**Spec reference:** `~/dev/phoneme/docs/superpowers/specs/2026-05-19-phoneme-design.md` — milestones 9 and 11.

**The CLI lives in Plan 3b** (separate file). The daemon is fully testable on its own via the integration test harness.

---

## File structure for this plan

```
bin/
└── phoneme-daemon/
    ├── Cargo.toml                            [create]
    ├── README.md                             [create]
    ├── src/
    │   ├── main.rs                           [create — entrypoint, runtime, signal handling]
    │   ├── app_state.rs                      [create — AppState holds all components]
    │   ├── lockfile.rs                       [create — PID lockfile + cleanup]
    │   ├── ipc_server.rs                     [create — accept loop + per-connection dispatch]
    │   ├── ipc_handler.rs                    [create — Request → Response routing]
    │   ├── recorder.rs                       [create — wraps phoneme-audio with catalog + queue]
    │   ├── queue_worker.rs                   [create — drains inbox/pending]
    │   ├── pipeline.rs                       [create — transcribe → hook orchestration]
    │   ├── event_bus.rs                      [create — broadcast wrapper]
    │   ├── llm_supervisor.rs                 [create — spawns llama-server (modes 2/3)]
    │   ├── reconcile.rs                      [create — startup reconciliation]
    │   ├── shutdown.rs                       [create — graceful shutdown coordination]
    │   └── logging.rs                        [create — tracing-subscriber setup]
    └── tests/
        ├── common/
        │   └── mod.rs                        [create — test harness (TempDir, stub llama-server)]
        ├── basic_flow.rs                     [create — happy-path end-to-end]
        ├── llm_unreachable.rs                [create — queue accumulates, recovers on reachability]
        ├── hook_timeout.rs                   [create — hook killed at timeout]
        ├── crash_recovery.rs                 [create — kill daemon mid-pipeline; recover]
        ├── concurrent_record.rs              [create — second RecordStart rejected]
        ├── pipe_singleton.rs                 [create — second daemon exits cleanly]
        ├── replay.rs                         [create — replay re-runs transcription]
        ├── event_stream.rs                   [create — SubscribeEvents]
        └── rebuild_catalog.rs                [create — phoneme doctor --rebuild-catalog equivalent]
```

Modifications:
- `Cargo.toml` (workspace) — add `"bin/phoneme-daemon"` to `members`. Add `notify = "6"` and `clap = { version = "4", features = ["derive"] }` to `workspace.dependencies`.

---

## Task 1: Workspace add + daemon binary scaffold

**Files:**
- Modify: `Cargo.toml` (workspace)
- Create: `bin/phoneme-daemon/Cargo.toml`
- Create: `bin/phoneme-daemon/src/main.rs`

- [ ] **Step 1: Add to workspace**

In root `Cargo.toml`:
- Add `"bin/phoneme-daemon"` to `[workspace] members`.
- Append to `[workspace.dependencies]`:

```toml
notify = "6"
clap = { version = "4", features = ["derive"] }
tracing-appender = "0.2"
```

- [ ] **Step 2: Create `bin/phoneme-daemon/Cargo.toml`**

```toml
[package]
name = "phoneme-daemon"
version.workspace = true
edition.workspace = true
license.workspace = true

[[bin]]
name = "phoneme-daemon"
path = "src/main.rs"

[dependencies]
phoneme-core = { path = "../../crates/phoneme-core" }
phoneme-audio = { path = "../../crates/phoneme-audio" }
phoneme-ipc = { path = "../../crates/phoneme-ipc" }
anyhow.workspace = true
thiserror.workspace = true
serde.workspace = true
serde_json.workspace = true
tokio.workspace = true
tokio-util.workspace = true
tracing.workspace = true
tracing-subscriber.workspace = true
tracing-appender.workspace = true
clap.workspace = true
notify.workspace = true
directories.workspace = true
chrono.workspace = true
futures = "0.3"
async-trait = "0.1"

[dev-dependencies]
tempfile.workspace = true
wiremock.workspace = true
tokio = { workspace = true, features = ["test-util", "macros"] }
```

- [ ] **Step 3: Create the entrypoint stub `bin/phoneme-daemon/src/main.rs`**

```rust
//! phoneme-daemon — the headless brain.
//!
//! See `docs/superpowers/specs/2026-05-19-phoneme-design.md` for architecture.

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    eprintln!("phoneme-daemon stub — wiring to come in later tasks");
    Ok(())
}
```

- [ ] **Step 4: Verify the binary builds**

Run: `cargo build -p phoneme-daemon`
Expected: clean build; produces `target/debug/phoneme-daemon.exe`.

- [ ] **Step 5: Verify the binary runs**

Run: `cargo run -p phoneme-daemon`
Expected: prints `phoneme-daemon stub …` and exits 0.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml bin/phoneme-daemon/
git commit -m "scaffold phoneme-daemon binary"
```

---

## Task 2: Logging setup

**Files:**
- Create: `bin/phoneme-daemon/src/logging.rs`
- Modify: `bin/phoneme-daemon/src/main.rs`

- [ ] **Step 1: Create the logging module**

Create `bin/phoneme-daemon/src/logging.rs`:

```rust
//! Tracing/logging configuration for the daemon.
//!
//! - Foreground mode: pretty logs to stderr.
//! - Background (default): JSON lines to `<log_dir>/daemon.log` with rolling
//!   appender (10 MB × 5 files, configurable).

use phoneme_core::Config;
use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Initialize tracing for the daemon. Returns a guard that must be held for
/// the lifetime of the process to keep the background writer alive.
pub fn init(
    cfg: &Config,
    log_dir: &Path,
    foreground: bool,
) -> anyhow::Result<Option<WorkerGuard>> {
    let level = match cfg.daemon.log_level.as_str() {
        "error" => "error",
        "warn" => "warn",
        "info" => "info",
        "debug" => "debug",
        "trace" => "trace",
        _ => "info",
    };
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("phoneme={level},warn")));

    if foreground {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().with_target(true).with_writer(std::io::stderr))
            .init();
        Ok(None)
    } else {
        std::fs::create_dir_all(log_dir)?;
        let file_appender = tracing_appender::rolling::daily(log_dir, "daemon.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().json().with_writer(non_blocking))
            .init();
        Ok(Some(guard))
    }
}
```

- [ ] **Step 2: Wire into `main.rs`**

Replace `bin/phoneme-daemon/src/main.rs`:

```rust
//! phoneme-daemon — the headless brain.

use anyhow::Result;
use clap::Parser;

mod logging;

#[derive(Debug, Parser)]
#[command(name = "phoneme-daemon", version)]
struct Args {
    /// Run in foreground (logs to stderr instead of file).
    #[arg(long)]
    foreground: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let cfg = phoneme_core::Config::default();
    let log_dir = std::env::temp_dir().join("phoneme-daemon-logs");
    let _guard = logging::init(&cfg, &log_dir, args.foreground)?;
    tracing::info!("phoneme-daemon starting");
    tracing::info!("(stub — wiring to come in later tasks)");
    Ok(())
}
```

- [ ] **Step 3: Run and verify foreground logs to stderr**

Run: `cargo run -p phoneme-daemon -- --foreground`
Expected: prints a structured log line to stderr like `INFO phoneme_daemon: phoneme-daemon starting`.

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add structured logging (stderr foreground / JSON file background)"
```

---

## Task 3: AppState — the central registry

**Files:**
- Create: `bin/phoneme-daemon/src/app_state.rs`
- Modify: `bin/phoneme-daemon/src/main.rs`

`AppState` holds every long-lived component the daemon owns. It's passed by `Arc<AppState>` to every task that needs catalog, queue, config, or event bus access. We add components as we build them; this task wires the skeleton.

- [ ] **Step 1: Create `bin/phoneme-daemon/src/app_state.rs`**

```rust
//! AppState — central holder for all long-lived daemon components.

use phoneme_core::{Catalog, Config, InboxQueue};
use std::path::PathBuf;
use std::sync::Arc;

/// Resolved paths derived from `Config`. Created once at startup.
#[derive(Debug, Clone)]
pub struct ResolvedPaths {
    pub audio_dir: PathBuf,
    pub inbox_dir: PathBuf,
    pub catalog_db: PathBuf,
    pub log_dir: PathBuf,
    pub lock_file: PathBuf,
}

impl ResolvedPaths {
    pub fn from_config(cfg: &Config) -> anyhow::Result<Self> {
        let dirs = directories::ProjectDirs::from("", "", "phoneme")
            .ok_or_else(|| anyhow::anyhow!("could not resolve project directories"))?;
        let data_local = dirs.data_local_dir();

        // Expand user-config paths.
        let expanded = cfg.expanded()?;
        let audio_dir: PathBuf = expanded.recording.audio_dir.into();

        Ok(Self {
            audio_dir,
            inbox_dir: data_local.join("inbox"),
            catalog_db: data_local.join("catalog.db"),
            log_dir: data_local.join("logs"),
            lock_file: data_local.join(".lock"),
        })
    }
}

/// Central component holder. Cloning `AppState` clones the `Arc` —
/// underlying components are shared.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub paths: Arc<ResolvedPaths>,
    pub catalog: Catalog,
    pub inbox: InboxQueue,
    // event_bus and others added in later tasks
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let paths = ResolvedPaths::from_config(&config)?;
        tokio::fs::create_dir_all(&paths.audio_dir).await?;
        tokio::fs::create_dir_all(&paths.inbox_dir).await?;
        tokio::fs::create_dir_all(&paths.log_dir).await?;
        if let Some(parent) = paths.catalog_db.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let catalog = Catalog::open(&paths.catalog_db).await?;
        let inbox = InboxQueue::new(&paths.inbox_dir).await?;

        Ok(Self {
            config: Arc::new(config),
            paths: Arc::new(paths),
            catalog,
            inbox,
        })
    }
}
```

- [ ] **Step 2: Wire into `main.rs`**

Replace `bin/phoneme-daemon/src/main.rs`:

```rust
//! phoneme-daemon — the headless brain.

use anyhow::Result;
use clap::Parser;

mod app_state;
mod logging;

use app_state::AppState;

#[derive(Debug, Parser)]
#[command(name = "phoneme-daemon", version)]
struct Args {
    /// Run in foreground (logs to stderr instead of file).
    #[arg(long)]
    foreground: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let cfg = phoneme_core::Config::default();
    let state = AppState::new(cfg).await?;
    let _guard = logging::init(&state.config, &state.paths.log_dir, args.foreground)?;
    tracing::info!(
        audio_dir = %state.paths.audio_dir.display(),
        catalog_db = %state.paths.catalog_db.display(),
        "phoneme-daemon started"
    );
    Ok(())
}
```

- [ ] **Step 3: Verify it runs without panicking**

Run: `cargo run -p phoneme-daemon -- --foreground`
Expected: prints "phoneme-daemon started" with directory paths; exits 0.

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add AppState (Catalog, InboxQueue, ResolvedPaths)"
```

---

## Task 4: Lockfile + pipe singleton enforcement

**Files:**
- Create: `bin/phoneme-daemon/src/lockfile.rs`
- Modify: `bin/phoneme-daemon/src/main.rs`

Per spec: only one daemon may run at a time. Enforced by (a) a PID lockfile at `<data_local>/.lock` and (b) named-pipe `first_pipe_instance(true)` enforcement (added in Task 5).

- [ ] **Step 1: Create `bin/phoneme-daemon/src/lockfile.rs`**

```rust
//! PID lockfile — singleton enforcement layer 1 (the named pipe is layer 2).
//!
//! Conventions:
//! - File contains the PID as ASCII text on a single line, plus newline.
//! - On acquire: if file exists, check if PID is alive. If yes, error. If no,
//!   treat as stale and overwrite.
//! - On release: delete the file.

use anyhow::{bail, Context, Result};
use std::path::Path;

pub struct Lockfile {
    path: std::path::PathBuf,
}

impl Lockfile {
    /// Acquire the lockfile. Returns an error with kind `pipe_in_use` if another
    /// live daemon is already running.
    pub fn acquire(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if path.exists() {
            let existing = std::fs::read_to_string(path).unwrap_or_default();
            if let Ok(pid) = existing.trim().parse::<u32>() {
                if pid_is_alive(pid) {
                    bail!(
                        "another phoneme-daemon is running (pid {pid}). Stop it with `phoneme daemon --stop`."
                    );
                }
                tracing::warn!(stale_pid = pid, "removing stale lockfile");
            }
        }
        let pid = std::process::id();
        std::fs::write(path, format!("{pid}\n")).context("writing lockfile")?;
        Ok(Self { path: path.to_path_buf() })
    }
}

impl Drop for Lockfile {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_file(&self.path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(error = %e, "failed to remove lockfile on drop");
            }
        }
    }
}

#[cfg(windows)]
fn pid_is_alive(pid: u32) -> bool {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        if ok == 0 {
            return false;
        }
        // STILL_ACTIVE == 259
        code == 259
    }
}

#[cfg(not(windows))]
fn pid_is_alive(pid: u32) -> bool {
    // Best-effort: try kill(0). Errors out if the process doesn't exist.
    use std::process::Command;
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn acquire_creates_file_with_current_pid() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".lock");
        let _lock = Lockfile::acquire(&path).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        let pid: u32 = content.trim().parse().unwrap();
        assert_eq!(pid, std::process::id());
    }

    #[test]
    fn drop_removes_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".lock");
        {
            let _lock = Lockfile::acquire(&path).unwrap();
            assert!(path.exists());
        }
        assert!(!path.exists());
    }

    #[test]
    fn stale_lockfile_is_replaced() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".lock");
        // PID 1 is unlikely to be a phoneme daemon. Write a non-existent PID
        // (on Windows, 0 is invalid; pick something unlikely like 999999).
        std::fs::write(&path, "999999\n").unwrap();
        let _lock = Lockfile::acquire(&path).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content.trim().parse::<u32>().unwrap(), std::process::id());
    }
}
```

- [ ] **Step 2: Add `windows-sys` dependency**

In `bin/phoneme-daemon/Cargo.toml`, append to `[dependencies]`:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_System_Threading", "Win32_Foundation"] }
```

- [ ] **Step 3: Wire into `main.rs`**

Update `bin/phoneme-daemon/src/main.rs` — between AppState creation and the success log, add:

```rust
mod lockfile;
use lockfile::Lockfile;

// ... inside main(), after `let state = AppState::new(...)`:
let _lock = Lockfile::acquire(&state.paths.lock_file)?;
```

(Insert the `mod lockfile;` near the other module declarations and the `Lockfile::acquire` line after `AppState::new`.)

- [ ] **Step 4: Run tests**

Run: `cargo test -p phoneme-daemon lockfile::`
Expected: 3 tests pass.

- [ ] **Step 5: Verify double-launch is rejected**

In one terminal: `cargo run -p phoneme-daemon -- --foreground` (let it run).
In another: `cargo run -p phoneme-daemon -- --foreground`
Expected: second invocation prints an error message containing the running PID and exits non-zero.

Stop the first daemon with Ctrl+C, then verify a third invocation succeeds (stale lock cleaned).

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml bin/phoneme-daemon/
git commit -m "phoneme-daemon: add PID lockfile (singleton enforcement layer 1)"
```

---

## Task 5: IPC server skeleton — accept loop

**Files:**
- Create: `bin/phoneme-daemon/src/ipc_server.rs`
- Create: `bin/phoneme-daemon/src/ipc_handler.rs`
- Modify: `bin/phoneme-daemon/src/main.rs`

The IPC server accepts pipe connections, hands each off to a handler task. We start with a stub handler that returns `Response::Ok(null)` for every request; full request routing is added in subsequent tasks.

- [ ] **Step 1: Create `bin/phoneme-daemon/src/ipc_handler.rs`**

```rust
//! IPC request routing.
//!
//! Each accepted pipe connection runs `handle_connection`, which loops:
//!   1. Read one Request.
//!   2. Call `handle_request` to produce a Response.
//!   3. Send the Response.
//!   4. Repeat until the client closes.
//!
//! `SubscribeEvents` is special — it hijacks the connection for the rest of
//! its life and streams DaemonEvents.

use crate::app_state::AppState;
use phoneme_ipc::{IpcError, IpcErrorKind, NamedPipeConnection, Request, Response};

pub async fn handle_connection(mut conn: NamedPipeConnection, _state: AppState) {
    loop {
        match conn.recv().await {
            Ok(Some(req)) => {
                let response = handle_request(req).await;
                if let Err(e) = conn.send_response(response).await {
                    tracing::warn!(error = %e, "send_response failed; closing connection");
                    break;
                }
            }
            Ok(None) => {
                tracing::debug!("client disconnected");
                break;
            }
            Err(e) => {
                tracing::warn!(error = %e, "recv failed; closing connection");
                break;
            }
        }
    }
}

pub async fn handle_request(req: Request) -> Response {
    match req {
        Request::DaemonStatus => Response::Ok(serde_json::json!({
            "running": true,
            "pid": std::process::id(),
            "stub": true,
        })),
        Request::RecordStatus => Response::Ok(serde_json::json!({
            "recording": false,
        })),
        _ => Response::Err(IpcError {
            kind: IpcErrorKind::Internal,
            message: "not yet implemented".into(),
        }),
    }
}
```

- [ ] **Step 2: Create `bin/phoneme-daemon/src/ipc_server.rs`**

```rust
//! IPC server — bind a NamedPipeListener and spawn handlers.

use crate::app_state::AppState;
use crate::ipc_handler::handle_connection;
use phoneme_ipc::NamedPipeListener;

pub async fn serve(state: AppState) -> anyhow::Result<()> {
    let pipe_name = &state.config.daemon.pipe_name;
    let mut listener = NamedPipeListener::bind(pipe_name)
        .map_err(|e| anyhow::anyhow!("bind named pipe '{pipe_name}': {e}"))?;
    tracing::info!(pipe = %pipe_name, "IPC server listening");

    loop {
        let conn = match listener.accept().await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, "accept failed");
                continue;
            }
        };
        let state = state.clone();
        tokio::spawn(async move {
            handle_connection(conn, state).await;
        });
    }
}
```

- [ ] **Step 3: Wire into `main.rs`**

Update `bin/phoneme-daemon/src/main.rs`:

```rust
//! phoneme-daemon — the headless brain.

use anyhow::Result;
use clap::Parser;

mod app_state;
mod ipc_handler;
mod ipc_server;
mod lockfile;
mod logging;

use app_state::AppState;
use lockfile::Lockfile;

#[derive(Debug, Parser)]
#[command(name = "phoneme-daemon", version)]
struct Args {
    #[arg(long)]
    foreground: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let cfg = phoneme_core::Config::default();
    let state = AppState::new(cfg).await?;
    let _guard = logging::init(&state.config, &state.paths.log_dir, args.foreground)?;
    let _lock = Lockfile::acquire(&state.paths.lock_file)?;

    tracing::info!(
        audio_dir = %state.paths.audio_dir.display(),
        "phoneme-daemon ready"
    );

    ipc_server::serve(state).await?;
    Ok(())
}
```

- [ ] **Step 4: Verify the daemon accepts a real IPC client**

In one terminal: `cargo run -p phoneme-daemon -- --foreground`
In another, write a tiny ad-hoc client. Create a one-off test file:

`bin/phoneme-daemon/tests/smoke_status.rs`:

```rust
use phoneme_ipc::{NamedPipeTransport, Request, Response, Transport};

#[tokio::test]
#[ignore = "requires daemon running"]
async fn smoke_daemon_status() {
    let mut t = NamedPipeTransport::connect("phoneme-daemon").await.unwrap();
    let r = t.request(Request::DaemonStatus).await.unwrap();
    match r {
        Response::Ok(v) => {
            assert_eq!(v["running"], true);
        }
        _ => panic!("expected ok"),
    }
}
```

Run: `cargo test -p phoneme-daemon --test smoke_status -- --ignored --nocapture`
Expected: passes when the daemon is running in the other terminal. Stop the daemon afterward.

- [ ] **Step 5: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add IPC server skeleton (accepts connections, stub handlers)"
```

---

## Task 6: Event bus

**Files:**
- Create: `bin/phoneme-daemon/src/event_bus.rs`
- Modify: `bin/phoneme-daemon/src/app_state.rs`

The event bus is a `tokio::sync::broadcast::Sender<DaemonEvent>` shared across the AppState. Producers (recorder, queue worker, hook runner, llm supervisor) emit; consumers (`SubscribeEvents` IPC handlers) subscribe.

- [ ] **Step 1: Create `bin/phoneme-daemon/src/event_bus.rs`**

```rust
//! Daemon event bus — broadcast channel for `SubscribeEvents` consumers.

use phoneme_ipc::DaemonEvent;
use tokio::sync::broadcast;

const BUS_CAPACITY: usize = 64;

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<DaemonEvent>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BUS_CAPACITY);
        Self { tx }
    }

    /// Subscribe to events. Returns a new Receiver each call.
    pub fn subscribe(&self) -> broadcast::Receiver<DaemonEvent> {
        self.tx.subscribe()
    }

    /// Emit an event. Returns the receiver count for diagnostics; OK if zero.
    pub fn emit(&self, event: DaemonEvent) {
        let _ = self.tx.send(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use phoneme_core::RecordingId;

    #[tokio::test]
    async fn subscriber_receives_emitted_events() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        let id = RecordingId::new();
        bus.emit(DaemonEvent::TranscriptionStarted { id: id.clone() });
        let received = rx.recv().await.unwrap();
        assert!(matches!(received, DaemonEvent::TranscriptionStarted { id: rid } if rid == id));
    }

    #[tokio::test]
    async fn emit_with_no_subscribers_does_not_panic() {
        let bus = EventBus::new();
        bus.emit(DaemonEvent::LlmStatusChanged { reachable: false });
    }
}
```

- [ ] **Step 2: Add to AppState**

In `bin/phoneme-daemon/src/app_state.rs`, add the bus to the struct:

```rust
use crate::event_bus::EventBus;

// ... in AppState:
pub struct AppState {
    pub config: Arc<Config>,
    pub paths: Arc<ResolvedPaths>,
    pub catalog: Catalog,
    pub inbox: InboxQueue,
    pub events: EventBus,
}

// ... in AppState::new, return:
Ok(Self {
    config: Arc::new(config),
    paths: Arc::new(paths),
    catalog,
    inbox,
    events: EventBus::new(),
})
```

Also add `mod event_bus;` in `main.rs` alongside the other module declarations.

- [ ] **Step 3: Run tests**

Run: `cargo test -p phoneme-daemon event_bus::`
Expected: 2 tests pass.

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add EventBus (broadcast channel for DaemonEvents)"
```

---

## Task 7: Daemon-side recorder wrapper

**Files:**
- Create: `bin/phoneme-daemon/src/recorder.rs`
- Modify: `bin/phoneme-daemon/src/ipc_handler.rs`
- Modify: `bin/phoneme-daemon/src/app_state.rs`

Wraps `phoneme-audio::Recorder` with daemon-specific responsibilities: catalog row creation at start, WAV path resolution, inbox enqueueing on stop, event emission, single-active-recording enforcement.

- [ ] **Step 1: Create `bin/phoneme-daemon/src/recorder.rs`**

```rust
//! Daemon recorder — owns the active recording (at most one) and ties
//! capture lifecycle to the catalog and inbox.

use crate::app_state::AppState;
use chrono::Local;
use phoneme_audio::device::resolve_input_device;
use phoneme_audio::recorder::{Recorder, RecorderConfig, RecordingMode as AudioMode};
use phoneme_audio::source::CpalSource;
use phoneme_core::error::{Error, Result};
use phoneme_core::{HookMetadata, HookPayload, Recording, RecordingId, RecordingStatus};
use phoneme_ipc::DaemonEvent;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug)]
pub enum RecordMode {
    Hold,
    Oneshot,
    Duration { secs: u32 },
}

impl From<phoneme_core::RecordMode> for RecordMode {
    fn from(m: phoneme_core::RecordMode) -> Self {
        match m {
            phoneme_core::RecordMode::Hold => RecordMode::Hold,
            phoneme_core::RecordMode::Oneshot => RecordMode::Oneshot,
            phoneme_core::RecordMode::Duration { secs } => RecordMode::Duration { secs },
        }
    }
}

#[derive(Debug, Clone)]
pub struct ActiveRecording {
    pub id: RecordingId,
    pub mode: RecordMode,
    pub audio_path: PathBuf,
    pub started_at: chrono::DateTime<Local>,
}

#[derive(Clone, Default)]
pub struct DaemonRecorder {
    active: Arc<Mutex<Option<ActiveRecording>>>,
    handle: Arc<Mutex<Option<Recorder>>>,
}

impl DaemonRecorder {
    pub async fn current(&self) -> Option<ActiveRecording> {
        self.active.lock().await.clone()
    }

    /// Start a recording. Returns `AlreadyRecording` if one is in flight.
    pub async fn start(&self, state: &AppState, mode: RecordMode) -> Result<RecordingId> {
        let mut active = self.active.lock().await;
        if let Some(a) = active.as_ref() {
            return Err(Error::AlreadyRecording { current: a.id.to_string() });
        }
        let id = RecordingId::new();
        let started_at = Local::now();
        let audio_path = state
            .paths
            .audio_dir
            .join(id.day_folder())
            .join(format!("{}.wav", id.file_stem()));

        // Insert the catalog row at status=recording.
        let row = Recording {
            id: id.clone(),
            started_at,
            duration_ms: 0,
            audio_path: audio_path.to_string_lossy().into_owned(),
            transcript: None,
            model: None,
            status: RecordingStatus::Recording,
            error_kind: None,
            error_message: None,
            hook_command: None,
            hook_exit_code: None,
            hook_duration_ms: None,
            transcribed_at: None,
            hook_ran_at: None,
        };
        state.catalog.insert(&row).await?;

        // Open the CPAL device and the audio Recorder.
        let device = resolve_input_device(&state.config.recording.input_device)?;
        let source = CpalSource::open(device)?;
        let audio_mode = match mode {
            RecordMode::Hold => AudioMode::Hold,
            RecordMode::Oneshot => AudioMode::Oneshot,
            RecordMode::Duration { secs } => AudioMode::Duration { secs },
        };
        let recorder_cfg = RecorderConfig {
            mode: audio_mode,
            max_duration_ms: state.config.recording.max_duration_secs as u64 * 1000,
            silence_threshold_dbfs: state.config.recording.silence_threshold_dbfs,
            silence_window_ms: state.config.recording.silence_window_ms,
        };
        let recorder = Recorder::start(Box::new(source), recorder_cfg).await?;
        *self.handle.lock().await = Some(recorder);

        *active = Some(ActiveRecording {
            id: id.clone(),
            mode,
            audio_path,
            started_at,
        });

        state.events.emit(DaemonEvent::RecordingStarted {
            id: id.clone(),
            started_at,
        });
        tracing::info!(id = %id, mode = ?mode, "recording started");
        Ok(id)
    }

    /// Stop the current recording, write WAV, enqueue inbox, mark catalog
    /// row as transcribing.
    pub async fn stop(&self, state: &AppState) -> Result<RecordingId> {
        let mut active_lock = self.active.lock().await;
        let active = active_lock
            .take()
            .ok_or(Error::NotRecording)?;
        let recorder = self
            .handle
            .lock()
            .await
            .take()
            .ok_or(Error::NotRecording)?;
        let result = recorder.stop_and_finalize(&active.audio_path).await?;

        state.catalog.update_status(&active.id, RecordingStatus::Transcribing).await?;

        // Update duration too.
        sqlx_update_duration(&state.catalog, &active.id, result.duration_ms).await?;

        let payload = HookPayload {
            id: active.id.clone(),
            timestamp: active.started_at,
            transcript: String::new(),
            audio_path: active.audio_path.to_string_lossy().into_owned(),
            duration_ms: result.duration_ms,
            model: String::new(),
            metadata: HookMetadata::current(),
        };
        state.inbox.enqueue(&payload).await?;

        state.events.emit(DaemonEvent::RecordingStopped {
            id: active.id.clone(),
            duration_ms: result.duration_ms,
            audio_path: active.audio_path.to_string_lossy().into_owned(),
        });
        tracing::info!(id = %active.id, ms = result.duration_ms, "recording stopped");
        Ok(active.id)
    }

    /// Cancel the current recording: discard samples, delete catalog row, no
    /// WAV, no inbox.
    pub async fn cancel(&self, state: &AppState) -> Result<RecordingId> {
        let mut active_lock = self.active.lock().await;
        let active = active_lock.take().ok_or(Error::NotRecording)?;
        if let Some(recorder) = self.handle.lock().await.take() {
            let _ = recorder.cancel().await;
        }
        state.catalog.delete(&active.id).await?;
        Ok(active.id)
    }
}

// Small helper: we don't yet have a Catalog::update_duration method, so do
// a one-off here. Real Catalog method comes in Task 10.
async fn sqlx_update_duration(
    catalog: &phoneme_core::Catalog,
    id: &RecordingId,
    duration_ms: i64,
) -> Result<()> {
    // Reuse update_transcript to bump updated_at is hacky; we'll add the
    // proper method in Task 10. For now: insert via a raw query that
    // backwards-compatibly bumps just duration.
    use sqlx::Executor;
    let pool = catalog.pool_for_internal_use();
    pool.execute(
        sqlx::query("UPDATE recordings SET duration_ms = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(duration_ms)
            .bind(id.as_str()),
    )
    .await?;
    Ok(())
}
```

Note: this task introduces a `pool_for_internal_use()` accessor on `Catalog` we haven't built yet. Let's add it in the next step.

- [ ] **Step 2: Expose pool accessor on `Catalog`**

In `crates/phoneme-core/src/catalog.rs`, add a method:

```rust
impl Catalog {
    /// Internal accessor for daemon code that needs to run ad-hoc queries.
    /// Crate-private alternative: when the daemon needs a new query, add a
    /// method here. This is an escape hatch for the binary crate.
    pub fn pool_for_internal_use(&self) -> &sqlx::SqlitePool {
        &self.pool
    }
}
```

- [ ] **Step 3: Wire recorder into AppState**

Update `bin/phoneme-daemon/src/app_state.rs` to include the `DaemonRecorder`:

```rust
use crate::recorder::DaemonRecorder;

// In AppState struct:
pub recorder: DaemonRecorder,

// In AppState::new — return:
Ok(Self {
    config: Arc::new(config),
    paths: Arc::new(paths),
    catalog,
    inbox,
    events: EventBus::new(),
    recorder: DaemonRecorder::default(),
})
```

Add `mod recorder;` in `main.rs`.

- [ ] **Step 4: Wire IPC handlers**

Update `bin/phoneme-daemon/src/ipc_handler.rs`:

```rust
use crate::app_state::AppState;
use phoneme_core::RecordMode as CoreRecordMode;
use phoneme_ipc::{IpcError, IpcErrorKind, NamedPipeConnection, Request, Response};

pub async fn handle_connection(mut conn: NamedPipeConnection, state: AppState) {
    loop {
        match conn.recv().await {
            Ok(Some(req)) => {
                let response = handle_request(req, &state).await;
                if let Err(e) = conn.send_response(response).await {
                    tracing::warn!(error = %e, "send_response failed");
                    break;
                }
            }
            Ok(None) => break,
            Err(e) => {
                tracing::warn!(error = %e, "recv failed");
                break;
            }
        }
    }
}

pub async fn handle_request(req: Request, state: &AppState) -> Response {
    match req {
        Request::DaemonStatus => Response::Ok(serde_json::json!({
            "running": true,
            "pid": std::process::id(),
        })),
        Request::RecordStatus => {
            let active = state.recorder.current().await;
            Response::Ok(serde_json::json!({
                "recording": active.is_some(),
                "id": active.as_ref().map(|a| a.id.to_string()),
            }))
        }
        Request::RecordStart { mode } => match state.recorder.start(state, mode.into()).await {
            Ok(id) => Response::Ok(serde_json::json!({ "id": id.to_string() })),
            Err(e) => Response::Err(IpcError {
                kind: error_to_kind(&e),
                message: e.to_string(),
            }),
        },
        Request::RecordStop => match state.recorder.stop(state).await {
            Ok(id) => Response::Ok(serde_json::json!({ "id": id.to_string() })),
            Err(e) => Response::Err(IpcError {
                kind: error_to_kind(&e),
                message: e.to_string(),
            }),
        },
        Request::RecordCancel => match state.recorder.cancel(state).await {
            Ok(id) => Response::Ok(serde_json::json!({ "id": id.to_string() })),
            Err(e) => Response::Err(IpcError {
                kind: error_to_kind(&e),
                message: e.to_string(),
            }),
        },
        _ => Response::Err(IpcError {
            kind: IpcErrorKind::Internal,
            message: "not yet implemented".into(),
        }),
    }
}

fn error_to_kind(e: &phoneme_core::Error) -> IpcErrorKind {
    use phoneme_core::Error::*;
    match e {
        AlreadyRecording { .. } => IpcErrorKind::AlreadyRecording,
        NotRecording => IpcErrorKind::NotRecording,
        NotFound { .. } => IpcErrorKind::NotFound,
        InvalidConfig(_) => IpcErrorKind::InvalidConfig,
        LlmUnreachable { .. } => IpcErrorKind::LlmUnreachable,
        LlmTimeout { .. } => IpcErrorKind::LlmTimeout,
        HookFailed { .. } | HookTimeout { .. } => IpcErrorKind::HookFailed,
        DaemonNotRunning => IpcErrorKind::DaemonNotRunning,
        PipeInUse { .. } => IpcErrorKind::PipeInUse,
        ShuttingDown => IpcErrorKind::ShuttingDown,
        Io(_) => IpcErrorKind::Io,
        _ => IpcErrorKind::Internal,
    }
}

// Need a small adapter for the prelude conversion
impl From<phoneme_core::RecordMode> for crate::recorder::RecordMode {
    fn from(m: phoneme_core::RecordMode) -> Self {
        match m {
            CoreRecordMode::Hold => Self::Hold,
            CoreRecordMode::Oneshot => Self::Oneshot,
            CoreRecordMode::Duration { secs } => Self::Duration { secs },
        }
    }
}
```

> Note: the `From` impl is duplicated in `recorder.rs` from Step 1. Pick one
> location (recorder.rs is cleanest); remove from the other.

- [ ] **Step 5: Verify build**

Run: `cargo build -p phoneme-daemon`
Expected: clean build (CPAL device requirement may need real audio for `start` to succeed in manual testing; we'll handle the device-missing path in Task 9).

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-core/ bin/phoneme-daemon/
git commit -m "phoneme-daemon: add recorder integration + record start/stop/cancel IPC"
```

---

## Task 8: Transcription pipeline

**Files:**
- Create: `bin/phoneme-daemon/src/pipeline.rs`
- Create: `bin/phoneme-daemon/src/queue_worker.rs`
- Modify: `bin/phoneme-daemon/src/main.rs`

The queue worker watches `inbox/pending/`, claims the next item, calls the pipeline (transcribe → hook → done). On failure, the inbox entry moves to `failed/` and a retry timer fires.

- [ ] **Step 1: Create `bin/phoneme-daemon/src/pipeline.rs`**

```rust
//! Pipeline orchestration: transcribe → hook → done.
//!
//! Called by the queue worker per claimed payload.

use crate::app_state::AppState;
use phoneme_core::error::{Error, Result};
use phoneme_core::{HookMetadata, HookPayload, HookRunner, RecordingStatus, TranscriptionClient};
use phoneme_ipc::DaemonEvent;
use std::time::Duration;

/// Process a single claimed payload through the full pipeline.
///
/// Updates catalog, fires events, moves inbox files to done/ or failed/.
pub async fn run(state: &AppState, mut payload: HookPayload) -> Result<()> {
    let id = payload.id.clone();
    state.events.emit(DaemonEvent::TranscriptionStarted { id: id.clone() });

    // Transcribe.
    let cfg = &state.config;
    let client = TranscriptionClient::new(
        cfg.llm.external_url.clone(),
        Duration::from_secs(cfg.llm.timeout_secs),
    );
    let audio_path = std::path::Path::new(&payload.audio_path).to_path_buf();
    let transcript = match client.transcribe(&audio_path).await {
        Ok(t) => t,
        Err(e) => {
            state
                .catalog
                .update_status(&id, RecordingStatus::TranscribeFailed)
                .await?;
            state.inbox.finish_failed(&id, "llm_error", &e.to_string()).await?;
            state.events.emit(DaemonEvent::TranscriptionFailed {
                id: id.clone(),
                error: e.to_string(),
            });
            return Err(e);
        }
    };

    payload.transcript = transcript.clone();
    payload.model = cfg.llm.system_prompt.clone(); // placeholder; real model name comes from llm_supervisor in Task 12

    state
        .catalog
        .update_transcript(&id, &transcript, &payload.model)
        .await?;
    state
        .catalog
        .update_status(&id, RecordingStatus::HookRunning)
        .await?;
    state.events.emit(DaemonEvent::TranscriptionDone {
        id: id.clone(),
        transcript: transcript.clone(),
    });

    // Hook.
    state.events.emit(DaemonEvent::HookStarted { id: id.clone() });
    let runner = HookRunner::new(
        cfg.hook.command.clone(),
        Duration::from_secs(cfg.hook.timeout_secs),
    );
    payload.metadata = HookMetadata::current();
    match runner.run(&payload).await {
        Ok(result) => {
            state
                .catalog
                .update_hook_result(
                    &id,
                    &cfg.hook.command,
                    result.exit_code,
                    result.duration_ms,
                )
                .await?;
            state
                .catalog
                .update_status(&id, RecordingStatus::Done)
                .await?;
            state.inbox.finish_done(&id, &payload).await?;
            state.events.emit(DaemonEvent::HookDone {
                id,
                exit_code: result.exit_code,
            });
            Ok(())
        }
        Err(e) => {
            state
                .catalog
                .update_status(&id, RecordingStatus::HookFailed)
                .await?;
            state.inbox.finish_failed(&id, "hook_failed", &e.to_string()).await?;
            state.events.emit(DaemonEvent::HookFailed {
                id,
                error: e.to_string(),
            });
            Err(e)
        }
    }
}
```

- [ ] **Step 2: Create `bin/phoneme-daemon/src/queue_worker.rs`**

```rust
//! Queue worker — drains inbox/pending serially.
//!
//! Loop: claim_next → pipeline::run → emit QueueDepthChanged. On
//! transient failure (LlmUnreachable, LlmTimeout) sleep with exponential
//! backoff and retry.

use crate::app_state::AppState;
use crate::pipeline;
use phoneme_core::Error;
use phoneme_ipc::DaemonEvent;
use std::time::Duration;
use tokio::sync::watch;

pub async fn run(state: AppState, mut shutdown: watch::Receiver<bool>) -> anyhow::Result<()> {
    let mut backoff = Duration::from_secs(30);
    let max_backoff = Duration::from_secs(300);

    loop {
        if *shutdown.borrow() {
            tracing::info!("queue worker shutting down");
            return Ok(());
        }

        let claimed = state.inbox.claim_next().await?;
        match claimed {
            Some(payload) => {
                let counts = state.inbox.counts().await.unwrap_or_default();
                state.events.emit(DaemonEvent::QueueDepthChanged {
                    pending: counts.pending,
                    processing: counts.processing,
                    failed: counts.failed,
                });
                match pipeline::run(&state, payload).await {
                    Ok(()) => {
                        backoff = Duration::from_secs(30); // reset on success
                    }
                    Err(Error::LlmUnreachable { .. }) | Err(Error::LlmTimeout { .. }) => {
                        state.events.emit(DaemonEvent::LlmStatusChanged { reachable: false });
                        tracing::warn!(?backoff, "LLM unreachable; sleeping before retry");
                        tokio::select! {
                            _ = tokio::time::sleep(backoff) => {}
                            _ = shutdown.changed() => return Ok(()),
                        }
                        backoff = (backoff * 2).min(max_backoff);
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "pipeline error (non-transient)");
                    }
                }
            }
            None => {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                    _ = shutdown.changed() => return Ok(()),
                }
            }
        }
    }
}
```

- [ ] **Step 3: Spawn the worker in `main.rs`**

Update `bin/phoneme-daemon/src/main.rs`:

```rust
mod pipeline;
mod queue_worker;

// ... in main(), after creating AppState and acquiring lock:

let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
let worker_state = state.clone();
let worker_shutdown = shutdown_rx.clone();
let worker_handle = tokio::spawn(async move {
    if let Err(e) = queue_worker::run(worker_state, worker_shutdown).await {
        tracing::error!(error = %e, "queue worker terminated");
    }
});

// ... after ipc_server::serve(state).await:

let _ = shutdown_tx.send(true);
let _ = worker_handle.await;
```

(In practice `ipc_server::serve` loops forever, so the shutdown_tx send only happens on SIGINT/Ctrl+C; we'll formalize this in Task 11.)

- [ ] **Step 4: Verify it compiles**

Run: `cargo build -p phoneme-daemon`
Expected: clean build.

- [ ] **Step 5: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add pipeline (transcribe → hook) + queue worker with backoff"
```

---

## Task 9: Catalog query IPC handlers

**Files:**
- Modify: `bin/phoneme-daemon/src/ipc_handler.rs`
- Modify: `crates/phoneme-core/src/catalog.rs`

Adds: `ListRecordings`, `GetRecording`, `DeleteRecording`, `UpdateTranscript`, `ReplayRecording`, `RefireHook` IPC handlers. Each is a thin pass-through to a `Catalog` or `InboxQueue` method.

- [ ] **Step 1: Add proper `Catalog::update_duration_ms` and `update_started_at` methods**

In `crates/phoneme-core/src/catalog.rs`, alongside the existing update_* methods:

```rust
impl Catalog {
    pub async fn update_duration_ms(&self, id: &RecordingId, duration_ms: i64) -> Result<()> {
        sqlx::query(
            "UPDATE recordings SET duration_ms = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(duration_ms)
        .bind(id.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
```

And replace the ad-hoc `sqlx_update_duration` in `bin/phoneme-daemon/src/recorder.rs` with `state.catalog.update_duration_ms(...)`.

Remove the `pool_for_internal_use` accessor from Task 7 — no longer needed.

- [ ] **Step 2: Extend `handle_request`**

Modify `bin/phoneme-daemon/src/ipc_handler.rs` — add arms for the remaining requests:

```rust
Request::ListRecordings { filter } => match state.catalog.list(&filter).await {
    Ok(rows) => Response::Ok(serde_json::to_value(rows).unwrap_or(serde_json::Value::Null)),
    Err(e) => Response::Err(IpcError {
        kind: error_to_kind(&e),
        message: e.to_string(),
    }),
},
Request::GetRecording { id } => match state.catalog.get(&id).await {
    Ok(Some(r)) => Response::Ok(serde_json::to_value(r).unwrap_or(serde_json::Value::Null)),
    Ok(None) => Response::Err(IpcError {
        kind: IpcErrorKind::NotFound,
        message: format!("recording {id} not found"),
    }),
    Err(e) => Response::Err(IpcError {
        kind: error_to_kind(&e),
        message: e.to_string(),
    }),
},
Request::DeleteRecording { id, keep_audio } => {
    let get = state.catalog.get(&id).await;
    match get {
        Ok(Some(r)) => {
            let _ = state.catalog.delete(&id).await;
            if !keep_audio {
                let _ = tokio::fs::remove_file(&r.audio_path).await;
            }
            state.events.emit(DaemonEvent::RecordingDeleted { id });
            Response::Ok(serde_json::Value::Null)
        }
        Ok(None) => Response::Err(IpcError {
            kind: IpcErrorKind::NotFound,
            message: format!("recording {id} not found"),
        }),
        Err(e) => Response::Err(IpcError {
            kind: error_to_kind(&e),
            message: e.to_string(),
        }),
    }
}
Request::UpdateTranscript { id, text } => match state.catalog.update_transcript(&id, &text, "user-edit").await {
    Ok(()) => {
        state.events.emit(DaemonEvent::TranscriptUpdated { id });
        Response::Ok(serde_json::Value::Null)
    }
    Err(e) => Response::Err(IpcError {
        kind: error_to_kind(&e),
        message: e.to_string(),
    }),
},
Request::ReplayRecording { id } => {
    // Re-enqueue an existing recording for transcription.
    match state.catalog.get(&id).await {
        Ok(Some(r)) => {
            let payload = HookPayload {
                id: r.id.clone(),
                timestamp: r.started_at,
                transcript: String::new(),
                audio_path: r.audio_path.clone(),
                duration_ms: r.duration_ms,
                model: String::new(),
                metadata: HookMetadata::current(),
            };
            match state.inbox.enqueue(&payload).await {
                Ok(()) => {
                    let _ = state.catalog.update_status(&id, RecordingStatus::Transcribing).await;
                    Response::Ok(serde_json::Value::Null)
                }
                Err(e) => Response::Err(IpcError {
                    kind: error_to_kind(&e),
                    message: e.to_string(),
                }),
            }
        }
        Ok(None) => Response::Err(IpcError {
            kind: IpcErrorKind::NotFound,
            message: format!("recording {id} not found"),
        }),
        Err(e) => Response::Err(IpcError {
            kind: error_to_kind(&e),
            message: e.to_string(),
        }),
    }
}
Request::RefireHook { id } => {
    // Fire the hook against an existing recording's stored transcript.
    match state.catalog.get(&id).await {
        Ok(Some(r)) if r.transcript.is_some() => {
            let payload = HookPayload {
                id: r.id.clone(),
                timestamp: r.started_at,
                transcript: r.transcript.clone().unwrap_or_default(),
                audio_path: r.audio_path.clone(),
                duration_ms: r.duration_ms,
                model: r.model.clone().unwrap_or_default(),
                metadata: HookMetadata::current(),
            };
            let runner = HookRunner::new(
                state.config.hook.command.clone(),
                std::time::Duration::from_secs(state.config.hook.timeout_secs),
            );
            match runner.run(&payload).await {
                Ok(result) => {
                    let _ = state
                        .catalog
                        .update_hook_result(
                            &id,
                            &state.config.hook.command,
                            result.exit_code,
                            result.duration_ms,
                        )
                        .await;
                    let _ = state.catalog.update_status(&id, RecordingStatus::Done).await;
                    state.events.emit(DaemonEvent::HookDone {
                        id,
                        exit_code: result.exit_code,
                    });
                    Response::Ok(serde_json::Value::Null)
                }
                Err(e) => {
                    let _ = state.catalog.update_status(&id, RecordingStatus::HookFailed).await;
                    state.events.emit(DaemonEvent::HookFailed {
                        id,
                        error: e.to_string(),
                    });
                    Response::Err(IpcError {
                        kind: error_to_kind(&e),
                        message: e.to_string(),
                    })
                }
            }
        }
        Ok(Some(_)) => Response::Err(IpcError {
            kind: IpcErrorKind::Internal,
            message: "no transcript to fire hook against".into(),
        }),
        Ok(None) => Response::Err(IpcError {
            kind: IpcErrorKind::NotFound,
            message: format!("recording {id} not found"),
        }),
        Err(e) => Response::Err(IpcError {
            kind: error_to_kind(&e),
            message: e.to_string(),
        }),
    }
}
Request::HookTest => {
    let runner = HookRunner::new(
        state.config.hook.command.clone(),
        std::time::Duration::from_secs(state.config.hook.timeout_secs),
    );
    let sample = HookPayload {
        id: phoneme_core::RecordingId::new(),
        timestamp: chrono::Local::now(),
        transcript: "This is a test transcript for the hook.".into(),
        audio_path: String::new(),
        duration_ms: 0,
        model: "test".into(),
        metadata: HookMetadata::current(),
    };
    match runner.run(&sample).await {
        Ok(result) => Response::Ok(serde_json::json!({
            "exit_code": result.exit_code,
            "duration_ms": result.duration_ms,
            "stderr_tail": result.stderr_tail,
        })),
        Err(e) => Response::Err(IpcError {
            kind: error_to_kind(&e),
            message: e.to_string(),
        }),
    }
}
Request::Shutdown => {
    tracing::info!("shutdown requested via IPC");
    Response::Ok(serde_json::Value::Null)
    // Actual shutdown coordination in Task 11.
}
Request::ReloadConfig => Response::Err(IpcError {
    kind: IpcErrorKind::Internal,
    message: "reload_config not implemented in v1".into(),
}),
```

Also add the necessary imports at the top of the file:

```rust
use phoneme_core::{HookMetadata, HookPayload, HookRunner, RecordingStatus};
use phoneme_ipc::DaemonEvent;
```

- [ ] **Step 3: Verify build**

Run: `cargo build -p phoneme-daemon`
Expected: clean build.

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-core/ bin/phoneme-daemon/
git commit -m "phoneme-daemon: add catalog query + replay + refire-hook + hook-test IPC handlers"
```

---

## Task 10: `SubscribeEvents` streaming handler

**Files:**
- Modify: `bin/phoneme-daemon/src/ipc_handler.rs`

`SubscribeEvents` hijacks the connection: instead of one request → one response, we stream `DaemonEvent` JSONs forever until the client disconnects.

- [ ] **Step 1: Add the subscribe arm to `handle_connection`**

Modify `bin/phoneme-daemon/src/ipc_handler.rs` — restructure `handle_connection` so it handles `SubscribeEvents` specially:

```rust
pub async fn handle_connection(mut conn: NamedPipeConnection, state: AppState) {
    loop {
        match conn.recv().await {
            Ok(Some(Request::SubscribeEvents)) => {
                // Acknowledge the subscription.
                if let Err(e) = conn.send_response(Response::Ok(serde_json::json!({"subscribed": true}))).await {
                    tracing::warn!(error = %e, "subscribe ack failed");
                    return;
                }
                // Stream events.
                let mut rx = state.events.subscribe();
                loop {
                    match rx.recv().await {
                        Ok(event) => {
                            if let Err(e) = conn.send_event(event).await {
                                tracing::debug!(error = %e, "event send failed; subscriber gone");
                                return;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(lag = n, "event subscriber lagged");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                    }
                }
            }
            Ok(Some(req)) => {
                let response = handle_request(req, &state).await;
                if let Err(e) = conn.send_response(response).await {
                    tracing::warn!(error = %e, "send_response failed");
                    return;
                }
            }
            Ok(None) => return,
            Err(e) => {
                tracing::warn!(error = %e, "recv failed");
                return;
            }
        }
    }
}
```

- [ ] **Step 2: Verify build**

Run: `cargo build -p phoneme-daemon`
Expected: clean build.

- [ ] **Step 3: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 4: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add SubscribeEvents streaming handler"
```

---

## Task 11: Startup reconciliation + graceful shutdown

**Files:**
- Create: `bin/phoneme-daemon/src/reconcile.rs`
- Create: `bin/phoneme-daemon/src/shutdown.rs`
- Modify: `bin/phoneme-daemon/src/main.rs`

- [ ] **Step 1: Create `bin/phoneme-daemon/src/reconcile.rs`**

```rust
//! Startup reconciliation — recover from previous crashes.
//!
//! Per spec:
//! 1. Scan inbox/processing/ → move back to pending/ (Plan 1's recover_orphans).
//! 2. Sweep catalog rows in non-terminal status with no matching inbox → mark failed.
//! 3. Log warnings for orphan WAVs (no catalog row).

use crate::app_state::AppState;

pub async fn run(state: &AppState) -> anyhow::Result<()> {
    // Step 1: requeue inbox orphans.
    let orphans = state.inbox.recover_orphans().await?;
    if !orphans.is_empty() {
        tracing::warn!(count = orphans.len(), "recovered orphan inbox entries");
    }

    // Step 2: catalog sweep.
    let stale = sweep_stale_catalog_rows(state).await?;
    if stale > 0 {
        tracing::warn!(count = stale, "marked stale catalog rows as failed");
    }

    Ok(())
}

async fn sweep_stale_catalog_rows(state: &AppState) -> anyhow::Result<usize> {
    use phoneme_core::{ListFilter, RecordingStatus};

    let mut count = 0;
    for status in [
        RecordingStatus::Recording,
        RecordingStatus::Transcribing,
        RecordingStatus::HookRunning,
    ] {
        let rows = state
            .catalog
            .list(&ListFilter {
                status: Some(status),
                ..Default::default()
            })
            .await?;
        for row in rows {
            let processing_path = state
                .paths
                .inbox_dir
                .join("processing")
                .join(format!("{}.json", row.id));
            let pending_path = state
                .paths
                .inbox_dir
                .join("pending")
                .join(format!("{}.json", row.id));
            if !processing_path.exists() && !pending_path.exists() {
                let _ = state
                    .catalog
                    .update_status(&row.id, RecordingStatus::TranscribeFailed)
                    .await;
                count += 1;
            }
        }
    }
    Ok(count)
}
```

- [ ] **Step 2: Create `bin/phoneme-daemon/src/shutdown.rs`**

```rust
//! Graceful shutdown coordinator.
//!
//! Listens for SIGINT (Ctrl+C) and the IPC `Shutdown` request, flips a
//! watch channel that other tasks observe.

use tokio::sync::watch;

#[derive(Clone)]
pub struct ShutdownSignal {
    rx: watch::Receiver<bool>,
}

impl ShutdownSignal {
    /// `true` if shutdown has been signaled.
    pub fn is_shutting_down(&self) -> bool {
        *self.rx.borrow()
    }

    /// Wait until shutdown is signaled.
    pub async fn wait(&mut self) {
        while !*self.rx.borrow() {
            if self.rx.changed().await.is_err() {
                return;
            }
        }
    }
}

pub struct ShutdownCoordinator {
    tx: watch::Sender<bool>,
    pub signal: ShutdownSignal,
}

impl Default for ShutdownCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl ShutdownCoordinator {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(false);
        Self {
            tx,
            signal: ShutdownSignal { rx },
        }
    }

    pub fn trigger(&self) {
        let _ = self.tx.send(true);
    }

    /// Install Ctrl+C handler. Returns immediately after starting the
    /// background listener.
    pub fn install_signals(&self) {
        let tx = self.tx.clone();
        tokio::spawn(async move {
            if let Ok(()) = tokio::signal::ctrl_c().await {
                tracing::info!("Ctrl+C received");
                let _ = tx.send(true);
            }
        });
    }
}
```

- [ ] **Step 3: Wire into `main.rs`**

Update `bin/phoneme-daemon/src/main.rs`:

```rust
mod reconcile;
mod shutdown;

use shutdown::ShutdownCoordinator;

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let cfg = phoneme_core::Config::default();
    let state = AppState::new(cfg).await?;
    let _guard = logging::init(&state.config, &state.paths.log_dir, args.foreground)?;
    let _lock = Lockfile::acquire(&state.paths.lock_file)?;

    reconcile::run(&state).await?;

    let shutdown = ShutdownCoordinator::new();
    shutdown.install_signals();

    let worker_state = state.clone();
    let mut worker_signal = shutdown.signal.clone();
    let worker_handle = tokio::spawn(async move {
        if let Err(e) = queue_worker::run(worker_state, worker_signal_to_rx(worker_signal)).await {
            tracing::error!(error = %e, "queue worker terminated");
        }
    });

    let server_state = state.clone();
    let mut server_signal = shutdown.signal.clone();
    let server_handle = tokio::spawn(async move {
        tokio::select! {
            r = ipc_server::serve(server_state) => {
                if let Err(e) = r {
                    tracing::error!(error = %e, "ipc server failed");
                }
            }
            _ = server_signal.wait() => {
                tracing::info!("ipc server shutdown signaled");
            }
        }
    });

    tracing::info!("phoneme-daemon ready");
    let mut wait = shutdown.signal.clone();
    wait.wait().await;

    tracing::info!("shutting down");
    let _ = worker_handle.await;
    let _ = server_handle.await;
    Ok(())
}

// Adapter: the queue_worker takes a watch::Receiver<bool> directly; the
// ShutdownSignal wraps one. Convert.
fn worker_signal_to_rx(_signal: shutdown::ShutdownSignal) -> tokio::sync::watch::Receiver<bool> {
    // Future cleanup: change queue_worker::run to accept ShutdownSignal.
    // For now, expose the inner receiver via a method on ShutdownSignal.
    unimplemented!("convert ShutdownSignal to watch::Receiver — implement helper");
}
```

> Cleanup: refactor `ShutdownSignal` to expose its inner `watch::Receiver<bool>`
> publicly (or change `queue_worker::run` signature to accept
> `ShutdownSignal` directly). This is a small bookkeeping change — make the
> change in `shutdown.rs` so the helper above isn't `unimplemented!`.

- [ ] **Step 4: Resolve the shutdown receiver plumbing**

In `shutdown.rs`, expose:

```rust
impl ShutdownSignal {
    pub fn as_watch_receiver(&self) -> &watch::Receiver<bool> {
        &self.rx
    }

    pub fn clone_receiver(&self) -> watch::Receiver<bool> {
        self.rx.clone()
    }
}
```

In `main.rs`, replace the `worker_signal_to_rx` helper with `shutdown.signal.clone_receiver()` and pass that to `queue_worker::run`. Delete the `unimplemented!` helper.

- [ ] **Step 5: Verify build**

Run: `cargo build -p phoneme-daemon`
Expected: clean.

- [ ] **Step 6: Verify shutdown ergonomics manually**

Run: `cargo run -p phoneme-daemon -- --foreground`
Press Ctrl+C.
Expected: prints "Ctrl+C received" then "shutting down" then "phoneme-daemon ready" disappears. Process exits 0.

- [ ] **Step 7: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 8: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add startup reconciliation + graceful shutdown"
```

---

## Task 12: llama-server supervisor

**Files:**
- Create: `bin/phoneme-daemon/src/llm_supervisor.rs`
- Modify: `bin/phoneme-daemon/src/main.rs`
- Modify: `bin/phoneme-daemon/src/app_state.rs`

For `LlmMode::BundledModel` / `BundledDownload`: spawn `llama-server.exe` as a child, monitor it, restart on crash with backoff. For `LlmMode::External`: no-op (the user runs their own).

- [ ] **Step 1: Create `bin/phoneme-daemon/src/llm_supervisor.rs`**

```rust
//! llama-server supervisor — spawns and monitors the bundled binary.

use crate::app_state::AppState;
use crate::shutdown::ShutdownSignal;
use phoneme_core::config::LlmMode;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::{Child, Command};

const RESTART_BACKOFF_INITIAL: Duration = Duration::from_secs(2);
const RESTART_BACKOFF_MAX: Duration = Duration::from_secs(60);

pub async fn run(state: AppState, mut shutdown: ShutdownSignal) -> anyhow::Result<()> {
    if state.config.llm.mode == LlmMode::External {
        tracing::info!("llm.mode = external; supervisor is a no-op");
        return Ok(());
    }

    let server_path = locate_bundled_server()?;
    let model_path = state.config.llm.model_path.clone();
    if model_path.is_empty() {
        anyhow::bail!("llm.model_path is empty in bundled mode");
    }
    if !std::path::Path::new(&model_path).exists() {
        anyhow::bail!("llm.model_path does not exist: {model_path}");
    }
    let port = state.config.llm.bundled_server_port;

    let mut backoff = RESTART_BACKOFF_INITIAL;

    loop {
        if shutdown.is_shutting_down() {
            return Ok(());
        }

        let mut cmd = Command::new(&server_path);
        cmd.arg("--model")
            .arg(&model_path)
            .arg("--port")
            .arg(port.to_string())
            .arg("--host")
            .arg("127.0.0.1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for extra in &state.config.llm.bundled_server_args {
            cmd.arg(extra);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, "failed to spawn llama-server");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(RESTART_BACKOFF_MAX);
                continue;
            }
        };
        tracing::info!(pid = child.id().unwrap_or(0), "llama-server spawned");

        tokio::select! {
            wait = child.wait() => {
                match wait {
                    Ok(status) => tracing::warn!(?status, "llama-server exited"),
                    Err(e) => tracing::warn!(error = %e, "wait on llama-server failed"),
                }
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(RESTART_BACKOFF_MAX);
            }
            _ = shutdown.wait() => {
                tracing::info!("shutdown — killing llama-server");
                let _ = kill_gracefully(&mut child).await;
                return Ok(());
            }
        }
    }
}

async fn kill_gracefully(child: &mut Child) -> std::io::Result<()> {
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    Ok(())
}

/// Locate the bundled llama-server.exe. In the installed Phoneme this lives
/// in `Program Files\Phoneme\`. For dev builds, fall back to PATH.
fn locate_bundled_server() -> anyhow::Result<PathBuf> {
    let candidates = ["llama-server.exe", "llama-server"];
    // Try alongside our own executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for name in candidates {
                let p = parent.join(name);
                if p.exists() {
                    return Ok(p);
                }
            }
        }
    }
    // Fall back to PATH.
    for name in candidates {
        if let Ok(path) = which::which(name) {
            return Ok(path);
        }
    }
    anyhow::bail!("llama-server binary not found")
}
```

- [ ] **Step 2: Add `which` dependency**

In `bin/phoneme-daemon/Cargo.toml`:

```toml
which = "6"
```

- [ ] **Step 3: Wire supervisor into `main.rs`**

In `main.rs`, after spawning the worker:

```rust
mod llm_supervisor;

// ...
let supervisor_state = state.clone();
let supervisor_signal = shutdown.signal.clone();
let supervisor_handle = tokio::spawn(async move {
    if let Err(e) = llm_supervisor::run(supervisor_state, supervisor_signal).await {
        tracing::error!(error = %e, "llm supervisor terminated");
    }
});

// At shutdown:
let _ = supervisor_handle.await;
```

- [ ] **Step 4: Verify build**

Run: `cargo build -p phoneme-daemon`
Expected: clean.

In `LlmMode::External` (the default config), supervisor exits quietly. The supervisor's behavior in bundled mode is exercised by the integration tests in Task 14 by stubbing `locate_bundled_server` — to keep that testable, refactor as follows:

- [ ] **Step 5: Make supervisor testable**

Refactor `locate_bundled_server` to accept an override. Add to `LlmSupervisorConfig`:

```rust
pub struct LlmSupervisorConfig {
    pub mode: LlmMode,
    pub model_path: String,
    pub port: u16,
    pub bundled_server_args: Vec<String>,
    pub binary_override: Option<PathBuf>, // tests inject a fake
}

pub async fn run_with(state: AppState, cfg: LlmSupervisorConfig, mut shutdown: ShutdownSignal) -> anyhow::Result<()> {
    // ... same body, but use cfg.binary_override.or_else(locate_bundled_server)?
}

pub async fn run(state: AppState, shutdown: ShutdownSignal) -> anyhow::Result<()> {
    let cfg = LlmSupervisorConfig {
        mode: state.config.llm.mode.clone(),
        model_path: state.config.llm.model_path.clone(),
        port: state.config.llm.bundled_server_port,
        bundled_server_args: state.config.llm.bundled_server_args.clone(),
        binary_override: None,
    };
    run_with(state, cfg, shutdown).await
}
```

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add llama-server supervisor (modes 2/3, with restart backoff)"
```

---

## Task 13: Integration test harness

**Files:**
- Create: `bin/phoneme-daemon/tests/common/mod.rs`

The harness spins up a temp directory, a stubbed llama-server (wiremock), and the daemon itself. Returns a connected client + handles for assertions.

- [ ] **Step 1: Create `bin/phoneme-daemon/tests/common/mod.rs`**

```rust
//! Shared test harness for daemon integration tests.

use phoneme_ipc::{NamedPipeTransport, Transport};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tempfile::TempDir;
use tokio::process::{Child, Command};
use wiremock::matchers::{method, path as wm_path};
use wiremock::{Mock, MockServer, ResponseTemplate};

pub struct DaemonHarness {
    pub temp: TempDir,
    pub pipe_name: String,
    pub llm: MockServer,
    pub client: NamedPipeTransport,
    pub daemon: Child,
}

impl DaemonHarness {
    pub async fn start() -> Self {
        let temp = TempDir::new().unwrap();
        let pipe_name = format!("phoneme-test-{}", uuid_like());

        // Stub llama-server.
        let llm = MockServer::start().await;
        Mock::given(method("POST"))
            .and(wm_path("/v1/audio/transcriptions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "hello"})),
            )
            .mount(&llm)
            .await;

        // Generate a config that points at our stub.
        let mut cfg = phoneme_core::Config::default();
        cfg.llm.external_url = llm.uri();
        cfg.recording.audio_dir = temp.path().join("audio").to_string_lossy().into_owned();
        cfg.daemon.pipe_name = pipe_name.clone();
        let cfg_path = temp.path().join("config.toml");
        std::fs::write(&cfg_path, toml::to_string(&cfg).unwrap()).unwrap();

        // Spawn the daemon binary.
        let binary = env!("CARGO_BIN_EXE_phoneme-daemon");
        let daemon = Command::new(binary)
            .arg("--foreground")
            .env("PHONEME_CONFIG", &cfg_path)
            .env("PHONEME_DATA_LOCAL", temp.path().join("data"))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();

        // Wait for the pipe to come up.
        let client = wait_for_client(&pipe_name, Duration::from_secs(10)).await;

        Self { temp, pipe_name, llm, client, daemon }
    }

    pub fn data_local(&self) -> PathBuf {
        self.temp.path().join("data")
    }

    pub fn audio_dir(&self) -> PathBuf {
        self.temp.path().join("audio")
    }
}

impl Drop for DaemonHarness {
    fn drop(&mut self) {
        let _ = self.daemon.start_kill();
    }
}

async fn wait_for_client(name: &str, total: Duration) -> NamedPipeTransport {
    let start = std::time::Instant::now();
    while start.elapsed() < total {
        match NamedPipeTransport::connect(name).await {
            Ok(c) => return c,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        }
    }
    panic!("daemon never came up on pipe {name}");
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("{n:x}")
}
```

The daemon needs to honor `PHONEME_CONFIG` and `PHONEME_DATA_LOCAL` env vars — modify `main.rs` to read these:

- [ ] **Step 2: Honor test env vars in `main.rs`**

In `bin/phoneme-daemon/src/main.rs`, replace the hard-coded `Config::default()` with:

```rust
let cfg = load_config()?;

// ...

fn load_config() -> anyhow::Result<phoneme_core::Config> {
    if let Ok(p) = std::env::var("PHONEME_CONFIG") {
        return Ok(phoneme_core::Config::load(std::path::Path::new(&p))?);
    }
    Ok(phoneme_core::Config::default())
}
```

And in `AppState::new` (or in a new method), allow path override via env:

```rust
impl ResolvedPaths {
    pub fn from_config(cfg: &Config) -> anyhow::Result<Self> {
        // Honor PHONEME_DATA_LOCAL for tests.
        let data_local = if let Ok(p) = std::env::var("PHONEME_DATA_LOCAL") {
            std::path::PathBuf::from(p)
        } else {
            let dirs = directories::ProjectDirs::from("", "", "phoneme")
                .ok_or_else(|| anyhow::anyhow!("could not resolve project directories"))?;
            dirs.data_local_dir().to_path_buf()
        };

        let expanded = cfg.expanded()?;
        let audio_dir: PathBuf = expanded.recording.audio_dir.into();

        Ok(Self {
            audio_dir,
            inbox_dir: data_local.join("inbox"),
            catalog_db: data_local.join("catalog.db"),
            log_dir: data_local.join("logs"),
            lock_file: data_local.join(".lock"),
        })
    }
}
```

- [ ] **Step 3: Verify the harness compiles**

Run: `cargo build -p phoneme-daemon --tests`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add integration test harness (TempDir + wiremock + binary spawn)"
```

---

## Task 14: Integration test scenarios

**Files:**
- Create: `bin/phoneme-daemon/tests/basic_flow.rs`
- Create: `bin/phoneme-daemon/tests/llm_unreachable.rs`
- Create: `bin/phoneme-daemon/tests/hook_timeout.rs`
- Create: `bin/phoneme-daemon/tests/crash_recovery.rs`
- Create: `bin/phoneme-daemon/tests/concurrent_record.rs`
- Create: `bin/phoneme-daemon/tests/pipe_singleton.rs`
- Create: `bin/phoneme-daemon/tests/replay.rs`
- Create: `bin/phoneme-daemon/tests/event_stream.rs`
- Create: `bin/phoneme-daemon/tests/rebuild_catalog.rs`

Each scenario is a single test file using the harness. I'll show the first one in full detail; the rest follow the same pattern with different setup + assertions.

> **Important:** All integration tests in this task require a real microphone OR a refactor to inject the synthetic source. The cleanest split: tests that exercise the IPC + queue + transcription pipeline use the synthetic source via a special test-mode env var; tests that need real audio capture are marked `#[ignore]` and skipped in CI.
>
> Add a `PHONEME_TEST_SYNTHETIC_AUDIO=1` env var: when set, the daemon's recorder uses a `SyntheticSource` driven by a tokio mpsc channel exposed via an IPC `Request::TestPushAudio { samples }` variant (test-only, behind a `cfg(test)` feature flag). Implement this in `recorder.rs` and add the IPC variant gated by feature.
>
> This is meaningful additional plumbing — call it Task 14a, and only after it lands can scenarios actually run on CI without hardware.

- [ ] **Step 1: Add test-mode synthetic audio support to the daemon**

In `bin/phoneme-daemon/Cargo.toml`, add a `test-mode` feature:

```toml
[features]
test-mode = []
```

In `bin/phoneme-daemon/src/recorder.rs`, behind `#[cfg(feature = "test-mode")]`, add an alternative implementation that uses `SyntheticSource`. Add an IPC variant `Request::TestPushAudio { samples: Vec<i16> }` only under that feature.

Build the test binary with `cargo test -p phoneme-daemon --features test-mode`.

- [ ] **Step 2: Write `basic_flow.rs` — the canonical happy path**

```rust
mod common;
use common::DaemonHarness;
use phoneme_ipc::{Request, Response, Transport};
use phoneme_core::RecordMode;

#[tokio::test]
async fn basic_flow_records_transcribes_runs_hook() {
    let mut h = DaemonHarness::start().await;

    // Start a recording in oneshot mode.
    let r = h.client.request(Request::RecordStart { mode: RecordMode::Oneshot }).await.unwrap();
    assert!(matches!(r, Response::Ok(_)));

    // Push synthetic audio frames (test-mode IPC).
    let loud: Vec<i16> = (0..16000).map(|i| ((i as f32 * 0.05).sin() * 20000.0) as i16).collect();
    let silent: Vec<i16> = vec![0; 16000];
    // (use the test-mode TestPushAudio variant exposed only under feature flag)
    // ...

    // Subscribe to events, wait for HookDone.
    let mut events = h.client.subscribe().await.unwrap();
    use futures::StreamExt;
    let mut got_hook_done = false;
    for _ in 0..10 {
        if let Some(Ok(event)) = events.next().await {
            if let phoneme_ipc::DaemonEvent::HookDone { exit_code: 0, .. } = event {
                got_hook_done = true;
                break;
            }
        }
    }
    assert!(got_hook_done, "did not receive HookDone within 10 events");

    // Verify a catalog row exists with status=done.
    let listed = h.client
        .request(Request::ListRecordings { filter: phoneme_core::ListFilter::default() })
        .await
        .unwrap();
    match listed {
        Response::Ok(value) => {
            let arr = value.as_array().unwrap();
            assert_eq!(arr.len(), 1);
            assert_eq!(arr[0]["status"], "done");
        }
        _ => panic!("list failed"),
    }
}
```

- [ ] **Step 3: Write the remaining 8 scenarios**

Follow the same pattern. Per-scenario notes:

- **`llm_unreachable.rs`**: replace the wiremock's `respond_with(200)` with `respond_with(503)`. Verify recordings pile up in inbox/pending and `LlmStatusChanged { reachable: false }` is emitted. Switch the mock back to 200 and verify recovery.

- **`hook_timeout.rs`**: override the harness config to set `hook.command` to a script that sleeps 60s. Set `hook.timeout_secs = 2`. Verify the catalog row ends in `hook_failed` with the matching error_kind.

- **`crash_recovery.rs`**: start a recording, push a few audio frames, kill the daemon process with `start_kill()`. Restart the harness pointing at the same temp dir. Verify the inbox file moves from `processing/` to `pending/` and re-completes.

- **`concurrent_record.rs`**: send two `RecordStart` requests back-to-back. Assert the second returns `AlreadyRecording`.

- **`pipe_singleton.rs`**: start the harness once; try to spawn a second daemon process pointing at the same pipe name. Assert the second exits non-zero quickly.

- **`replay.rs`**: complete a recording, then send `ReplayRecording { id }`. Assert it re-enters the queue and re-emits `TranscriptionStarted`.

- **`event_stream.rs`**: subscribe; trigger a full record→transcribe→hook flow; assert the expected event sequence (`RecordingStarted`, `RecordingStopped`, `TranscriptionStarted`, `TranscriptionDone`, `HookStarted`, `HookDone`) arrives in order.

- **`rebuild_catalog.rs`**: complete a few recordings, then drop the catalog DB on disk, restart the daemon, send a hypothetical `Request::RebuildCatalog` (or invoke the same logic via direct API), assert the catalog reconstructs from inbox/done/*.json and audio_dir.

  - Note: `RebuildCatalog` is a CLI-only operation per spec; for the test, call the underlying function directly via a `cfg(test)` accessor or run the operation as a side door in `reconcile.rs`.

- [ ] **Step 4: Run all integration tests**

Run: `cargo test -p phoneme-daemon --features test-mode -- --test-threads=1`
Expected: all 9 scenarios pass. Total test count for this plan ≈ 30 (existing unit tests in modules + 9 scenarios).

- [ ] **Step 5: Lint**

Run: `cargo clippy -p phoneme-daemon --all-targets --features test-mode -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add bin/phoneme-daemon/
git commit -m "phoneme-daemon: add 9 end-to-end integration test scenarios"
```

---

## Task 15: README and final verification

**Files:**
- Create: `bin/phoneme-daemon/README.md`

- [ ] **Step 1: Write the README**

```markdown
# phoneme-daemon

The headless brain of [Phoneme](../../README.md). Owns audio capture, the
inbox queue, the SQLite catalog, and (in bundled modes) the llama-server
process. Exposes all operations over a Windows named-pipe IPC surface.

Clients: `phoneme` CLI (see `bin/phoneme/`), the Tauri tray app, and
external scripts using the `phoneme-ipc` crate.

## Modules

| Module | Responsibility |
|---|---|
| `app_state` | `AppState` and `ResolvedPaths` — central component holder |
| `lockfile` | PID lockfile (singleton enforcement layer 1) |
| `ipc_server` | Accept loop on `\\.\pipe\<name>` |
| `ipc_handler` | Request → Response routing + SubscribeEvents streaming |
| `recorder` | Daemon-side recorder wrapper (catalog + inbox integration) |
| `pipeline` | Transcribe → hook orchestration |
| `queue_worker` | Drains inbox/pending serially with exponential backoff |
| `event_bus` | Broadcast channel for SubscribeEvents consumers |
| `llm_supervisor` | Spawns + restarts llama-server in bundled modes |
| `reconcile` | Startup recovery: orphan inbox files, stale catalog rows |
| `shutdown` | Ctrl+C / IPC shutdown coordination |
| `logging` | Tracing setup (stderr foreground / JSON file background) |

## Running

```bash
# Foreground (development) — logs to stderr
cargo run -p phoneme-daemon -- --foreground

# Background (production) — logs to ~/AppData/Local/phoneme/logs/daemon.log
cargo run -p phoneme-daemon
```

Stop with Ctrl+C (foreground) or `phoneme daemon --stop` (CLI).

## Configuration

The daemon reads its config from one of:
- `$PHONEME_CONFIG` (if set; used by tests)
- `%APPDATA%\phoneme\config.toml` (production)
- Built-in defaults (if neither exists)

See the spec for full config keys.

## Integration tests

```bash
cargo test -p phoneme-daemon --features test-mode -- --test-threads=1
```

The tests spawn the daemon binary in a tempdir against a wiremock-stubbed
llama-server and a synthetic audio source. They cover the 9 scenarios from
spec Section "Daemon integration tests".

## Architecture

```
                  IPC server (named pipe)
                        │
                        │ accept → per-connection handler
                        ▼
                ┌───────────────────────────┐
                │       AppState (Arc)      │
                │  Catalog · InboxQueue ·   │
                │  Config · EventBus ·      │
                │  DaemonRecorder           │
                └───────────────────────────┘
                   │                  │
                   ▼                  ▼
              Queue worker        LLM supervisor
                   │                (modes 2/3)
                   ▼
              Pipeline:
              transcribe → hook → done
```
```

- [ ] **Step 2: Workspace verification**

```bash
cargo test --workspace --features phoneme-daemon/test-mode -- --test-threads=1
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cargo build --workspace --release
```

Expected: all pass.

- [ ] **Step 3: Mark Plan 3a complete**

```bash
git add bin/phoneme-daemon/README.md
git commit -m "phoneme-daemon: add README"
git commit --allow-empty -m "milestone: Plan 3a complete (phoneme-daemon green)"
git log --oneline | head -30
```

---

## Plan-level self-review

- **Spec coverage:**
  - Milestone 9 (daemon wiring + integration tests) → Tasks 1–14 ✓
  - Milestone 11 (llama-server supervisor) → Task 12 ✓
  - Spec's 9 integration test scenarios → Task 14 (each gets its own file) ✓
  - Singleton enforcement → Task 4 (lockfile) + Plan 2's `first_pipe_instance` ✓
  - Startup reconciliation → Task 11 ✓
  - Graceful shutdown → Task 11 ✓
  - SubscribeEvents streaming → Task 10 ✓

- **Spec deviations:**
  - The daemon honors `PHONEME_CONFIG` and `PHONEME_DATA_LOCAL` env vars; not in spec but needed for testability. Documented in README.
  - Adds a `test-mode` Cargo feature for the test-only synthetic audio source. Production builds never enable it.

- **Open items deferred to execution:**
  - `RebuildCatalog` IPC variant (or CLI-only handler) — fully implemented in Plan 3b's CLI plus a side-door in `reconcile.rs`.
  - The integration test for `crash_recovery.rs` relies on cleanly killing the daemon process — Windows process tree handling may need extra care (the `Drop` impl on `DaemonHarness` uses `start_kill`, which may leave the llama-server stub alive briefly; document this if flaky).

---

## End of Plan 3a
