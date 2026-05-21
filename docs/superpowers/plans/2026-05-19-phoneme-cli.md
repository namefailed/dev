# Phoneme — Plan 3b: `phoneme` CLI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `phoneme` command-line interface — a thin IPC client to `phoneme-daemon`. Every CLI command opens the named pipe, sends one request, prints the response, and exits with a spec-defined exit code. Auto-spawns the daemon if it's not running.

**Depends on:** Plans 1, 2, and 3a complete.

**Architecture:** Single binary at `bin/phoneme`. Clap-derived subcommand router. Each subcommand has a `run(args, client) -> ExitCode` function. Output formatting is centralised in `output.rs` (pretty table by default, JSON-lines with `--json`). Auto-spawn lives in `auto_spawn.rs` (try connect → if pipe missing, fork `phoneme-daemon --start` detached → poll up to 3 seconds).

**Tech stack:** clap 4 (derive), comfy-table (pretty table output), colored 2 (ANSI colors), insta (snapshot tests), atty (TTY detection for color suppression), plus everything from Plans 1, 2, 3a.

**Spec reference:** `~/dev/phoneme/docs/superpowers/specs/2026-05-19-phoneme-design.md` — milestone 10.

---

## File structure for this plan

```
bin/
└── phoneme/
    ├── Cargo.toml                            [create]
    ├── README.md                             [create]
    ├── src/
    │   ├── main.rs                           [create — entrypoint, dispatch]
    │   ├── args.rs                           [create — clap definitions]
    │   ├── exit.rs                           [create — exit code mapping]
    │   ├── client.rs                         [create — IPC client wrapper]
    │   ├── auto_spawn.rs                     [create — daemon auto-launch]
    │   ├── output.rs                         [create — table + JSON formatting]
    │   └── commands/
    │       ├── mod.rs                        [create]
    │       ├── record.rs                     [create]
    │       ├── list.rs                       [create]
    │       ├── show.rs                       [create]
    │       ├── replay.rs                     [create]
    │       ├── delete.rs                     [create]
    │       ├── doctor.rs                     [create]
    │       ├── config_cmd.rs                 [create]
    │       ├── daemon_cmd.rs                 [create]
    │       ├── watch.rs                      [create]
    │       ├── hook_cmd.rs                   [create]
    │       └── version.rs                    [create]
    └── tests/
        ├── snapshots.rs                      [create]
        └── snapshots/                        [create — golden files]
```

Modifications:
- `Cargo.toml` (workspace) — add `"bin/phoneme"` to `members`. Add `comfy-table = "7"`, `colored = "2"`, `insta = "1"`, `atty = "0.2"` to `workspace.dependencies`.

---

## Task 1: Workspace add + CLI scaffold + clap router

**Files:**
- Modify: `Cargo.toml` (workspace)
- Create: `bin/phoneme/Cargo.toml`
- Create: `bin/phoneme/src/args.rs`
- Create: `bin/phoneme/src/main.rs`

- [ ] **Step 1: Workspace changes**

In root `Cargo.toml`:
- Add `"bin/phoneme"` to `[workspace] members`.
- Append to `[workspace.dependencies]`:

```toml
comfy-table = "7"
colored = "2"
insta = "1"
atty = "0.2"
```

- [ ] **Step 2: `bin/phoneme/Cargo.toml`**

```toml
[package]
name = "phoneme"
version.workspace = true
edition.workspace = true
license.workspace = true

[[bin]]
name = "phoneme"
path = "src/main.rs"

[dependencies]
phoneme-core = { path = "../../crates/phoneme-core" }
phoneme-ipc = { path = "../../crates/phoneme-ipc" }
anyhow.workspace = true
thiserror.workspace = true
serde.workspace = true
serde_json.workspace = true
tokio.workspace = true
clap.workspace = true
comfy-table.workspace = true
colored.workspace = true
atty.workspace = true
chrono.workspace = true
tracing.workspace = true

[dev-dependencies]
insta.workspace = true
tempfile.workspace = true
assert_cmd = "2"
predicates = "3"
```

- [ ] **Step 3: `bin/phoneme/src/args.rs`**

```rust
//! Clap definitions for every `phoneme` subcommand.

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "phoneme", version, about = "Phoneme CLI", long_about = None)]
pub struct Cli {
    /// Disable colored output (or set NO_COLOR=1).
    #[arg(long, global = true)]
    pub no_color: bool,

    /// JSON-lines output where supported.
    #[arg(long, global = true)]
    pub json: bool,

    /// Verbose tracing to stderr.
    #[arg(short, long, global = true)]
    pub verbose: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Push-to-talk: read stdin until EOF / Enter, then stop.
    Record(RecordArgs),
    /// List recordings.
    List(ListArgs),
    /// Show one recording.
    Show(ShowArgs),
    /// Re-transcribe a saved recording.
    Replay(IdArgs),
    /// Delete a recording.
    Delete(DeleteArgs),
    /// Health check.
    Doctor(DoctorArgs),
    /// Configuration management.
    Config(ConfigArgs),
    /// Daemon control.
    Daemon(DaemonArgs),
    /// Subscribe to the daemon's event stream.
    Watch,
    /// Test the configured hook.
    Hook(HookArgs),
    /// Print version + commit info.
    Version,
}

#[derive(Debug, clap::Args)]
pub struct RecordArgs {
    /// One-shot: stop on silence.
    #[arg(long, conflicts_with_all = ["start", "stop", "cancel", "duration"])]
    pub oneshot: bool,
    /// Record exactly N seconds.
    #[arg(long, value_name = "SECS")]
    pub duration: Option<u32>,
    /// Non-blocking: begin recording, exit 0.
    #[arg(long, conflicts_with_all = ["stop", "cancel", "oneshot", "duration"])]
    pub start: bool,
    /// Non-blocking: stop the active recording, exit 0.
    #[arg(long, conflicts_with_all = ["start", "cancel", "oneshot", "duration"])]
    pub stop: bool,
    /// Discard the active recording without saving.
    #[arg(long, conflicts_with_all = ["start", "stop", "oneshot", "duration"])]
    pub cancel: bool,
}

#[derive(Debug, clap::Args)]
pub struct ListArgs {
    #[arg(long, value_name = "N")]
    pub limit: Option<u32>,
    /// ISO 8601 date (e.g. 2026-05-19).
    #[arg(long)]
    pub since: Option<String>,
    /// Filter by status.
    #[arg(long)]
    pub status: Option<String>,
    /// Search transcripts via FTS5.
    #[arg(long)]
    pub search: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct ShowArgs {
    pub id: String,
    /// Print only the audio path (useful for shell piping).
    #[arg(long)]
    pub audio_path_only: bool,
}

#[derive(Debug, clap::Args)]
pub struct IdArgs {
    pub id: String,
}

#[derive(Debug, clap::Args)]
pub struct DeleteArgs {
    pub id: String,
    #[arg(long)]
    pub keep_audio: bool,
}

#[derive(Debug, clap::Args)]
pub struct DoctorArgs {
    /// Rebuild the catalog from inbox + audio_dir.
    #[arg(long)]
    pub rebuild_catalog: bool,
}

#[derive(Debug, clap::Args)]
pub struct ConfigArgs {
    #[command(subcommand)]
    pub action: Option<ConfigAction>,
}

#[derive(Debug, Subcommand)]
pub enum ConfigAction {
    /// Set a config value: `phoneme config set llm.mode external`.
    Set { key: String, value: String },
    /// Print the config file path.
    Path,
}

#[derive(Debug, clap::Args)]
pub struct DaemonArgs {
    #[command(subcommand)]
    pub action: Option<DaemonAction>,
}

#[derive(Debug, Subcommand)]
pub enum DaemonAction {
    /// Spawn the daemon detached, exit 0.
    Start,
    /// Send shutdown IPC, exit 0.
    Stop,
    /// Print daemon status.
    Status,
}

#[derive(Debug, clap::Args)]
pub struct HookArgs {
    #[command(subcommand)]
    pub action: HookAction,
}

#[derive(Debug, Subcommand)]
pub enum HookAction {
    /// Run the configured hook with a sample payload.
    Test,
}
```

- [ ] **Step 4: `bin/phoneme/src/main.rs`**

```rust
//! phoneme CLI entrypoint.

use anyhow::Result;
use clap::Parser;

mod args;

use args::{Cli, Command};

#[tokio::main]
async fn main() -> Result<std::process::ExitCode> {
    let cli = Cli::parse();
    if cli.no_color {
        colored::control::set_override(false);
    }
    if cli.verbose {
        tracing_subscriber::fmt()
            .with_writer(std::io::stderr)
            .init();
    }
    match cli.command {
        Command::Version => {
            println!("phoneme {}", env!("CARGO_PKG_VERSION"));
            Ok(std::process::ExitCode::SUCCESS)
        }
        _ => {
            eprintln!("phoneme stub — wiring to come");
            Ok(std::process::ExitCode::SUCCESS)
        }
    }
}
```

- [ ] **Step 5: Verify it builds and `--help` works**

Run: `cargo build -p phoneme`
Expected: clean build.

Run: `cargo run -p phoneme -- --help`
Expected: prints the full subcommand list.

Run: `cargo run -p phoneme -- version`
Expected: prints `phoneme 1.0.0-dev` (or whatever version is in workspace.package).

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml bin/phoneme/
git commit -m "scaffold phoneme CLI with clap subcommand router"
```

---

## Task 2: IPC client wrapper + exit code mapping

**Files:**
- Create: `bin/phoneme/src/exit.rs`
- Create: `bin/phoneme/src/client.rs`

The CLI's relationship with the daemon's IPC is mediated by a thin wrapper that:
1. Opens a `NamedPipeTransport` to the daemon's pipe name (default `phoneme-daemon`).
2. Sends one request, awaits one response.
3. Maps `Response::Err` kinds to CLI exit codes.

- [ ] **Step 1: Create `bin/phoneme/src/exit.rs`**

```rust
//! Spec-defined CLI exit codes.

use phoneme_ipc::IpcErrorKind;

pub const SUCCESS: u8 = 0;
pub const GENERIC_FAIL: u8 = 1;
pub const USAGE_ERROR: u8 = 2;
pub const DAEMON_NOT_REACHABLE: u8 = 3;
pub const LLM_UNREACHABLE: u8 = 4;
pub const HOOK_FAILED: u8 = 5;
pub const INVALID_CONFIG: u8 = 6;
pub const NOT_FOUND: u8 = 7;

pub fn from_ipc_kind(kind: IpcErrorKind) -> u8 {
    match kind {
        IpcErrorKind::DaemonNotRunning | IpcErrorKind::PipeInUse | IpcErrorKind::ShuttingDown => {
            DAEMON_NOT_REACHABLE
        }
        IpcErrorKind::LlmUnreachable | IpcErrorKind::LlmTimeout => LLM_UNREACHABLE,
        IpcErrorKind::HookFailed => HOOK_FAILED,
        IpcErrorKind::InvalidConfig => INVALID_CONFIG,
        IpcErrorKind::NotFound => NOT_FOUND,
        _ => GENERIC_FAIL,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_maps_to_known_code() {
        assert_eq!(from_ipc_kind(IpcErrorKind::DaemonNotRunning), DAEMON_NOT_REACHABLE);
        assert_eq!(from_ipc_kind(IpcErrorKind::LlmUnreachable), LLM_UNREACHABLE);
        assert_eq!(from_ipc_kind(IpcErrorKind::HookFailed), HOOK_FAILED);
        assert_eq!(from_ipc_kind(IpcErrorKind::InvalidConfig), INVALID_CONFIG);
        assert_eq!(from_ipc_kind(IpcErrorKind::NotFound), NOT_FOUND);
        assert_eq!(from_ipc_kind(IpcErrorKind::Internal), GENERIC_FAIL);
    }
}
```

- [ ] **Step 2: Create `bin/phoneme/src/client.rs`**

```rust
//! Thin IPC client wrapper.
//!
//! Resolves the pipe name from config (or default), connects with retry,
//! and exposes `send_request` returning a Result<serde_json::Value, ExitCode>.

use crate::auto_spawn;
use crate::exit;
use phoneme_core::Config;
use phoneme_ipc::{IpcErrorKind, NamedPipeTransport, Request, Response, Transport};
use std::process::ExitCode;

pub struct Client {
    transport: NamedPipeTransport,
}

impl Client {
    /// Connect to the daemon. If absent, auto-spawn and retry. Returns an
    /// ExitCode if we ultimately can't reach the daemon.
    pub async fn connect(cfg: &Config) -> Result<Self, ExitCode> {
        let pipe_name = &cfg.daemon.pipe_name;
        match NamedPipeTransport::connect(pipe_name).await {
            Ok(t) => Ok(Self { transport: t }),
            Err(_) => {
                if let Err(e) = auto_spawn::ensure_running(cfg).await {
                    eprintln!("error: failed to auto-spawn daemon: {e}");
                    return Err(ExitCode::from(exit::DAEMON_NOT_REACHABLE));
                }
                NamedPipeTransport::connect(pipe_name).await.map(|t| Self { transport: t }).map_err(|e| {
                    eprintln!("error: daemon not reachable: {e}");
                    ExitCode::from(exit::DAEMON_NOT_REACHABLE)
                })
            }
        }
    }

    /// Send a request and decode the response. On `Response::Err`, prints the
    /// error to stderr and returns the appropriate exit code.
    pub async fn send(&mut self, req: Request) -> Result<serde_json::Value, ExitCode> {
        match self.transport.request(req).await {
            Ok(Response::Ok(v)) => Ok(v),
            Ok(Response::Err(e)) => {
                eprintln!("error: {}", e.message);
                Err(ExitCode::from(exit::from_ipc_kind(e.kind)))
            }
            Err(e) => {
                eprintln!("error: transport: {e}");
                Err(ExitCode::from(exit::DAEMON_NOT_REACHABLE))
            }
        }
    }

    /// Send and ignore the response (for fire-and-forget requests).
    pub async fn send_silent(&mut self, req: Request) -> Result<(), ExitCode> {
        self.send(req).await.map(|_| ())
    }

    /// Subscribe to events; useful for `--oneshot` waiting + `phoneme watch`.
    pub async fn subscribe(
        &mut self,
    ) -> Result<futures::stream::BoxStream<'static, phoneme_ipc::TransportResult<phoneme_ipc::DaemonEvent>>, ExitCode>
    {
        self.transport.subscribe().await.map_err(|e| {
            eprintln!("error: subscribe: {e}");
            ExitCode::from(exit::DAEMON_NOT_REACHABLE)
        })
    }
}
```

- [ ] **Step 3: Verify build**

Run: `cargo build -p phoneme`
Expected: error about missing `auto_spawn` module — that's intentional; we wire it next.

- [ ] **Step 4: Commit (will compile after Task 3)**

```bash
git add bin/phoneme/
git commit -m "phoneme: add IPC client wrapper + exit code mapping (compiles after Task 3)"
```

---

## Task 3: Auto-spawn the daemon

**Files:**
- Create: `bin/phoneme/src/auto_spawn.rs`
- Modify: `bin/phoneme/src/main.rs`

- [ ] **Step 1: Create `bin/phoneme/src/auto_spawn.rs`**

```rust
//! Auto-spawn the daemon when the CLI can't reach it.

use phoneme_core::Config;
use phoneme_ipc::NamedPipeTransport;
use std::process::Stdio;
use std::time::Duration;

const POLL_TOTAL: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Ensure the daemon is reachable. If not, spawn it detached and poll the
/// pipe for `POLL_TOTAL` before giving up.
pub async fn ensure_running(cfg: &Config) -> anyhow::Result<()> {
    if NamedPipeTransport::connect(&cfg.daemon.pipe_name).await.is_ok() {
        return Ok(());
    }

    // Spawn detached.
    let exe = which::which("phoneme-daemon")
        .or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("phoneme-daemon.exe")))
                .ok_or_else(|| anyhow::anyhow!("phoneme-daemon not found on PATH or next to phoneme.exe"))
        })?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new(&exe)
            .creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
    }

    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new(&exe)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
    }

    // Poll for readiness.
    let start = std::time::Instant::now();
    while start.elapsed() < POLL_TOTAL {
        if NamedPipeTransport::connect(&cfg.daemon.pipe_name).await.is_ok() {
            return Ok(());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    anyhow::bail!("daemon did not come up within {:?}", POLL_TOTAL)
}
```

- [ ] **Step 2: Add `which` to `bin/phoneme/Cargo.toml`**

```toml
which = "6"
```

- [ ] **Step 3: Wire modules into `main.rs`**

Replace `bin/phoneme/src/main.rs`:

```rust
//! phoneme CLI entrypoint.

use anyhow::Result;
use clap::Parser;
use std::process::ExitCode;

mod args;
mod auto_spawn;
mod client;
mod exit;
mod output;

use args::{Cli, Command};

#[tokio::main]
async fn main() -> Result<ExitCode> {
    let cli = Cli::parse();
    if cli.no_color || std::env::var("NO_COLOR").is_ok() {
        colored::control::set_override(false);
    }
    if cli.verbose {
        tracing_subscriber::fmt().with_writer(std::io::stderr).init();
    }

    let cfg = load_config()?;
    let exit_code = dispatch(cli, &cfg).await;
    Ok(exit_code)
}

async fn dispatch(cli: Cli, cfg: &phoneme_core::Config) -> ExitCode {
    match cli.command {
        Command::Version => {
            println!("phoneme {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        // Other commands wired in subsequent tasks.
        _ => {
            eprintln!("phoneme: command not yet implemented");
            ExitCode::from(exit::GENERIC_FAIL)
        }
    }
}

fn load_config() -> Result<phoneme_core::Config> {
    if let Some(p) = phoneme_core::config::default_config_path() {
        if p.exists() {
            return Ok(phoneme_core::Config::load(&p)?);
        }
    }
    Ok(phoneme_core::Config::default())
}
```

Also stub `bin/phoneme/src/output.rs` so the module compiles:

```rust
//! Output formatting — pretty tables + JSON-lines. Fully implemented in
//! later tasks.
```

- [ ] **Step 4: Verify build**

Run: `cargo build -p phoneme`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add bin/phoneme/
git commit -m "phoneme: add auto-spawn + module wiring for upcoming commands"
```

---

## Task 4: Output formatting (table + JSON)

**Files:**
- Modify: `bin/phoneme/src/output.rs`

- [ ] **Step 1: Replace `output.rs` contents**

```rust
//! Output formatting — pretty tables (comfy-table) + JSON-lines.

use comfy_table::{presets::UTF8_FULL, ContentArrangement, Table};
use phoneme_core::Recording;
use serde_json::Value;

/// Print one recording in pretty form.
pub fn print_recording_pretty(r: &Recording) {
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic);
    table.add_row(vec!["id", r.id.as_str()]);
    table.add_row(vec!["started_at", &r.started_at.to_rfc3339()]);
    table.add_row(vec!["duration", &format_duration(r.duration_ms)]);
    table.add_row(vec!["status", r.status.as_str()]);
    table.add_row(vec!["audio_path", &r.audio_path]);
    if let Some(t) = &r.transcript {
        table.add_row(vec!["transcript", t]);
    }
    if let Some(ek) = &r.error_kind {
        table.add_row(vec!["error_kind", ek]);
    }
    if let Some(em) = &r.error_message {
        table.add_row(vec!["error_message", em]);
    }
    println!("{table}");
}

/// Print a list of recordings as a table.
pub fn print_list_pretty(rows: &[Recording]) {
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic);
    table.set_header(vec!["time", "dur", "status", "transcript"]);
    for r in rows {
        let preview = match &r.transcript {
            Some(t) if t.len() > 60 => format!("{}…", &t[..60]),
            Some(t) => t.clone(),
            None => String::new(),
        };
        table.add_row(vec![
            r.started_at.format("%Y-%m-%d %H:%M:%S").to_string(),
            format_duration(r.duration_ms),
            r.status.as_str().to_string(),
            preview,
        ]);
    }
    println!("{table}");
}

/// Print as JSON-lines (one row per line).
pub fn print_json_lines<T: serde::Serialize>(items: &[T]) {
    for item in items {
        if let Ok(line) = serde_json::to_string(item) {
            println!("{line}");
        }
    }
}

/// Print a JSON value as a single line.
pub fn print_json(value: &Value) {
    if let Ok(s) = serde_json::to_string(value) {
        println!("{s}");
    }
}

pub fn format_duration(ms: i64) -> String {
    let total_secs = ms / 1000;
    let mins = total_secs / 60;
    let secs = total_secs % 60;
    let frac = (ms % 1000) / 100;
    if mins > 0 {
        format!("{mins}m{secs:02}.{frac}s")
    } else {
        format!("{secs}.{frac}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_duration_seconds_only() {
        assert_eq!(format_duration(8470), "8.4s");
    }

    #[test]
    fn format_duration_minutes() {
        assert_eq!(format_duration(125_300), "2m05.3s");
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p phoneme output::`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add bin/phoneme/
git commit -m "phoneme: add output formatting (comfy-table + JSON-lines)"
```

---

## Task 5: Record subcommands

**Files:**
- Create: `bin/phoneme/src/commands/mod.rs`
- Create: `bin/phoneme/src/commands/record.rs`
- Modify: `bin/phoneme/src/main.rs`

- [ ] **Step 1: Create commands module entry**

`bin/phoneme/src/commands/mod.rs`:

```rust
pub mod record;
```

- [ ] **Step 2: Create `bin/phoneme/src/commands/record.rs`**

```rust
use crate::args::RecordArgs;
use crate::client::Client;
use crate::exit;
use phoneme_core::{Config, RecordMode};
use phoneme_ipc::{DaemonEvent, Request};
use std::process::ExitCode;
use futures::StreamExt;

pub async fn run(args: RecordArgs, cfg: &Config, json: bool) -> ExitCode {
    let mut client = match Client::connect(cfg).await {
        Ok(c) => c,
        Err(code) => return code,
    };

    // Non-blocking variants first.
    if args.start {
        return single_request(&mut client, Request::RecordStart { mode: RecordMode::Hold }, json).await;
    }
    if args.stop {
        return single_request(&mut client, Request::RecordStop, json).await;
    }
    if args.cancel {
        return single_request(&mut client, Request::RecordCancel, json).await;
    }

    // Oneshot / Duration / Hold-via-stdin all block on the event stream.
    let mode = if args.oneshot {
        RecordMode::Oneshot
    } else if let Some(secs) = args.duration {
        RecordMode::Duration { secs }
    } else {
        RecordMode::Hold
    };

    if let Err(code) = client.send_silent(Request::RecordStart { mode }).await {
        return code;
    }

    if matches!(mode, RecordMode::Hold) {
        // Wait for the user to hit Enter or close stdin.
        use tokio::io::{AsyncBufReadExt, BufReader};
        let stdin = tokio::io::stdin();
        let mut reader = BufReader::new(stdin);
        let mut line = String::new();
        let _ = reader.read_line(&mut line).await;
        if let Err(code) = client.send_silent(Request::RecordStop).await {
            return code;
        }
    }

    // Subscribe to events and wait for TranscriptionDone or *Failed.
    let mut events = match client.subscribe().await {
        Ok(s) => s,
        Err(code) => return code,
    };

    let timeout = std::time::Duration::from_secs(cfg.llm.timeout_secs + 60);
    let start = std::time::Instant::now();

    while start.elapsed() < timeout {
        match tokio::time::timeout(std::time::Duration::from_millis(500), events.next()).await {
            Ok(Some(Ok(DaemonEvent::TranscriptionDone { transcript, .. }))) => {
                if json {
                    crate::output::print_json(&serde_json::json!({ "transcript": transcript }));
                } else {
                    println!("{transcript}");
                }
                return ExitCode::SUCCESS;
            }
            Ok(Some(Ok(DaemonEvent::TranscriptionFailed { error, .. }))) => {
                eprintln!("transcription failed: {error}");
                return ExitCode::from(exit::LLM_UNREACHABLE);
            }
            Ok(Some(Ok(_))) => continue, // other events
            Ok(Some(Err(e))) => {
                eprintln!("event stream error: {e}");
                return ExitCode::from(exit::DAEMON_NOT_REACHABLE);
            }
            Ok(None) => break,
            Err(_) => continue, // timeout slice; keep polling
        }
    }

    eprintln!("timed out waiting for transcription");
    ExitCode::from(exit::GENERIC_FAIL)
}

async fn single_request(client: &mut Client, req: Request, json: bool) -> ExitCode {
    match client.send(req).await {
        Ok(value) => {
            if json {
                crate::output::print_json(&value);
            }
            ExitCode::SUCCESS
        }
        Err(code) => code,
    }
}
```

- [ ] **Step 3: Wire into main.rs dispatch**

In `bin/phoneme/src/main.rs`, expand `dispatch`:

```rust
mod commands;

async fn dispatch(cli: Cli, cfg: &phoneme_core::Config) -> ExitCode {
    match cli.command {
        Command::Version => {
            println!("phoneme {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Command::Record(args) => commands::record::run(args, cfg, cli.json).await,
        _ => {
            eprintln!("phoneme: command not yet implemented");
            ExitCode::from(exit::GENERIC_FAIL)
        }
    }
}
```

- [ ] **Step 4: Verify build**

Run: `cargo build -p phoneme`
Expected: clean.

- [ ] **Step 5: Manual smoke test**

In one terminal: `cargo run -p phoneme-daemon -- --foreground`
In another:
- `cargo run -p phoneme -- record --start` — expect "started" success.
- `cargo run -p phoneme -- record --stop` — expect "stopped" success.

(Full oneshot test requires a real LLM stub; verified by integration tests in Plan 3a.)

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add bin/phoneme/
git commit -m "phoneme: add record subcommands (start/stop/cancel/oneshot/duration)"
```

---

## Task 6: List and show

**Files:**
- Create: `bin/phoneme/src/commands/list.rs`
- Create: `bin/phoneme/src/commands/show.rs`
- Modify: `bin/phoneme/src/commands/mod.rs` and `main.rs`

- [ ] **Step 1: Create `bin/phoneme/src/commands/list.rs`**

```rust
use crate::args::ListArgs;
use crate::client::Client;
use crate::exit;
use crate::output;
use phoneme_core::{Config, ListFilter, Recording, RecordingStatus};
use phoneme_ipc::Request;
use std::process::ExitCode;

pub async fn run(args: ListArgs, cfg: &Config, json: bool) -> ExitCode {
    let filter = build_filter(args);
    let mut client = match Client::connect(cfg).await {
        Ok(c) => c,
        Err(code) => return code,
    };
    let value = match client.send(Request::ListRecordings { filter }).await {
        Ok(v) => v,
        Err(code) => return code,
    };
    let rows: Vec<Recording> = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("error: parsing list response: {e}");
            return ExitCode::from(exit::GENERIC_FAIL);
        }
    };
    if json {
        output::print_json_lines(&rows);
    } else {
        output::print_list_pretty(&rows);
    }
    ExitCode::SUCCESS
}

fn build_filter(args: ListArgs) -> ListFilter {
    let status = args.status.as_deref().and_then(|s| match s {
        "recording" => Some(RecordingStatus::Recording),
        "transcribing" => Some(RecordingStatus::Transcribing),
        "hook_running" => Some(RecordingStatus::HookRunning),
        "done" => Some(RecordingStatus::Done),
        "transcribe_failed" => Some(RecordingStatus::TranscribeFailed),
        "hook_failed" => Some(RecordingStatus::HookFailed),
        _ => None,
    });
    let since = args.since.and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok().map(|d| d.with_timezone(&chrono::Local)));
    ListFilter { limit: args.limit, since, status, search: args.search }
}
```

- [ ] **Step 2: Create `bin/phoneme/src/commands/show.rs`**

```rust
use crate::args::ShowArgs;
use crate::client::Client;
use crate::exit;
use crate::output;
use phoneme_core::{Config, Recording, RecordingId};
use phoneme_ipc::Request;
use std::process::ExitCode;

pub async fn run(args: ShowArgs, cfg: &Config, json: bool) -> ExitCode {
    let id = parse_id(&args.id);
    let mut client = match Client::connect(cfg).await {
        Ok(c) => c,
        Err(code) => return code,
    };
    let value = match client.send(Request::GetRecording { id }).await {
        Ok(v) => v,
        Err(code) => return code,
    };
    let row: Recording = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("error: parsing show response: {e}");
            return ExitCode::from(exit::GENERIC_FAIL);
        }
    };
    if args.audio_path_only {
        println!("{}", row.audio_path);
    } else if json {
        output::print_json(&serde_json::to_value(row).unwrap_or_default());
    } else {
        output::print_recording_pretty(&row);
    }
    ExitCode::SUCCESS
}

fn parse_id(s: &str) -> RecordingId {
    // RecordingId is "from-string-unchecked" via the crate-private helper.
    // We add a public constructor for this:
    RecordingId::from_string(s.to_string())
}
```

- [ ] **Step 3: Add public `from_string` constructor on `RecordingId`**

In `crates/phoneme-core/src/id.rs`:

```rust
impl RecordingId {
    /// Construct from a known-valid id string. No validation — caller asserts.
    pub fn from_string(s: String) -> Self {
        Self(s)
    }
}
```

- [ ] **Step 4: Wire into mod.rs + main.rs**

In `bin/phoneme/src/commands/mod.rs`:

```rust
pub mod list;
pub mod record;
pub mod show;
```

In `main.rs` dispatch:

```rust
Command::List(args) => commands::list::run(args, cfg, cli.json).await,
Command::Show(args) => commands::show::run(args, cfg, cli.json).await,
```

- [ ] **Step 5: Verify build + lint + commit**

```bash
cargo build -p phoneme && cargo clippy -p phoneme --all-targets -- -D warnings
git add crates/phoneme-core/ bin/phoneme/
git commit -m "phoneme: add list + show subcommands"
```

---

## Task 7: Replay and delete

**Files:**
- Create: `bin/phoneme/src/commands/replay.rs`
- Create: `bin/phoneme/src/commands/delete.rs`
- Modify: `commands/mod.rs` and `main.rs`

- [ ] **Step 1: `replay.rs`**

```rust
use crate::args::IdArgs;
use crate::client::Client;
use phoneme_core::{Config, RecordingId};
use phoneme_ipc::Request;
use std::process::ExitCode;

pub async fn run(args: IdArgs, cfg: &Config) -> ExitCode {
    let id = RecordingId::from_string(args.id);
    let mut client = match Client::connect(cfg).await {
        Ok(c) => c,
        Err(code) => return code,
    };
    match client.send(Request::ReplayRecording { id }).await {
        Ok(_) => {
            println!("replay queued");
            ExitCode::SUCCESS
        }
        Err(code) => code,
    }
}
```

- [ ] **Step 2: `delete.rs`**

```rust
use crate::args::DeleteArgs;
use crate::client::Client;
use phoneme_core::{Config, RecordingId};
use phoneme_ipc::Request;
use std::process::ExitCode;

pub async fn run(args: DeleteArgs, cfg: &Config) -> ExitCode {
    let id = RecordingId::from_string(args.id);
    let mut client = match Client::connect(cfg).await {
        Ok(c) => c,
        Err(code) => return code,
    };
    match client.send(Request::DeleteRecording { id, keep_audio: args.keep_audio }).await {
        Ok(_) => {
            println!("deleted");
            ExitCode::SUCCESS
        }
        Err(code) => code,
    }
}
```

- [ ] **Step 3: Wire**

mod.rs:
```rust
pub mod delete;
pub mod replay;
```

main.rs dispatch:
```rust
Command::Replay(args) => commands::replay::run(args, cfg).await,
Command::Delete(args) => commands::delete::run(args, cfg).await,
```

- [ ] **Step 4: Build + lint + commit**

```bash
cargo build -p phoneme && cargo clippy -p phoneme --all-targets -- -D warnings
git add bin/phoneme/
git commit -m "phoneme: add replay + delete subcommands"
```

---

## Task 8: Doctor

**Files:**
- Create: `bin/phoneme/src/commands/doctor.rs`

`doctor` runs a series of checks against the daemon's state plus the local filesystem.

- [ ] **Step 1: Create `bin/phoneme/src/commands/doctor.rs`**

```rust
use crate::args::DoctorArgs;
use crate::client::Client;
use crate::exit;
use colored::Colorize;
use phoneme_core::Config;
use phoneme_ipc::Request;
use std::process::ExitCode;

pub async fn run(args: DoctorArgs, cfg: &Config, json: bool) -> ExitCode {
    if args.rebuild_catalog {
        eprintln!("doctor --rebuild-catalog is not yet implemented as a CLI; run the daemon's catalog rebuild command");
        return ExitCode::from(exit::GENERIC_FAIL);
    }

    let mut checks = Vec::new();

    // Daemon reachability.
    let mut client_result = Client::connect(cfg).await;
    checks.push(Check {
        name: "daemon",
        ok: client_result.is_ok(),
        detail: match &client_result {
            Ok(_) => "running".into(),
            Err(_) => "not reachable".into(),
        },
    });

    // Daemon status detail.
    if let Ok(ref mut c) = client_result {
        match c.send(Request::DaemonStatus).await {
            Ok(value) => {
                checks.push(Check {
                    name: "daemon_status",
                    ok: true,
                    detail: format!("pid {}", value["pid"]),
                });
            }
            Err(_) => checks.push(Check {
                name: "daemon_status",
                ok: false,
                detail: "no status reply".into(),
            }),
        }
    }

    // Filesystem checks.
    let audio_dir = std::path::Path::new(&cfg.recording.audio_dir);
    checks.push(Check {
        name: "audio_dir",
        ok: audio_dir.exists() || std::fs::create_dir_all(audio_dir).is_ok(),
        detail: audio_dir.display().to_string(),
    });

    // Hook file (best-effort).
    let hook_first_word = cfg.hook.command.split_whitespace().next().unwrap_or("");
    checks.push(Check {
        name: "hook_executable",
        ok: which::which(hook_first_word).is_ok() || std::path::Path::new(hook_first_word).exists(),
        detail: hook_first_word.into(),
    });

    let any_failed = checks.iter().any(|c| !c.ok);

    if json {
        let arr: Vec<_> = checks
            .iter()
            .map(|c| serde_json::json!({"name": c.name, "ok": c.ok, "detail": c.detail}))
            .collect();
        crate::output::print_json(&serde_json::Value::Array(arr));
    } else {
        for c in &checks {
            let mark = if c.ok {
                "✓".green().to_string()
            } else {
                "✗".red().to_string()
            };
            println!("{mark} {:<20} {}", c.name, c.detail);
        }
    }

    if any_failed {
        ExitCode::from(exit::GENERIC_FAIL)
    } else {
        ExitCode::SUCCESS
    }
}

struct Check {
    name: &'static str,
    ok: bool,
    detail: String,
}
```

- [ ] **Step 2: Wire**

mod.rs:
```rust
pub mod doctor;
```

main.rs:
```rust
Command::Doctor(args) => commands::doctor::run(args, cfg, cli.json).await,
```

- [ ] **Step 3: Build + lint + commit**

```bash
cargo build -p phoneme && cargo clippy -p phoneme --all-targets -- -D warnings
git add bin/phoneme/
git commit -m "phoneme: add doctor (green/red checklist + exit codes)"
```

---

## Task 9: Config commands

**Files:**
- Create: `bin/phoneme/src/commands/config_cmd.rs`

- [ ] **Step 1: Implement**

```rust
use crate::args::{ConfigAction, ConfigArgs};
use crate::exit;
use phoneme_core::Config;
use std::process::ExitCode;

pub async fn run(args: ConfigArgs, cfg: &Config) -> ExitCode {
    match args.action {
        Some(ConfigAction::Path) => {
            if let Some(p) = phoneme_core::config::default_config_path() {
                println!("{}", p.display());
                ExitCode::SUCCESS
            } else {
                eprintln!("error: could not resolve config path");
                ExitCode::from(exit::GENERIC_FAIL)
            }
        }
        Some(ConfigAction::Set { key, value }) => {
            // Minimal dotted-path setter. Only `llm.external_url`, `llm.timeout_secs`,
            // `hook.command`, etc. need to work for v1; expand as needed.
            match set_value(cfg, &key, &value) {
                Ok(()) => {
                    println!("set {key} = {value}");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("error: {e}");
                    ExitCode::from(exit::INVALID_CONFIG)
                }
            }
        }
        None => {
            // Default: print resolved config as TOML.
            match toml::to_string_pretty(cfg) {
                Ok(s) => {
                    print!("{s}");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("error: {e}");
                    ExitCode::from(exit::GENERIC_FAIL)
                }
            }
        }
    }
}

fn set_value(_cfg: &Config, key: &str, _value: &str) -> Result<(), String> {
    // TODO: implement read-modify-write of config.toml. For v1, the wizard
    // does this and `phoneme config set` is a stretch goal.
    Err(format!("setting `{key}` via CLI is not yet implemented; edit config.toml directly"))
}
```

- [ ] **Step 2: Wire**

mod.rs:
```rust
pub mod config_cmd;
```

main.rs:
```rust
Command::Config(args) => commands::config_cmd::run(args, cfg).await,
```

- [ ] **Step 3: Build + lint + commit**

```bash
cargo build -p phoneme && cargo clippy -p phoneme --all-targets -- -D warnings
git add bin/phoneme/
git commit -m "phoneme: add config (path/print; set returns 'not implemented' for v1)"
```

---

## Task 10: Daemon control

**Files:**
- Create: `bin/phoneme/src/commands/daemon_cmd.rs`

- [ ] **Step 1: Implement**

```rust
use crate::args::{DaemonAction, DaemonArgs};
use crate::auto_spawn;
use crate::client::Client;
use crate::exit;
use phoneme_core::Config;
use phoneme_ipc::Request;
use std::process::ExitCode;

pub async fn run(args: DaemonArgs, cfg: &Config, json: bool) -> ExitCode {
    match args.action.unwrap_or(DaemonAction::Status) {
        DaemonAction::Start => match auto_spawn::ensure_running(cfg).await {
            Ok(()) => {
                println!("daemon started");
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("error: {e}");
                ExitCode::from(exit::GENERIC_FAIL)
            }
        },
        DaemonAction::Stop => {
            let mut client = match Client::connect(cfg).await {
                Ok(c) => c,
                Err(code) => return code,
            };
            match client.send(Request::Shutdown).await {
                Ok(_) => {
                    println!("shutdown requested");
                    ExitCode::SUCCESS
                }
                Err(code) => code,
            }
        }
        DaemonAction::Status => {
            let mut client = match Client::connect(cfg).await {
                Ok(c) => c,
                Err(code) => return code,
            };
            match client.send(Request::DaemonStatus).await {
                Ok(value) => {
                    if json {
                        crate::output::print_json(&value);
                    } else {
                        println!("running: {}", value["running"]);
                        println!("pid:     {}", value["pid"]);
                    }
                    ExitCode::SUCCESS
                }
                Err(code) => code,
            }
        }
    }
}
```

- [ ] **Step 2: Wire**

mod.rs:
```rust
pub mod daemon_cmd;
```

main.rs:
```rust
Command::Daemon(args) => commands::daemon_cmd::run(args, cfg, cli.json).await,
```

- [ ] **Step 3: Build + lint + commit**

```bash
cargo build -p phoneme && cargo clippy -p phoneme --all-targets -- -D warnings
git add bin/phoneme/
git commit -m "phoneme: add daemon control (start/stop/status)"
```

---

## Task 11: Watch + hook test

**Files:**
- Create: `bin/phoneme/src/commands/watch.rs`
- Create: `bin/phoneme/src/commands/hook_cmd.rs`

- [ ] **Step 1: `watch.rs`**

```rust
use crate::client::Client;
use crate::exit;
use phoneme_core::Config;
use std::process::ExitCode;
use futures::StreamExt;

pub async fn run(cfg: &Config) -> ExitCode {
    let mut client = match Client::connect(cfg).await {
        Ok(c) => c,
        Err(code) => return code,
    };
    let mut events = match client.subscribe().await {
        Ok(s) => s,
        Err(code) => return code,
    };
    while let Some(item) = events.next().await {
        match item {
            Ok(event) => {
                if let Ok(s) = serde_json::to_string(&event) {
                    println!("{s}");
                }
            }
            Err(e) => {
                eprintln!("event stream ended: {e}");
                return ExitCode::from(exit::DAEMON_NOT_REACHABLE);
            }
        }
    }
    ExitCode::SUCCESS
}
```

- [ ] **Step 2: `hook_cmd.rs`**

```rust
use crate::args::{HookAction, HookArgs};
use crate::client::Client;
use phoneme_core::Config;
use phoneme_ipc::Request;
use std::process::ExitCode;

pub async fn run(args: HookArgs, cfg: &Config, json: bool) -> ExitCode {
    let mut client = match Client::connect(cfg).await {
        Ok(c) => c,
        Err(code) => return code,
    };
    match args.action {
        HookAction::Test => match client.send(Request::HookTest).await {
            Ok(value) => {
                if json {
                    crate::output::print_json(&value);
                } else {
                    println!("hook test:");
                    println!("  exit_code:   {}", value["exit_code"]);
                    println!("  duration_ms: {}", value["duration_ms"]);
                    if let Some(stderr) = value.get("stderr_tail").and_then(|v| v.as_str()) {
                        if !stderr.is_empty() {
                            println!("  stderr:      {stderr}");
                        }
                    }
                }
                ExitCode::SUCCESS
            }
            Err(code) => code,
        },
    }
}
```

- [ ] **Step 3: Wire**

mod.rs:
```rust
pub mod hook_cmd;
pub mod watch;
```

main.rs:
```rust
Command::Watch => commands::watch::run(cfg).await,
Command::Hook(args) => commands::hook_cmd::run(args, cfg, cli.json).await,
```

- [ ] **Step 4: Build + lint + commit**

```bash
cargo build -p phoneme && cargo clippy -p phoneme --all-targets -- -D warnings
git add bin/phoneme/
git commit -m "phoneme: add watch + hook test subcommands"
```

---

## Task 12: Snapshot tests

**Files:**
- Create: `bin/phoneme/tests/snapshots.rs`

Insta-based snapshot tests for command output. We run with `--frozen-time` semantics by seeding the catalog with fixed-timestamp recordings before running each command.

- [ ] **Step 1: Create the snapshot tests**

```rust
//! CLI output snapshots via `insta`.
//!
//! Each test spawns the `phoneme` binary against a tempdir-backed daemon
//! (Plan 3a's harness) with a deterministic seeded catalog. Output is
//! captured to stdout and snapshotted.

use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn help_output() {
    let output = Command::cargo_bin("phoneme")
        .unwrap()
        .arg("--help")
        .assert()
        .success()
        .get_output()
        .clone();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    insta::assert_snapshot!("phoneme_help", stdout);
}

#[test]
fn version_output() {
    let output = Command::cargo_bin("phoneme")
        .unwrap()
        .arg("version")
        .assert()
        .success()
        .get_output()
        .clone();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    insta::assert_snapshot!("phoneme_version", stdout);
}

#[test]
fn unknown_subcommand_returns_usage_error() {
    let output = Command::cargo_bin("phoneme")
        .unwrap()
        .arg("not-a-real-command")
        .assert()
        .failure();
    let stderr = String::from_utf8_lossy(output.get_output().stderr.as_slice()).to_string();
    assert!(stderr.contains("unrecognized") || stderr.contains("not found") || stderr.contains("error"));
}

#[test]
fn list_command_recognized() {
    // Without a running daemon this fails connect — but we just verify the
    // command is recognized (exit code is daemon_not_reachable = 3).
    let output = Command::cargo_bin("phoneme")
        .unwrap()
        .arg("list")
        .assert()
        .code(predicate::eq(3));
    let _ = output;
}
```

> For the daemon-dependent commands (`list`, `show`, `doctor`), snapshot tests
> need a running daemon. Hook into Plan 3a's `DaemonHarness` by `use`ing it
> as a test-only path; deferred to subagent execution time so we have a
> working harness already.

- [ ] **Step 2: Run tests**

Run: `cargo test -p phoneme --test snapshots`
Expected: 4 tests, first run creates `.snap.new` files; review and rename to `.snap` to accept.

- [ ] **Step 3: Lint**

Run: `cargo clippy -p phoneme --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 4: Commit (including new .snap files)**

```bash
git add bin/phoneme/
git commit -m "phoneme: add snapshot tests for help/version/error handling"
```

---

## Task 13: README + final verification

**Files:**
- Create: `bin/phoneme/README.md`

- [ ] **Step 1: README**

```markdown
# phoneme — CLI

The command-line client for [Phoneme](../../README.md). A thin IPC client to
`phoneme-daemon`; auto-spawns the daemon if it's not running.

## Usage

```
phoneme --help
phoneme record --oneshot
phoneme list --since 2026-05-19
phoneme show 20260519T143500823
phoneme doctor
phoneme watch
phoneme daemon status
```

See `phoneme <command> --help` for per-command flags.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure |
| 2 | Usage error |
| 3 | Daemon not reachable |
| 4 | LLM unreachable / timeout |
| 5 | Hook failed |
| 6 | Invalid config |
| 7 | Not found |

External scripts (Kanata, AHK, GTD integrations) can branch on these without
parsing stderr.

## JSON output

Every command that produces structured output supports `--json` for one-JSON-
per-line output. Pretty-table is the default for interactive use.

## Color

Colored output is enabled when stdout is a TTY and `NO_COLOR` is not set.
Disable with `--no-color`.

## Running tests

```bash
cargo test -p phoneme
```

Insta snapshot tests verify stable command output. Update snapshots with:

```bash
cargo insta review
```
```

- [ ] **Step 2: Workspace-wide verification**

```bash
cargo test --workspace -- --test-threads=1
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cargo build --workspace --release
```

Expected: all pass. Approximate test count after Plan 3b:
- Plan 1 (phoneme-core): ~57
- Plan 2 (audio + ipc): ~47
- Plan 3a (daemon): ~5 unit + 9 integration = ~14
- Plan 3b (CLI): ~6 unit + 4 snapshot = ~10
- Total: ~128 tests

- [ ] **Step 3: Mark Plan 3b complete**

```bash
git add bin/phoneme/README.md
git commit -m "phoneme: add README"
git commit --allow-empty -m "milestone: Plan 3b complete (phoneme CLI green)"
git log --oneline | head -30
```

---

## Plan-level self-review

- **Spec coverage:**
  - Milestone 10 (CLI with all subcommands) → Tasks 5–11 ✓
  - All commands from spec's "CLI surface" table covered ✓
  - Exit codes (0–7) → Task 2 + per-command handling ✓
  - Auto-spawn (connect → spawn detached → 3s poll) → Task 3 ✓
  - JSON output support → `--json` global flag + per-command implementation ✓
  - Color handling (NO_COLOR + --no-color) → main.rs setup ✓

- **Spec deviations:**
  - `phoneme config set` is stubbed for v1 (the wizard handles config writes; CLI editing of config.toml is a v1.1 quality-of-life feature). Documented in the command's error message.
  - `phoneme doctor --rebuild-catalog` is a daemon-side feature; the CLI flag is recognized but currently prints a "use daemon command" message. Wire it through in Plan 3a's pipeline or move it to a hidden subcommand later.

- **Type consistency:** `Request`, `Response`, `RecordMode`, `RecordingId`, `ListFilter` all referenced consistently. `RecordingId::from_string` added in Task 6 as the public constructor for CLI use.

---

## End of Plan 3b
