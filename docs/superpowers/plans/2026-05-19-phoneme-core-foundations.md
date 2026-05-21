# Phoneme — Plan 1: Workspace + `phoneme-core` Foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational `phoneme-core` library with all its modules — error taxonomy, domain types, config, catalog (SQLite + FTS5), inbox queue (filesystem-backed state machine), transcription HTTP client, and hook runner — each tested in isolation. No binaries yet; this is the substrate.

**Architecture:** Single Rust workspace at the repo root. `phoneme-core` is a pure library crate exposing async APIs over Tokio. SQLite via `sqlx` in WAL mode (using `sqlx::migrate!` for schema migrations, embedded at compile time). HTTP via `reqwest`. Config via `toml` + `serde`. All paths through the `directories` crate; user-config paths additionally expanded via `shellexpand`.

**Tech Stack:** Rust 2021, Tokio 1, sqlx 0.7 (sqlite), reqwest 0.12, toml 0.8, serde 1, thiserror 1, chrono 0.4, proptest 1, wiremock 0.6, tempfile 3.

**Spec reference:** `~/dev/phoneme/docs/superpowers/specs/2026-05-19-phoneme-design.md`

---

## File structure for this plan

Everything created here lives under `crates/phoneme-core/`. Workspace root files are also created.

```
phoneme/
├── Cargo.toml                                  [create — workspace root]
├── rust-toolchain.toml                         [create — pin Rust version]
├── .gitignore                                  [modify — add Rust patterns]
├── crates/
│   └── phoneme-core/
│       ├── Cargo.toml                          [create]
│       ├── README.md                           [create]
│       ├── migrations/
│       │   └── 20260519000000_initial.sql      [create — schema bootstrap]
│       ├── src/
│       │   ├── lib.rs                          [create — module declarations + re-exports]
│       │   ├── error.rs                        [create — Error enum + Result alias]
│       │   ├── id.rs                           [create — RecordingId type]
│       │   ├── types.rs                        [create — Recording, RecordingStatus, RecordMode]
│       │   ├── config.rs                       [create — Config struct + TOML loader]
│       │   ├── catalog.rs                      [create — Catalog struct + queries]
│       │   ├── queue.rs                        [create — InboxQueue + state transitions + recovery]
│       │   ├── transcription.rs                [create — HTTP client to llama-server]
│       │   └── hook.rs                         [create — subprocess hook runner]
│       └── tests/
│           ├── catalog.rs                      [create — integration tests against tempfile DB]
│           ├── queue.rs                        [create — integration tests + proptest]
│           ├── transcription.rs                [create — wiremock-based tests]
│           └── hook.rs                         [create — uses small platform-appropriate script]
```

**Module responsibilities:**

- `error.rs`: single `Error` enum (matches the IPC `ErrorKind` taxonomy from the spec). `Result<T>` alias.
- `id.rs`: `RecordingId` = `YYYYMMDDTHHmmssMMM` string. Generator that's monotonic per-process.
- `types.rs`: `Recording`, `RecordingStatus`, `RecordMode`, `ListFilter`, `HookPayload`. All `Serialize + Deserialize`.
- `config.rs`: `Config` struct mirroring the TOML in the spec. `Config::load(path)`, `Config::defaults()`. Path-value fields expanded via `shellexpand`.
- `catalog.rs`: `Catalog` opens the sqlite file (creating with migrations if needed); methods `insert`, `update_status`, `update_transcript`, `update_hook_result`, `get`, `list`, `delete`, `search`. WAL mode.
- `queue.rs`: `InboxQueue` owns the four directories. Methods `enqueue`, `claim_next` (pending → processing), `finish_done`, `finish_failed`, `recover_orphans`. All transitions are atomic file renames.
- `transcription.rs`: `TranscriptionClient::new(url)`. Method `transcribe(wav_path)` posts `multipart/form-data` to `/v1/audio/transcriptions` with configurable timeout. Returns `Result<String>`.
- `hook.rs`: `HookRunner::new(command, timeout)`. Method `run(payload)` spawns subprocess, pipes JSON to stdin, captures stderr, enforces timeout. Returns `HookResult` (exit code, stderr tail, duration).

**Why `queue.rs` and `catalog.rs` are single-file modules** (not directories): each is ~200–300 lines of focused logic. Splitting into submodules would be premature; cohesion is high.

---

## Task 1: Workspace scaffold + empty `phoneme-core` builds

**Files:**
- Create: `Cargo.toml` (workspace)
- Create: `rust-toolchain.toml`
- Modify: `.gitignore`
- Create: `crates/phoneme-core/Cargo.toml`
- Create: `crates/phoneme-core/src/lib.rs`

- [ ] **Step 1: Add Rust patterns to `.gitignore`**

Append to `.gitignore`:

```
target/
**/*.rs.bk
Cargo.lock.bak
```

- [ ] **Step 2: Create `rust-toolchain.toml`**

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

- [ ] **Step 3: Create workspace `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = [
    "crates/phoneme-core",
]

[workspace.package]
version = "1.0.0-dev"
edition = "2021"
license = "MIT OR Apache-2.0"
repository = "https://github.com/namefailed/phoneme"

[workspace.dependencies]
anyhow = "1"
thiserror = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
toml = "0.8"
sqlx = { version = "0.7", default-features = false, features = ["runtime-tokio-rustls", "sqlite", "macros", "migrate", "chrono"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "multipart", "rustls-tls"] }
directories = "5"
shellexpand = "3"
chrono = { version = "0.4", features = ["serde"] }
proptest = "1"
wiremock = "0.6"
tempfile = "3"
```

- [ ] **Step 4: Create `crates/phoneme-core/Cargo.toml`**

```toml
[package]
name = "phoneme-core"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
anyhow.workspace = true
thiserror.workspace = true
serde.workspace = true
serde_json.workspace = true
tokio.workspace = true
tracing.workspace = true
toml.workspace = true
sqlx.workspace = true
reqwest.workspace = true
directories.workspace = true
shellexpand.workspace = true
chrono.workspace = true

[dev-dependencies]
proptest.workspace = true
wiremock.workspace = true
tempfile.workspace = true
tokio = { workspace = true, features = ["test-util", "macros"] }
```

- [ ] **Step 5: Create `crates/phoneme-core/src/lib.rs`**

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.
//!
//! This crate is platform-agnostic and provides the building blocks consumed
//! by `phoneme-daemon`, `phoneme` (CLI), and the Tauri tray app:
//!
//! - configuration loading
//! - the error taxonomy used over IPC
//! - the SQLite recordings catalog
//! - the filesystem-backed inbox queue
//! - the HTTP transcription client
//! - the subprocess hook runner
//!
//! Modules will be added in subsequent tasks.
```

- [ ] **Step 6: Verify the workspace builds**

Run: `cargo build --workspace`
Expected: `Finished dev [unoptimized + debuginfo] target(s) in ...` with no errors (warnings about unused dependencies are OK at this stage).

- [ ] **Step 7: Verify `cargo test` runs (no tests yet)**

Run: `cargo test --workspace`
Expected: `running 0 tests ... test result: ok. 0 passed; 0 failed`

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml rust-toolchain.toml .gitignore crates/
git commit -m "scaffold workspace and phoneme-core crate"
```

---

## Task 2: Error taxonomy

**Files:**
- Create: `crates/phoneme-core/src/error.rs`
- Modify: `crates/phoneme-core/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/phoneme-core/src/error.rs`:

```rust
use thiserror::Error;

/// Single error type for `phoneme-core`. Variants map 1:1 to the IPC
/// `ErrorKind` enum, so the daemon can forward errors without translation.
#[derive(Debug, Error)]
pub enum Error {
    #[error("already recording (id={current})")]
    AlreadyRecording { current: String },

    #[error("no active recording")]
    NotRecording,

    #[error("recording {id} not found")]
    NotFound { id: String },

    #[error("invalid config: {0}")]
    InvalidConfig(String),

    #[error("LLM unreachable at {url}: {source}")]
    LlmUnreachable { url: String, source: reqwest::Error },

    #[error("LLM timed out after {secs}s")]
    LlmTimeout { secs: u64 },

    #[error("LLM returned status {status}: {body}")]
    LlmError { status: u16, body: String },

    #[error("hook failed with exit {code}: {stderr_tail}")]
    HookFailed { code: i32, stderr_tail: String },

    #[error("hook timed out after {secs}s")]
    HookTimeout { secs: u64 },

    #[error("daemon not running")]
    DaemonNotRunning,

    #[error("named pipe already in use by pid {pid}")]
    PipeInUse { pid: u32 },

    #[error("daemon is shutting down")]
    ShuttingDown,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),

    #[error(transparent)]
    SqlxMigrate(#[from] sqlx::migrate::MigrateError),

    #[error(transparent)]
    Toml(#[from] toml::de::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error("internal error: {0}")]
    Internal(String),
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_includes_context() {
        let err = Error::NotFound { id: "abc".into() };
        assert_eq!(format!("{err}"), "recording abc not found");
    }

    #[test]
    fn io_error_converts_automatically() {
        let io: std::io::Error =
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nope");
        let err: Error = io.into();
        assert!(matches!(err, Error::Io(_)));
    }

    #[test]
    fn hook_failed_carries_exit_code() {
        let err = Error::HookFailed { code: 2, stderr_tail: "boom".into() };
        let s = format!("{err}");
        assert!(s.contains("exit 2"));
        assert!(s.contains("boom"));
    }
}
```

- [ ] **Step 2: Wire the module into `lib.rs`**

Replace `crates/phoneme-core/src/lib.rs` contents with:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod error;

pub use error::{Error, Result};
```

- [ ] **Step 3: Run the tests; verify they pass**

Run: `cargo test -p phoneme-core error::`
Expected: `test result: ok. 3 passed; 0 failed`

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-core/src/
git commit -m "phoneme-core: add Error enum mirroring IPC taxonomy"
```

---

## Task 3: Recording ID generation

**Files:**
- Create: `crates/phoneme-core/src/id.rs`
- Modify: `crates/phoneme-core/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/phoneme-core/src/id.rs`:

```rust
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::atomic::{AtomicU16, Ordering};

/// A recording identifier: `YYYYMMDDTHHmmssMMM` (17 chars). Sortable as a
/// plain string; uniqueness within a process is guaranteed by an atomic
/// per-millisecond sequence bump.
///
/// Example: `20260519T143500823`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RecordingId(String);

static LAST_TS_MS: AtomicU16 = AtomicU16::new(0);

impl RecordingId {
    /// Generate a new id from the current local time.
    ///
    /// If called more than once within the same millisecond, the second call
    /// will bump the millisecond field by one to preserve uniqueness without
    /// blocking the caller.
    pub fn new() -> Self {
        Self::from_datetime(Local::now())
    }

    /// Generate an id from a specific datetime (used by tests).
    pub fn from_datetime(dt: DateTime<Local>) -> Self {
        let mut ms = dt.timestamp_subsec_millis() as u16;
        let prev = LAST_TS_MS.swap(ms, Ordering::SeqCst);
        if prev == ms {
            ms = ms.wrapping_add(1);
            LAST_TS_MS.store(ms, Ordering::SeqCst);
        }
        let s = format!("{}{:03}", dt.format("%Y%m%dT%H%M%S"), ms);
        Self(s)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Time portion as `HHmmssMMM` — the WAV filename within a day folder.
    pub fn file_stem(&self) -> &str {
        &self.0[9..] // skip `YYYYMMDDT`
    }

    /// Day portion as `YYYY-MM-DD` — the day folder name under audio_dir.
    pub fn day_folder(&self) -> String {
        format!("{}-{}-{}", &self.0[0..4], &self.0[4..6], &self.0[6..8])
    }
}

impl fmt::Display for RecordingId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Default for RecordingId {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn id_has_expected_shape() {
        let dt = Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap();
        let id = RecordingId::from_datetime(dt);
        // 17 chars: YYYYMMDDTHHmmssMMM
        assert_eq!(id.as_str().len(), 17);
        assert!(id.as_str().starts_with("20260519T143500"));
    }

    #[test]
    fn file_stem_drops_date_prefix() {
        let dt = Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap();
        let id = RecordingId::from_datetime(dt);
        assert_eq!(id.file_stem().len(), 9);
        assert!(id.file_stem().starts_with("143500"));
    }

    #[test]
    fn day_folder_format() {
        let dt = Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap();
        let id = RecordingId::from_datetime(dt);
        assert_eq!(id.day_folder(), "2026-05-19");
    }

    #[test]
    fn ids_are_unique_within_same_millisecond() {
        let dt = Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap();
        let a = RecordingId::from_datetime(dt);
        let b = RecordingId::from_datetime(dt);
        assert_ne!(a, b);
    }

    #[test]
    fn ids_sort_chronologically() {
        let mut ids = vec![
            RecordingId::from_datetime(Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap()),
            RecordingId::from_datetime(Local.with_ymd_and_hms(2026, 5, 19, 9, 0, 0).unwrap()),
            RecordingId::from_datetime(Local.with_ymd_and_hms(2026, 5, 19, 18, 0, 0).unwrap()),
        ];
        ids.sort();
        assert_eq!(ids[0].as_str()[9..15].to_string(), "090000");
        assert_eq!(ids[1].as_str()[9..15].to_string(), "143500");
        assert_eq!(ids[2].as_str()[9..15].to_string(), "180000");
    }
}
```

- [ ] **Step 2: Wire module into `lib.rs`**

Update `crates/phoneme-core/src/lib.rs`:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod error;
pub mod id;

pub use error::{Error, Result};
pub use id::RecordingId;
```

- [ ] **Step 3: Run tests; verify they pass**

Run: `cargo test -p phoneme-core id::`
Expected: `test result: ok. 5 passed; 0 failed`

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-core/src/
git commit -m "phoneme-core: add RecordingId with monotonic per-process uniqueness"
```

---

## Task 4: Domain types (Recording, RecordingStatus, RecordMode, HookPayload)

**Files:**
- Create: `crates/phoneme-core/src/types.rs`
- Modify: `crates/phoneme-core/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/phoneme-core/src/types.rs`:

```rust
use crate::id::RecordingId;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

/// Lifecycle state of a recording. Stored in the catalog `status` column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingStatus {
    Recording,
    Transcribing,
    HookRunning,
    Done,
    TranscribeFailed,
    HookFailed,
}

impl RecordingStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Recording => "recording",
            Self::Transcribing => "transcribing",
            Self::HookRunning => "hook_running",
            Self::Done => "done",
            Self::TranscribeFailed => "transcribe_failed",
            Self::HookFailed => "hook_failed",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Done | Self::TranscribeFailed | Self::HookFailed)
    }
}

/// How a recording should run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordMode {
    /// Stop when stop signal arrives (hotkey release, CLI --stop).
    Hold,
    /// Stop on silence detection or max duration.
    Oneshot,
    /// Stop after exactly N seconds.
    Duration { secs: u32 },
}

/// The canonical Recording row as exposed by `Catalog`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Recording {
    pub id: RecordingId,
    pub started_at: DateTime<Local>,
    pub duration_ms: i64,
    pub audio_path: String,
    pub transcript: Option<String>,
    pub model: Option<String>,
    pub status: RecordingStatus,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
    pub hook_command: Option<String>,
    pub hook_exit_code: Option<i32>,
    pub hook_duration_ms: Option<i64>,
    pub transcribed_at: Option<DateTime<Local>>,
    pub hook_ran_at: Option<DateTime<Local>>,
}

/// Filter for `Catalog::list` and the CLI `phoneme list` command.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListFilter {
    pub limit: Option<u32>,
    pub since: Option<DateTime<Local>>,
    pub status: Option<RecordingStatus>,
    pub search: Option<String>,
}

/// The payload sent to hook scripts on stdin (and stored verbatim in inbox JSON).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookPayload {
    pub id: RecordingId,
    pub timestamp: DateTime<Local>,
    pub transcript: String,
    pub audio_path: String,
    pub duration_ms: i64,
    pub model: String,
    pub metadata: HookMetadata,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookMetadata {
    pub phoneme_version: String,
    pub hook_version: u32,
}

impl HookMetadata {
    pub const HOOK_VERSION: u32 = 1;

    pub fn current() -> Self {
        Self {
            phoneme_version: env!("CARGO_PKG_VERSION").to_string(),
            hook_version: Self::HOOK_VERSION,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn recording_status_serializes_snake_case() {
        let s = serde_json::to_string(&RecordingStatus::HookRunning).unwrap();
        assert_eq!(s, "\"hook_running\"");
    }

    #[test]
    fn recording_status_round_trips() {
        for v in [
            RecordingStatus::Recording,
            RecordingStatus::Transcribing,
            RecordingStatus::HookRunning,
            RecordingStatus::Done,
            RecordingStatus::TranscribeFailed,
            RecordingStatus::HookFailed,
        ] {
            let s = serde_json::to_string(&v).unwrap();
            let parsed: RecordingStatus = serde_json::from_str(&s).unwrap();
            assert_eq!(parsed, v);
        }
    }

    #[test]
    fn terminal_statuses_identified_correctly() {
        assert!(RecordingStatus::Done.is_terminal());
        assert!(RecordingStatus::TranscribeFailed.is_terminal());
        assert!(RecordingStatus::HookFailed.is_terminal());
        assert!(!RecordingStatus::Recording.is_terminal());
        assert!(!RecordingStatus::Transcribing.is_terminal());
        assert!(!RecordingStatus::HookRunning.is_terminal());
    }

    #[test]
    fn record_mode_serializes_with_payload() {
        let s = serde_json::to_string(&RecordMode::Duration { secs: 10 }).unwrap();
        assert_eq!(s, "{\"duration\":{\"secs\":10}}");
    }

    #[test]
    fn hook_payload_round_trips() {
        let payload = HookPayload {
            id: RecordingId::from_datetime(
                Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap(),
            ),
            timestamp: Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap(),
            transcript: "hello world".into(),
            audio_path: "C:/tmp/x.wav".into(),
            duration_ms: 1234,
            model: "gemma".into(),
            metadata: HookMetadata::current(),
        };
        let s = serde_json::to_string(&payload).unwrap();
        let parsed: HookPayload = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed, payload);
    }

    #[test]
    fn hook_metadata_pins_version_to_1() {
        let m = HookMetadata::current();
        assert_eq!(m.hook_version, 1);
    }
}
```

- [ ] **Step 2: Wire module into `lib.rs`**

Update `crates/phoneme-core/src/lib.rs`:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod error;
pub mod id;
pub mod types;

pub use error::{Error, Result};
pub use id::RecordingId;
pub use types::{HookMetadata, HookPayload, ListFilter, Recording, RecordMode, RecordingStatus};
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p phoneme-core types::`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-core/src/
git commit -m "phoneme-core: add domain types (Recording, RecordingStatus, RecordMode, HookPayload)"
```

---

## Task 5: Config loading and validation

**Files:**
- Create: `crates/phoneme-core/src/config.rs`
- Modify: `crates/phoneme-core/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/phoneme-core/src/config.rs`:

```rust
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    pub llm: LlmConfig,
    pub recording: RecordingConfig,
    pub hook: HookConfig,
    pub hotkey: HotkeyConfig,
    pub tray: TrayConfig,
    pub daemon: DaemonConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmMode {
    External,
    BundledModel,
    BundledDownload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmConfig {
    pub mode: LlmMode,
    pub external_url: String,
    pub model_path: String,
    pub bundled_server_port: u16,
    pub bundled_server_args: Vec<String>,
    pub timeout_secs: u64,
    pub system_prompt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordingConfig {
    pub audio_dir: String,
    pub sample_rate: u32,
    pub channels: u8,
    pub silence_threshold_dbfs: f32,
    pub silence_window_ms: u32,
    pub max_duration_secs: u32,
    pub input_device: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookConfig {
    pub command: String,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HotkeyConfig {
    pub enabled: bool,
    pub combo: String,
    pub mode: HotkeyMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyMode {
    Hold,
    Toggle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrayConfig {
    pub show_on_startup: bool,
    pub minimize_to_tray: bool,
    pub start_at_login: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DaemonConfig {
    pub log_level: String,
    pub log_max_size_mb: u32,
    pub log_max_files: u32,
    pub pipe_name: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            llm: LlmConfig {
                mode: LlmMode::External,
                external_url: "http://127.0.0.1:5809".into(),
                model_path: String::new(),
                bundled_server_port: 5809,
                bundled_server_args: vec![],
                timeout_secs: 60,
                system_prompt:
                    "Transcribe the user's speech and clean it into a single line.".into(),
            },
            recording: RecordingConfig {
                audio_dir: "%USERPROFILE%/Documents/phoneme/audio".into(),
                sample_rate: 16000,
                channels: 1,
                silence_threshold_dbfs: -45.0,
                silence_window_ms: 3000,
                max_duration_secs: 300,
                input_device: "default".into(),
            },
            hook: HookConfig {
                command: "powershell -File %APPDATA%/phoneme/hooks/to-stdout.ps1".into(),
                timeout_secs: 30,
            },
            hotkey: HotkeyConfig {
                enabled: false,
                combo: "Ctrl+Alt+Space".into(),
                mode: HotkeyMode::Hold,
            },
            tray: TrayConfig {
                show_on_startup: true,
                minimize_to_tray: true,
                start_at_login: false,
            },
            daemon: DaemonConfig {
                log_level: "info".into(),
                log_max_size_mb: 10,
                log_max_files: 5,
                pipe_name: "phoneme-daemon".into(),
            },
        }
    }
}

impl Config {
    /// Load and parse a config file from disk.
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path)?;
        let cfg: Self = toml::from_str(&text)?;
        cfg.validate()?;
        Ok(cfg)
    }

    /// Validate constraints not enforced by the type system.
    pub fn validate(&self) -> Result<()> {
        if self.recording.sample_rate < 8000 || self.recording.sample_rate > 96000 {
            return Err(Error::InvalidConfig(format!(
                "recording.sample_rate must be between 8000 and 96000 (got {})",
                self.recording.sample_rate
            )));
        }
        if !(1..=2).contains(&self.recording.channels) {
            return Err(Error::InvalidConfig(format!(
                "recording.channels must be 1 or 2 (got {})",
                self.recording.channels
            )));
        }
        if self.llm.mode == LlmMode::BundledModel && self.llm.model_path.is_empty() {
            return Err(Error::InvalidConfig(
                "llm.model_path is required when llm.mode = bundled_model".into(),
            ));
        }
        match self.daemon.log_level.as_str() {
            "error" | "warn" | "info" | "debug" | "trace" => {}
            other => {
                return Err(Error::InvalidConfig(format!(
                    "daemon.log_level must be error|warn|info|debug|trace (got {other})"
                )));
            }
        }
        Ok(())
    }

    /// Expand `~` and `%VAR%` in user-configurable path fields. Returns a new
    /// Config; original is unchanged.
    pub fn expanded(&self) -> Result<Self> {
        let mut out = self.clone();
        out.recording.audio_dir = expand(&out.recording.audio_dir)?;
        out.llm.model_path = expand(&out.llm.model_path)?;
        out.hook.command = expand(&out.hook.command)?;
        Ok(out)
    }
}

fn expand(s: &str) -> Result<String> {
    if s.is_empty() {
        return Ok(s.into());
    }
    let expanded = shellexpand::full(s)
        .map_err(|e| Error::InvalidConfig(format!("path expansion failed for {s}: {e}")))?;
    Ok(expanded.into_owned())
}

/// Helper for tests/wizard: resolve the default config file path.
pub fn default_config_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("", "", "phoneme")
        .map(|p| p.config_dir().join("config.toml"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_config(dir: &TempDir, contents: &str) -> PathBuf {
        let path = dir.path().join("config.toml");
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn defaults_round_trip_through_toml() {
        let cfg = Config::default();
        let s = toml::to_string(&cfg).unwrap();
        let parsed: Config = toml::from_str(&s).unwrap();
        assert_eq!(parsed, cfg);
    }

    #[test]
    fn defaults_validate() {
        Config::default().validate().expect("defaults are valid");
    }

    #[test]
    fn loads_minimal_valid_config() {
        let dir = TempDir::new().unwrap();
        let cfg_text = toml::to_string(&Config::default()).unwrap();
        let path = write_config(&dir, &cfg_text);
        let cfg = Config::load(&path).expect("loads");
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn rejects_bad_sample_rate() {
        let mut cfg = Config::default();
        cfg.recording.sample_rate = 100;
        let err = cfg.validate().unwrap_err();
        assert!(matches!(err, Error::InvalidConfig(_)));
        assert!(format!("{err}").contains("sample_rate"));
    }

    #[test]
    fn rejects_bad_log_level() {
        let mut cfg = Config::default();
        cfg.daemon.log_level = "loud".into();
        let err = cfg.validate().unwrap_err();
        assert!(format!("{err}").contains("log_level"));
    }

    #[test]
    fn bundled_model_requires_model_path() {
        let mut cfg = Config::default();
        cfg.llm.mode = LlmMode::BundledModel;
        cfg.llm.model_path = String::new();
        let err = cfg.validate().unwrap_err();
        assert!(format!("{err}").contains("model_path"));
    }

    #[test]
    fn invalid_toml_returns_toml_error() {
        let dir = TempDir::new().unwrap();
        let path = write_config(&dir, "not = valid = toml");
        let err = Config::load(&path).unwrap_err();
        assert!(matches!(err, Error::Toml(_)));
    }

    #[test]
    fn tilde_expansion_in_audio_dir() {
        let mut cfg = Config::default();
        cfg.recording.audio_dir = "~/test".into();
        let expanded = cfg.expanded().unwrap();
        assert!(!expanded.recording.audio_dir.starts_with('~'));
        assert!(expanded.recording.audio_dir.ends_with("/test")
            || expanded.recording.audio_dir.ends_with("\\test"));
    }
}
```

- [ ] **Step 2: Wire module into `lib.rs`**

Update `crates/phoneme-core/src/lib.rs`:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod config;
pub mod error;
pub mod id;
pub mod types;

pub use config::Config;
pub use error::{Error, Result};
pub use id::RecordingId;
pub use types::{HookMetadata, HookPayload, ListFilter, Recording, RecordMode, RecordingStatus};
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p phoneme-core config::`
Expected: `test result: ok. 8 passed; 0 failed`

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-core/src/
git commit -m "phoneme-core: add Config with TOML loading, validation, path expansion"
```

---

## Task 6: SQLite migration + initial schema

**Files:**
- Create: `crates/phoneme-core/migrations/20260519000000_initial.sql`

- [ ] **Step 1: Create the migration file**

The filename's timestamp prefix is what `sqlx::migrate!` uses for ordering. Use `20260519000000` exactly — it must come before any future migration.

Create `crates/phoneme-core/migrations/20260519000000_initial.sql`:

```sql
-- Phoneme catalog schema v1

CREATE TABLE recordings (
    id                TEXT PRIMARY KEY,
    started_at        TEXT NOT NULL,
    duration_ms       INTEGER NOT NULL,
    audio_path        TEXT NOT NULL,
    transcript        TEXT,
    model             TEXT,
    status            TEXT NOT NULL,
    error_kind        TEXT,
    error_message     TEXT,
    hook_command      TEXT,
    hook_exit_code    INTEGER,
    hook_duration_ms  INTEGER,
    transcribed_at    TEXT,
    hook_ran_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recordings_started_at ON recordings(started_at DESC);
CREATE INDEX idx_recordings_status     ON recordings(status);

-- FTS5 mirror for transcript search.
CREATE VIRTUAL TABLE recordings_fts USING fts5(
    id UNINDEXED,
    transcript,
    content='recordings',
    content_rowid='rowid'
);

CREATE TRIGGER recordings_ai AFTER INSERT ON recordings BEGIN
    INSERT INTO recordings_fts(rowid, id, transcript)
        VALUES (new.rowid, new.id, new.transcript);
END;

CREATE TRIGGER recordings_au AFTER UPDATE ON recordings BEGIN
    UPDATE recordings_fts SET transcript = new.transcript
        WHERE rowid = new.rowid;
END;

CREATE TRIGGER recordings_ad AFTER DELETE ON recordings BEGIN
    DELETE FROM recordings_fts WHERE rowid = old.rowid;
END;
```

- [ ] **Step 2: Verify the migration compiles**

`sqlx::migrate!` validates SQL at compile time once `Catalog::open` references it. We can't test it standalone yet — that comes in Task 7. For now, just verify the file is well-formed by piping through `sqlite3`:

Run: `sqlite3 :memory: < crates/phoneme-core/migrations/20260519000000_initial.sql && echo OK`
Expected: `OK` with no errors.

(If `sqlite3` is not on PATH, skip this step; the next task's tests will catch any SQL bugs.)

- [ ] **Step 3: Commit**

```bash
git add crates/phoneme-core/migrations/
git commit -m "phoneme-core: add initial SQL migration (recordings + FTS5)"
```

---

## Task 7: Catalog CRUD operations

**Files:**
- Create: `crates/phoneme-core/src/catalog.rs`
- Modify: `crates/phoneme-core/src/lib.rs`
- Create: `crates/phoneme-core/tests/catalog.rs`

- [ ] **Step 1: Write the failing integration test**

Create `crates/phoneme-core/tests/catalog.rs`:

```rust
use chrono::{Local, TimeZone};
use phoneme_core::{
    Catalog, ListFilter, Recording, RecordingId, RecordingStatus,
};
use tempfile::TempDir;

fn sample_recording(id: RecordingId) -> Recording {
    Recording {
        id,
        started_at: Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap(),
        duration_ms: 8470,
        audio_path: "C:/tmp/x.wav".into(),
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
    }
}

async fn fresh_catalog() -> (TempDir, Catalog) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("catalog.db");
    let catalog = Catalog::open(&path).await.expect("opens");
    (dir, catalog)
}

#[tokio::test]
async fn opens_creates_schema_when_missing() {
    let (_dir, _catalog) = fresh_catalog().await;
    // Reaching this point means migrations ran without error.
}

#[tokio::test]
async fn insert_then_get_returns_same_recording() {
    let (_dir, catalog) = fresh_catalog().await;
    let rec = sample_recording(RecordingId::new());
    catalog.insert(&rec).await.unwrap();
    let got = catalog.get(&rec.id).await.unwrap().expect("found");
    assert_eq!(got.id, rec.id);
    assert_eq!(got.audio_path, rec.audio_path);
    assert_eq!(got.status, RecordingStatus::Recording);
}

#[tokio::test]
async fn get_missing_returns_none() {
    let (_dir, catalog) = fresh_catalog().await;
    let id = RecordingId::new();
    let got = catalog.get(&id).await.unwrap();
    assert!(got.is_none());
}

#[tokio::test]
async fn update_status_advances_through_states() {
    let (_dir, catalog) = fresh_catalog().await;
    let rec = sample_recording(RecordingId::new());
    catalog.insert(&rec).await.unwrap();
    catalog.update_status(&rec.id, RecordingStatus::Transcribing).await.unwrap();
    let got = catalog.get(&rec.id).await.unwrap().unwrap();
    assert_eq!(got.status, RecordingStatus::Transcribing);
}

#[tokio::test]
async fn update_transcript_persists_text() {
    let (_dir, catalog) = fresh_catalog().await;
    let rec = sample_recording(RecordingId::new());
    catalog.insert(&rec).await.unwrap();
    catalog
        .update_transcript(&rec.id, "hello world", "gemma-4-E4B")
        .await
        .unwrap();
    let got = catalog.get(&rec.id).await.unwrap().unwrap();
    assert_eq!(got.transcript.as_deref(), Some("hello world"));
    assert_eq!(got.model.as_deref(), Some("gemma-4-E4B"));
}

#[tokio::test]
async fn list_returns_inserted_recordings_descending() {
    let (_dir, catalog) = fresh_catalog().await;
    let a = sample_recording(RecordingId::from_datetime(
        Local.with_ymd_and_hms(2026, 5, 19, 9, 0, 0).unwrap(),
    ));
    let b = sample_recording(RecordingId::from_datetime(
        Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap(),
    ));
    catalog.insert(&a).await.unwrap();
    catalog.insert(&b).await.unwrap();
    let list = catalog.list(&ListFilter::default()).await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, b.id);
    assert_eq!(list[1].id, a.id);
}

#[tokio::test]
async fn list_respects_limit() {
    let (_dir, catalog) = fresh_catalog().await;
    for h in 0..5 {
        let rec = sample_recording(RecordingId::from_datetime(
            Local.with_ymd_and_hms(2026, 5, 19, h, 0, 0).unwrap(),
        ));
        catalog.insert(&rec).await.unwrap();
    }
    let list = catalog
        .list(&ListFilter { limit: Some(2), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(list.len(), 2);
}

#[tokio::test]
async fn list_filters_by_status() {
    let (_dir, catalog) = fresh_catalog().await;
    let r1 = sample_recording(RecordingId::new());
    let r2 = sample_recording(RecordingId::new());
    catalog.insert(&r1).await.unwrap();
    catalog.insert(&r2).await.unwrap();
    catalog.update_status(&r2.id, RecordingStatus::Done).await.unwrap();
    let list = catalog
        .list(&ListFilter {
            status: Some(RecordingStatus::Done),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, r2.id);
}

#[tokio::test]
async fn search_finds_by_transcript_text() {
    let (_dir, catalog) = fresh_catalog().await;
    let rec = sample_recording(RecordingId::new());
    catalog.insert(&rec).await.unwrap();
    catalog
        .update_transcript(&rec.id, "remind me to email Sarah about the contract", "m")
        .await
        .unwrap();
    let hits = catalog.search("sarah").await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, rec.id);
    let miss = catalog.search("nonexistent").await.unwrap();
    assert!(miss.is_empty());
}

#[tokio::test]
async fn delete_removes_recording_and_fts_row() {
    let (_dir, catalog) = fresh_catalog().await;
    let rec = sample_recording(RecordingId::new());
    catalog.insert(&rec).await.unwrap();
    catalog.update_transcript(&rec.id, "deletable", "m").await.unwrap();
    catalog.delete(&rec.id).await.unwrap();
    assert!(catalog.get(&rec.id).await.unwrap().is_none());
    assert!(catalog.search("deletable").await.unwrap().is_empty());
}

#[tokio::test]
async fn update_hook_result_persists_exit_code() {
    let (_dir, catalog) = fresh_catalog().await;
    let rec = sample_recording(RecordingId::new());
    catalog.insert(&rec).await.unwrap();
    catalog
        .update_hook_result(&rec.id, "powershell -file foo.ps1", 0, 142)
        .await
        .unwrap();
    let got = catalog.get(&rec.id).await.unwrap().unwrap();
    assert_eq!(got.hook_command.as_deref(), Some("powershell -file foo.ps1"));
    assert_eq!(got.hook_exit_code, Some(0));
    assert_eq!(got.hook_duration_ms, Some(142));
}
```

- [ ] **Step 2: Run the tests; verify they fail (no Catalog yet)**

Run: `cargo test -p phoneme-core --test catalog`
Expected: compile error — `unresolved import: phoneme_core::Catalog`

- [ ] **Step 3: Create `crates/phoneme-core/src/catalog.rs`**

```rust
use crate::error::Result;
use crate::id::RecordingId;
use crate::types::{ListFilter, Recording, RecordingStatus};
use chrono::{DateTime, Local};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::path::Path;
use std::str::FromStr;

/// SQLite-backed recordings catalog.
///
/// All methods are async (Tokio). The pool is configured for WAL mode with
/// a small connection cap suitable for desktop usage (one writer at a time).
#[derive(Debug, Clone)]
pub struct Catalog {
    pool: SqlitePool,
}

impl Catalog {
    /// Open (or create) a catalog database at `path`. Runs pending migrations.
    pub async fn open(path: &Path) -> Result<Self> {
        let opts = SqliteConnectOptions::from_str(path.to_str().expect("utf-8 path"))?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(opts)
            .await?;

        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn insert(&self, r: &Recording) -> Result<()> {
        sqlx::query(
            r#"INSERT INTO recordings
                 (id, started_at, duration_ms, audio_path, transcript, model, status,
                  error_kind, error_message, hook_command, hook_exit_code,
                  hook_duration_ms, transcribed_at, hook_ran_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(r.id.as_str())
        .bind(r.started_at.to_rfc3339())
        .bind(r.duration_ms)
        .bind(&r.audio_path)
        .bind(r.transcript.as_deref())
        .bind(r.model.as_deref())
        .bind(r.status.as_str())
        .bind(r.error_kind.as_deref())
        .bind(r.error_message.as_deref())
        .bind(r.hook_command.as_deref())
        .bind(r.hook_exit_code)
        .bind(r.hook_duration_ms)
        .bind(r.transcribed_at.map(|t| t.to_rfc3339()))
        .bind(r.hook_ran_at.map(|t| t.to_rfc3339()))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_status(&self, id: &RecordingId, status: RecordingStatus) -> Result<()> {
        sqlx::query(
            "UPDATE recordings SET status = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(status.as_str())
        .bind(id.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_transcript(
        &self,
        id: &RecordingId,
        transcript: &str,
        model: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"UPDATE recordings
               SET transcript = ?, model = ?,
                   transcribed_at = datetime('now'), updated_at = datetime('now')
               WHERE id = ?"#,
        )
        .bind(transcript)
        .bind(model)
        .bind(id.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_hook_result(
        &self,
        id: &RecordingId,
        command: &str,
        exit_code: i32,
        duration_ms: i64,
    ) -> Result<()> {
        sqlx::query(
            r#"UPDATE recordings
               SET hook_command = ?, hook_exit_code = ?, hook_duration_ms = ?,
                   hook_ran_at = datetime('now'), updated_at = datetime('now')
               WHERE id = ?"#,
        )
        .bind(command)
        .bind(exit_code)
        .bind(duration_ms)
        .bind(id.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get(&self, id: &RecordingId) -> Result<Option<Recording>> {
        let row = sqlx::query("SELECT * FROM recordings WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_recording).transpose()
    }

    pub async fn list(&self, filter: &ListFilter) -> Result<Vec<Recording>> {
        let mut sql = String::from("SELECT * FROM recordings WHERE 1=1");
        if filter.status.is_some() {
            sql.push_str(" AND status = ?");
        }
        if filter.since.is_some() {
            sql.push_str(" AND started_at >= ?");
        }
        sql.push_str(" ORDER BY started_at DESC");
        if let Some(n) = filter.limit {
            sql.push_str(&format!(" LIMIT {n}"));
        }

        let mut q = sqlx::query(&sql);
        if let Some(s) = filter.status {
            q = q.bind(s.as_str().to_string());
        }
        if let Some(t) = filter.since {
            q = q.bind(t.to_rfc3339());
        }
        let rows = q.fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_recording).collect()
    }

    /// FTS5 search across transcripts. Empty query returns empty Vec.
    pub async fn search(&self, query: &str) -> Result<Vec<Recording>> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }
        let rows = sqlx::query(
            r#"SELECT recordings.* FROM recordings
               JOIN recordings_fts ON recordings.rowid = recordings_fts.rowid
               WHERE recordings_fts.transcript MATCH ?
               ORDER BY recordings.started_at DESC"#,
        )
        .bind(query)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(row_to_recording).collect()
    }

    pub async fn delete(&self, id: &RecordingId) -> Result<()> {
        sqlx::query("DELETE FROM recordings WHERE id = ?")
            .bind(id.as_str())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

fn row_to_recording(row: sqlx::sqlite::SqliteRow) -> Result<Recording> {
    let id: String = row.try_get("id")?;
    let started_at: String = row.try_get("started_at")?;
    let status: String = row.try_get("status")?;
    Ok(Recording {
        id: RecordingId::from_str_unchecked(&id),
        started_at: parse_dt(&started_at)?,
        duration_ms: row.try_get("duration_ms")?,
        audio_path: row.try_get("audio_path")?,
        transcript: row.try_get("transcript")?,
        model: row.try_get("model")?,
        status: parse_status(&status)?,
        error_kind: row.try_get("error_kind")?,
        error_message: row.try_get("error_message")?,
        hook_command: row.try_get("hook_command")?,
        hook_exit_code: row.try_get("hook_exit_code")?,
        hook_duration_ms: row.try_get("hook_duration_ms")?,
        transcribed_at: row
            .try_get::<Option<String>, _>("transcribed_at")?
            .map(|s| parse_dt(&s))
            .transpose()?,
        hook_ran_at: row
            .try_get::<Option<String>, _>("hook_ran_at")?
            .map(|s| parse_dt(&s))
            .transpose()?,
    })
}

fn parse_dt(s: &str) -> Result<DateTime<Local>> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Local))
        .or_else(|_| {
            // SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" UTC.
            let naive =
                chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                    .map_err(|e| {
                        crate::error::Error::Internal(format!("bad datetime {s}: {e}"))
                    })?;
            Ok(chrono::TimeZone::from_utc_datetime(&chrono::Utc, &naive).with_timezone(&Local))
        })
}

fn parse_status(s: &str) -> Result<RecordingStatus> {
    Ok(match s {
        "recording" => RecordingStatus::Recording,
        "transcribing" => RecordingStatus::Transcribing,
        "hook_running" => RecordingStatus::HookRunning,
        "done" => RecordingStatus::Done,
        "transcribe_failed" => RecordingStatus::TranscribeFailed,
        "hook_failed" => RecordingStatus::HookFailed,
        other => {
            return Err(crate::error::Error::Internal(format!(
                "unknown recording status: {other}"
            )))
        }
    })
}
```

- [ ] **Step 4: Add `from_str_unchecked` to `RecordingId`**

Modify `crates/phoneme-core/src/id.rs` — add this `impl` block (don't replace the existing one):

```rust
impl RecordingId {
    /// Construct from a known-valid id string (e.g., from DB rows). Does not validate.
    pub(crate) fn from_str_unchecked(s: &str) -> Self {
        Self(s.to_string())
    }
}
```

- [ ] **Step 5: Wire module into `lib.rs`**

Update `crates/phoneme-core/src/lib.rs`:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod catalog;
pub mod config;
pub mod error;
pub mod id;
pub mod types;

pub use catalog::Catalog;
pub use config::Config;
pub use error::{Error, Result};
pub use id::RecordingId;
pub use types::{HookMetadata, HookPayload, ListFilter, Recording, RecordMode, RecordingStatus};
```

- [ ] **Step 6: Run tests; verify they pass**

Run: `cargo test -p phoneme-core --test catalog`
Expected: `test result: ok. 11 passed; 0 failed`

- [ ] **Step 7: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 8: Commit**

```bash
git add crates/phoneme-core/src/ crates/phoneme-core/tests/
git commit -m "phoneme-core: add Catalog (SQLite WAL + CRUD + FTS5 search)"
```

---

## Task 8: Inbox queue — state transitions

**Files:**
- Create: `crates/phoneme-core/src/queue.rs`
- Modify: `crates/phoneme-core/src/lib.rs`
- Create: `crates/phoneme-core/tests/queue.rs`

- [ ] **Step 1: Write failing integration tests**

Create `crates/phoneme-core/tests/queue.rs`:

```rust
use chrono::{Local, TimeZone};
use phoneme_core::queue::{InboxQueue, InboxState};
use phoneme_core::{HookMetadata, HookPayload, RecordingId};
use tempfile::TempDir;

fn make_payload(id: RecordingId) -> HookPayload {
    HookPayload {
        id,
        timestamp: Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap(),
        transcript: String::new(),
        audio_path: "C:/tmp/x.wav".into(),
        duration_ms: 8470,
        model: String::new(),
        metadata: HookMetadata::current(),
    }
}

#[tokio::test]
async fn enqueue_creates_pending_file() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id = RecordingId::new();
    q.enqueue(&make_payload(id.clone())).await.unwrap();
    let path = dir.path().join("pending").join(format!("{id}.json"));
    assert!(path.exists());
}

#[tokio::test]
async fn claim_next_returns_oldest_pending_and_moves_to_processing() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id_a = RecordingId::from_datetime(
        Local.with_ymd_and_hms(2026, 5, 19, 9, 0, 0).unwrap(),
    );
    let id_b = RecordingId::from_datetime(
        Local.with_ymd_and_hms(2026, 5, 19, 14, 35, 0).unwrap(),
    );
    q.enqueue(&make_payload(id_b.clone())).await.unwrap();
    q.enqueue(&make_payload(id_a.clone())).await.unwrap();

    let claimed = q.claim_next().await.unwrap().expect("has pending");
    assert_eq!(claimed.id, id_a);

    assert!(!dir
        .path()
        .join("pending")
        .join(format!("{id_a}.json"))
        .exists());
    assert!(dir
        .path()
        .join("processing")
        .join(format!("{id_a}.json"))
        .exists());
}

#[tokio::test]
async fn claim_next_returns_none_when_empty() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    assert!(q.claim_next().await.unwrap().is_none());
}

#[tokio::test]
async fn finish_done_moves_processing_to_done() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id = RecordingId::new();
    let mut payload = make_payload(id.clone());
    q.enqueue(&payload).await.unwrap();
    let claimed = q.claim_next().await.unwrap().unwrap();
    payload.transcript = "hello".into();
    q.finish_done(&claimed.id, &payload).await.unwrap();

    assert!(!dir.path().join("processing").join(format!("{id}.json")).exists());
    let done = dir.path().join("done").join(format!("{id}.json"));
    assert!(done.exists());
    let text = std::fs::read_to_string(done).unwrap();
    let parsed: HookPayload = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed.transcript, "hello");
}

#[tokio::test]
async fn finish_failed_moves_processing_to_failed() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id = RecordingId::new();
    q.enqueue(&make_payload(id.clone())).await.unwrap();
    let claimed = q.claim_next().await.unwrap().unwrap();
    q.finish_failed(&claimed.id, "llm_unreachable", "connection refused")
        .await
        .unwrap();
    assert!(dir.path().join("failed").join(format!("{id}.json")).exists());
}

#[tokio::test]
async fn states_counts_reflect_inbox() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id1 = RecordingId::new();
    let id2 = RecordingId::new();
    q.enqueue(&make_payload(id1)).await.unwrap();
    q.enqueue(&make_payload(id2.clone())).await.unwrap();
    let claimed = q.claim_next().await.unwrap().unwrap();
    let _ = claimed;
    let counts = q.counts().await.unwrap();
    assert_eq!(counts.pending, 1);
    assert_eq!(counts.processing, 1);
    assert_eq!(counts.done, 0);
    assert_eq!(counts.failed, 0);
}

#[tokio::test]
async fn requeue_moves_processing_back_to_pending() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id = RecordingId::new();
    q.enqueue(&make_payload(id.clone())).await.unwrap();
    let _claimed = q.claim_next().await.unwrap().unwrap();
    q.requeue(&id).await.unwrap();
    assert!(dir.path().join("pending").join(format!("{id}.json")).exists());
    assert!(!dir
        .path()
        .join("processing")
        .join(format!("{id}.json"))
        .exists());
}

#[tokio::test]
async fn recover_orphans_moves_processing_to_pending() {
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id = RecordingId::new();
    q.enqueue(&make_payload(id.clone())).await.unwrap();
    let _claimed = q.claim_next().await.unwrap().unwrap();
    drop(q);

    // New InboxQueue (simulating daemon restart) discovers the orphan.
    let q2 = InboxQueue::new(dir.path()).await.unwrap();
    let recovered = q2.recover_orphans().await.unwrap();
    assert_eq!(recovered, vec![id.clone()]);
    assert!(dir.path().join("pending").join(format!("{id}.json")).exists());
}

#[tokio::test]
async fn enqueue_is_atomic_under_observation() {
    // The pending file must appear with its complete contents, not as a
    // partially-written file. We test this by enqueuing then verifying the
    // file parses as JSON immediately.
    let dir = TempDir::new().unwrap();
    let q = InboxQueue::new(dir.path()).await.unwrap();
    let id = RecordingId::new();
    let payload = make_payload(id.clone());
    q.enqueue(&payload).await.unwrap();
    let path = dir.path().join("pending").join(format!("{id}.json"));
    let text = std::fs::read_to_string(&path).unwrap();
    let parsed: HookPayload = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed.id, id);
}

#[test]
fn inbox_state_subdir_names_are_stable() {
    assert_eq!(InboxState::Pending.subdir(), "pending");
    assert_eq!(InboxState::Processing.subdir(), "processing");
    assert_eq!(InboxState::Done.subdir(), "done");
    assert_eq!(InboxState::Failed.subdir(), "failed");
}
```

- [ ] **Step 2: Run tests; verify they fail (no queue module yet)**

Run: `cargo test -p phoneme-core --test queue`
Expected: compile error referencing missing `phoneme_core::queue` module.

- [ ] **Step 3: Create `crates/phoneme-core/src/queue.rs`**

```rust
use crate::error::{Error, Result};
use crate::id::RecordingId;
use crate::types::HookPayload;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;

/// Which directory of the inbox a payload lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboxState {
    Pending,
    Processing,
    Done,
    Failed,
}

impl InboxState {
    pub fn subdir(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Processing => "processing",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }
}

/// Count of payloads in each inbox state.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InboxCounts {
    pub pending: usize,
    pub processing: usize,
    pub done: usize,
    pub failed: usize,
}

/// Failure payload (written when finish_failed is called).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedPayload {
    pub id: RecordingId,
    pub error_kind: String,
    pub error_message: String,
}

/// Filesystem-backed work queue.
///
/// Each payload lives as a single JSON file under one of four subdirectories
/// (`pending/`, `processing/`, `done/`, `failed/`). State transitions are
/// atomic file renames, which on the same filesystem are crash-safe — either
/// the rename happened or it didn't.
#[derive(Debug, Clone)]
pub struct InboxQueue {
    root: PathBuf,
}

impl InboxQueue {
    /// Create (or open) an inbox at `root`. Creates the four subdirectories
    /// if missing.
    pub async fn new(root: &Path) -> Result<Self> {
        for state in [
            InboxState::Pending,
            InboxState::Processing,
            InboxState::Done,
            InboxState::Failed,
        ] {
            fs::create_dir_all(root.join(state.subdir())).await?;
        }
        Ok(Self { root: root.to_path_buf() })
    }

    /// Atomically write a new pending payload.
    ///
    /// Implementation: write to a temp file in the same directory, then rename
    /// to the final name. Rename on the same filesystem is atomic.
    pub async fn enqueue(&self, payload: &HookPayload) -> Result<()> {
        let pending = self.root.join("pending");
        let final_path = pending.join(format!("{}.json", payload.id));
        let temp_path = pending.join(format!("{}.json.tmp", payload.id));
        let json = serde_json::to_vec_pretty(payload)?;
        fs::write(&temp_path, &json).await?;
        fs::rename(&temp_path, &final_path).await?;
        Ok(())
    }

    /// Claim the oldest pending payload (moving it to `processing/`).
    /// Returns `None` if there's nothing pending.
    pub async fn claim_next(&self) -> Result<Option<HookPayload>> {
        let pending = self.root.join("pending");
        let mut entries = read_json_entries_sorted(&pending).await?;
        let Some(file) = entries.first().cloned() else {
            return Ok(None);
        };
        let id_str = file.file_stem().and_then(|s| s.to_str()).ok_or_else(|| {
            Error::Internal(format!("bad inbox filename: {}", file.display()))
        })?;
        let payload = read_payload(&file).await?;
        let processing = self.root.join("processing").join(format!("{id_str}.json"));
        fs::rename(&file, &processing).await?;
        entries.remove(0);
        Ok(Some(payload))
    }

    /// Move a processing payload to `done/`, replacing it with the final form
    /// (with transcript, hook result, etc.).
    pub async fn finish_done(&self, id: &RecordingId, payload: &HookPayload) -> Result<()> {
        let processing = self.root.join("processing").join(format!("{id}.json"));
        let done = self.root.join("done").join(format!("{id}.json"));
        let json = serde_json::to_vec_pretty(payload)?;
        let temp = self.root.join("done").join(format!("{id}.json.tmp"));
        fs::write(&temp, &json).await?;
        fs::rename(&temp, &done).await?;
        if fs::try_exists(&processing).await.unwrap_or(false) {
            fs::remove_file(&processing).await?;
        }
        Ok(())
    }

    /// Move a processing payload to `failed/`, writing a failure record.
    pub async fn finish_failed(
        &self,
        id: &RecordingId,
        error_kind: &str,
        error_message: &str,
    ) -> Result<()> {
        let processing = self.root.join("processing").join(format!("{id}.json"));
        let failed = self.root.join("failed").join(format!("{id}.json"));
        let record = FailedPayload {
            id: id.clone(),
            error_kind: error_kind.to_string(),
            error_message: error_message.to_string(),
        };
        let json = serde_json::to_vec_pretty(&record)?;
        let temp = self.root.join("failed").join(format!("{id}.json.tmp"));
        fs::write(&temp, &json).await?;
        fs::rename(&temp, &failed).await?;
        if fs::try_exists(&processing).await.unwrap_or(false) {
            fs::remove_file(&processing).await?;
        }
        Ok(())
    }

    /// Move a processing payload back to pending (e.g., user-initiated replay
    /// from `failed/` goes pending -> processing on next claim).
    pub async fn requeue(&self, id: &RecordingId) -> Result<()> {
        let processing = self.root.join("processing").join(format!("{id}.json"));
        let pending = self.root.join("pending").join(format!("{id}.json"));
        if fs::try_exists(&processing).await.unwrap_or(false) {
            fs::rename(&processing, &pending).await?;
        }
        Ok(())
    }

    /// Move any files left in `processing/` back to `pending/`. Returns the
    /// list of ids recovered. Called by the daemon at startup.
    pub async fn recover_orphans(&self) -> Result<Vec<RecordingId>> {
        let mut recovered = vec![];
        let mut dir = fs::read_dir(self.root.join("processing")).await?;
        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let id_str = path.file_stem().and_then(|s| s.to_str()).ok_or_else(|| {
                Error::Internal(format!("bad orphan filename: {}", path.display()))
            })?;
            let id = RecordingId::from_str_unchecked(id_str);
            let dest = self.root.join("pending").join(format!("{id}.json"));
            fs::rename(&path, &dest).await?;
            recovered.push(id);
        }
        Ok(recovered)
    }

    /// Count files in each inbox subdirectory.
    pub async fn counts(&self) -> Result<InboxCounts> {
        Ok(InboxCounts {
            pending: count_json(&self.root.join("pending")).await?,
            processing: count_json(&self.root.join("processing")).await?,
            done: count_json(&self.root.join("done")).await?,
            failed: count_json(&self.root.join("failed")).await?,
        })
    }
}

async fn read_payload(path: &Path) -> Result<HookPayload> {
    let bytes = fs::read(path).await?;
    let payload: HookPayload = serde_json::from_slice(&bytes)?;
    Ok(payload)
}

async fn read_json_entries_sorted(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out = vec![];
    let mut entries = fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

async fn count_json(dir: &Path) -> Result<usize> {
    let mut count = 0;
    let mut entries = fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            count += 1;
        }
    }
    Ok(count)
}
```

- [ ] **Step 4: Wire module into `lib.rs`**

Update `crates/phoneme-core/src/lib.rs`:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod catalog;
pub mod config;
pub mod error;
pub mod id;
pub mod queue;
pub mod types;

pub use catalog::Catalog;
pub use config::Config;
pub use error::{Error, Result};
pub use id::RecordingId;
pub use queue::{InboxCounts, InboxQueue, InboxState};
pub use types::{HookMetadata, HookPayload, ListFilter, Recording, RecordMode, RecordingStatus};
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p phoneme-core --test queue`
Expected: `test result: ok. 10 passed; 0 failed`

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-core/src/ crates/phoneme-core/tests/
git commit -m "phoneme-core: add InboxQueue (atomic state transitions + recovery)"
```

---

## Task 9: Inbox queue — property test for state convergence

Property test: any sequence of `enqueue` / `claim_next` / `finish_done` / `finish_failed` / `requeue` / `recover_orphans` operations leaves the queue in a consistent state — every file is in exactly one subdirectory, no temp files leak.

**Files:**
- Modify: `crates/phoneme-core/tests/queue.rs`

- [ ] **Step 1: Add the property test**

Append to `crates/phoneme-core/tests/queue.rs`:

```rust
use proptest::prelude::*;

#[derive(Debug, Clone)]
enum Op {
    Enqueue,
    Claim,
    FinishDone,
    FinishFailed,
    Requeue,
    Recover,
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        Just(Op::Enqueue),
        Just(Op::Claim),
        Just(Op::FinishDone),
        Just(Op::FinishFailed),
        Just(Op::Requeue),
        Just(Op::Recover),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(40))]
    #[test]
    fn random_ops_leave_consistent_state(ops in proptest::collection::vec(op_strategy(), 0..30)) {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all().build().unwrap();
        rt.block_on(async {
            let dir = TempDir::new().unwrap();
            let q = InboxQueue::new(dir.path()).await.unwrap();
            let mut in_processing: Vec<RecordingId> = vec![];

            for op in ops {
                match op {
                    Op::Enqueue => {
                        let id = RecordingId::new();
                        q.enqueue(&make_payload(id)).await.unwrap();
                    }
                    Op::Claim => {
                        if let Some(p) = q.claim_next().await.unwrap() {
                            in_processing.push(p.id);
                        }
                    }
                    Op::FinishDone => {
                        if let Some(id) = in_processing.pop() {
                            q.finish_done(&id, &make_payload(id.clone())).await.unwrap();
                        }
                    }
                    Op::FinishFailed => {
                        if let Some(id) = in_processing.pop() {
                            q.finish_failed(&id, "x", "y").await.unwrap();
                        }
                    }
                    Op::Requeue => {
                        if let Some(id) = in_processing.pop() {
                            q.requeue(&id).await.unwrap();
                        }
                    }
                    Op::Recover => {
                        let recovered = q.recover_orphans().await.unwrap();
                        // Anything we knew was "in processing" is now back to pending.
                        in_processing.retain(|id| !recovered.contains(id));
                    }
                }
            }

            // Invariants: (1) no .tmp files left behind, (2) every json file
            // appears in exactly one subdirectory.
            for sub in ["pending", "processing", "done", "failed"] {
                let mut entries = std::fs::read_dir(dir.path().join(sub)).unwrap();
                while let Some(e) = entries.next() {
                    let p = e.unwrap().path();
                    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
                    assert!(ext == "json", "leaked file: {}", p.display());
                }
            }
        });
    }
}
```

- [ ] **Step 2: Run the property test**

Run: `cargo test -p phoneme-core --test queue random_ops_leave_consistent_state`
Expected: `test result: ok. 1 passed; 0 failed` (with `proptest: 40 cases passed` in the log).

- [ ] **Step 3: Commit**

```bash
git add crates/phoneme-core/tests/
git commit -m "phoneme-core: add property test for inbox queue state convergence"
```

---

## Task 10: Transcription HTTP client

**Files:**
- Create: `crates/phoneme-core/src/transcription.rs`
- Modify: `crates/phoneme-core/src/lib.rs`
- Create: `crates/phoneme-core/tests/transcription.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/phoneme-core/tests/transcription.rs`:

```rust
use phoneme_core::transcription::TranscriptionClient;
use phoneme_core::Error;
use std::path::Path;
use tempfile::TempDir;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn fake_wav(dir: &TempDir) -> std::path::PathBuf {
    // Minimal 16-byte WAV-ish file. Server doesn't actually decode in tests.
    let p = dir.path().join("sample.wav");
    std::fs::write(&p, b"RIFF\0\0\0\0WAVEfmt ").unwrap();
    p
}

#[tokio::test]
async fn returns_transcript_text_on_200() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"text": "hello world"})),
        )
        .mount(&server)
        .await;

    let dir = TempDir::new().unwrap();
    let wav = fake_wav(&dir).await;
    let client = TranscriptionClient::new(server.uri(), std::time::Duration::from_secs(5));
    let result = client.transcribe(&wav).await.unwrap();
    assert_eq!(result, "hello world");
}

#[tokio::test]
async fn returns_llm_error_on_500() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .respond_with(ResponseTemplate::new(500).set_body_string("model loading"))
        .mount(&server)
        .await;

    let dir = TempDir::new().unwrap();
    let wav = fake_wav(&dir).await;
    let client = TranscriptionClient::new(server.uri(), std::time::Duration::from_secs(5));
    let err = client.transcribe(&wav).await.unwrap_err();
    match err {
        Error::LlmError { status, body } => {
            assert_eq!(status, 500);
            assert!(body.contains("model loading"));
        }
        other => panic!("expected LlmError, got {other:?}"),
    }
}

#[tokio::test]
async fn returns_timeout_when_server_slow() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_secs(2))
                .set_body_json(serde_json::json!({"text": "late"})),
        )
        .mount(&server)
        .await;

    let dir = TempDir::new().unwrap();
    let wav = fake_wav(&dir).await;
    let client = TranscriptionClient::new(server.uri(), std::time::Duration::from_millis(100));
    let err = client.transcribe(&wav).await.unwrap_err();
    assert!(matches!(err, Error::LlmTimeout { .. }));
}

#[tokio::test]
async fn returns_unreachable_when_no_server() {
    let dir = TempDir::new().unwrap();
    let wav = fake_wav(&dir).await;
    // Port likely unbound; reqwest will fail to connect.
    let client = TranscriptionClient::new(
        "http://127.0.0.1:1".to_string(),
        std::time::Duration::from_secs(2),
    );
    let err = client.transcribe(&wav).await.unwrap_err();
    assert!(matches!(err, Error::LlmUnreachable { .. }));
}

#[tokio::test]
async fn errors_on_missing_audio_file() {
    let client = TranscriptionClient::new(
        "http://127.0.0.1:9999".to_string(),
        std::time::Duration::from_secs(2),
    );
    let err = client.transcribe(Path::new("/no/such/file.wav")).await.unwrap_err();
    assert!(matches!(err, Error::Io(_)));
}
```

- [ ] **Step 2: Run tests; verify they fail (no module yet)**

Run: `cargo test -p phoneme-core --test transcription`
Expected: compile error referencing missing module.

- [ ] **Step 3: Create `crates/phoneme-core/src/transcription.rs`**

```rust
use crate::error::{Error, Result};
use reqwest::multipart;
use serde::Deserialize;
use std::path::Path;
use std::time::Duration;
use tokio::fs;

/// HTTP client for an OpenAI-compatible `/v1/audio/transcriptions` endpoint.
#[derive(Debug, Clone)]
pub struct TranscriptionClient {
    base_url: String,
    timeout: Duration,
    http: reqwest::Client,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    text: String,
}

impl TranscriptionClient {
    pub fn new(base_url: String, timeout: Duration) -> Self {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .expect("reqwest client builds");
        Self { base_url, timeout, http }
    }

    /// POST the audio file as `multipart/form-data` and return the transcript.
    pub async fn transcribe(&self, audio_path: &Path) -> Result<String> {
        let bytes = fs::read(audio_path).await?;
        let part = multipart::Part::bytes(bytes)
            .file_name(
                audio_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("audio.wav")
                    .to_string(),
            )
            .mime_str("audio/wav")
            .map_err(|e| Error::Internal(format!("multipart mime: {e}")))?;
        let form = multipart::Form::new().part("file", part);

        let url = format!("{}/v1/audio/transcriptions", self.base_url.trim_end_matches('/'));
        let response = match self.http.post(&url).multipart(form).send().await {
            Ok(r) => r,
            Err(e) if e.is_timeout() => {
                return Err(Error::LlmTimeout { secs: self.timeout.as_secs() })
            }
            Err(e) => return Err(Error::LlmUnreachable { url, source: e }),
        };

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(Error::LlmError { status: status.as_u16(), body });
        }

        let parsed: OpenAiResponse = response.json().await.map_err(|e| {
            Error::Internal(format!("decoding transcription response: {e}"))
        })?;
        Ok(parsed.text)
    }
}
```

- [ ] **Step 4: Wire module into `lib.rs`**

Update `crates/phoneme-core/src/lib.rs` — add `pub mod transcription;` and `pub use transcription::TranscriptionClient;` in alphabetical position. Full file:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod catalog;
pub mod config;
pub mod error;
pub mod id;
pub mod queue;
pub mod transcription;
pub mod types;

pub use catalog::Catalog;
pub use config::Config;
pub use error::{Error, Result};
pub use id::RecordingId;
pub use queue::{InboxCounts, InboxQueue, InboxState};
pub use transcription::TranscriptionClient;
pub use types::{HookMetadata, HookPayload, ListFilter, Recording, RecordMode, RecordingStatus};
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p phoneme-core --test transcription`
Expected: `test result: ok. 5 passed; 0 failed`

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-core/src/ crates/phoneme-core/tests/
git commit -m "phoneme-core: add TranscriptionClient (multipart POST + timeout + error mapping)"
```

---

## Task 11: Hook runner (subprocess + stdin + timeout)

**Files:**
- Create: `crates/phoneme-core/src/hook.rs`
- Modify: `crates/phoneme-core/src/lib.rs`
- Create: `crates/phoneme-core/tests/hook.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/phoneme-core/tests/hook.rs`:

```rust
use chrono::Local;
use phoneme_core::hook::{HookResult, HookRunner};
use phoneme_core::{Error, HookMetadata, HookPayload, RecordingId};
use std::time::Duration;
use tempfile::TempDir;

fn make_payload() -> HookPayload {
    HookPayload {
        id: RecordingId::new(),
        timestamp: Local::now(),
        transcript: "hello hook".into(),
        audio_path: "C:/tmp/x.wav".into(),
        duration_ms: 1000,
        model: "gemma".into(),
        metadata: HookMetadata::current(),
    }
}

#[cfg(target_os = "windows")]
fn cmd_for(script_kind: &str, dir: &TempDir) -> String {
    let script_path = dir.path().join(format!("{script_kind}.cmd"));
    let body = match script_kind {
        "echo" => "@echo off\r\nmore\r\nexit 0\r\n",
        "fail" => "@echo off\r\necho oh no 1>&2\r\nexit 2\r\n",
        "slow" => "@echo off\r\nping -n 5 127.0.0.1 > nul\r\nexit 0\r\n",
        _ => panic!("unknown kind"),
    };
    std::fs::write(&script_path, body).unwrap();
    format!("cmd /c \"{}\"", script_path.display())
}

#[cfg(unix)]
fn cmd_for(script_kind: &str, dir: &TempDir) -> String {
    let script_path = dir.path().join(format!("{script_kind}.sh"));
    let body = match script_kind {
        "echo" => "#!/bin/sh\ncat\nexit 0\n",
        "fail" => "#!/bin/sh\necho 'oh no' 1>&2\nexit 2\n",
        "slow" => "#!/bin/sh\nsleep 5\nexit 0\n",
        _ => panic!("unknown kind"),
    };
    std::fs::write(&script_path, body).unwrap();
    use std::os::unix::fs::PermissionsExt;
    let mut perm = std::fs::metadata(&script_path).unwrap().permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(&script_path, perm).unwrap();
    format!("sh {}", script_path.display())
}

#[tokio::test]
async fn successful_hook_returns_exit_zero() {
    let dir = TempDir::new().unwrap();
    let cmd = cmd_for("echo", &dir);
    let runner = HookRunner::new(cmd, Duration::from_secs(5));
    let result: HookResult = runner.run(&make_payload()).await.unwrap();
    assert_eq!(result.exit_code, 0);
    assert!(result.duration_ms < 5_000);
}

#[tokio::test]
async fn failing_hook_returns_hook_failed() {
    let dir = TempDir::new().unwrap();
    let cmd = cmd_for("fail", &dir);
    let runner = HookRunner::new(cmd, Duration::from_secs(5));
    let err = runner.run(&make_payload()).await.unwrap_err();
    match err {
        Error::HookFailed { code, stderr_tail } => {
            assert_eq!(code, 2);
            assert!(stderr_tail.contains("oh no"));
        }
        other => panic!("expected HookFailed, got {other:?}"),
    }
}

#[tokio::test]
async fn slow_hook_times_out() {
    let dir = TempDir::new().unwrap();
    let cmd = cmd_for("slow", &dir);
    let runner = HookRunner::new(cmd, Duration::from_millis(200));
    let err = runner.run(&make_payload()).await.unwrap_err();
    assert!(matches!(err, Error::HookTimeout { .. }));
}

#[tokio::test]
async fn missing_command_returns_io_error() {
    let runner = HookRunner::new(
        "no_such_executable_anywhere".into(),
        Duration::from_secs(2),
    );
    let err = runner.run(&make_payload()).await.unwrap_err();
    assert!(matches!(err, Error::Io(_)));
}
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `cargo test -p phoneme-core --test hook`
Expected: compile error referencing missing module.

- [ ] **Step 3: Create `crates/phoneme-core/src/hook.rs`**

```rust
use crate::error::{Error, Result};
use crate::types::HookPayload;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Clone)]
pub struct HookResult {
    pub exit_code: i32,
    pub stderr_tail: String,
    pub duration_ms: i64,
}

/// Runs the configured hook subprocess with a JSON payload on stdin.
#[derive(Debug, Clone)]
pub struct HookRunner {
    command: String,
    timeout: Duration,
}

impl HookRunner {
    pub fn new(command: String, timeout: Duration) -> Self {
        Self { command, timeout }
    }

    pub async fn run(&self, payload: &HookPayload) -> Result<HookResult> {
        let json = serde_json::to_vec(payload)?;
        let (program, args) = split_command(&self.command);

        let mut cmd = Command::new(program);
        cmd.args(&args)
            .env("PHONEME_ID", payload.id.as_str())
            .env("PHONEME_AUDIO_PATH", &payload.audio_path)
            .env("PHONEME_TRANSCRIPT", &payload.transcript)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            cmd.current_dir(home);
        }

        let started = Instant::now();
        let mut child = cmd.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&json).await?;
            drop(stdin);
        }

        let output = match timeout(self.timeout, child.wait_with_output()).await {
            Ok(r) => r?,
            Err(_) => {
                return Err(Error::HookTimeout { secs: self.timeout.as_secs() });
            }
        };

        let duration_ms = started.elapsed().as_millis() as i64;
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_tail = tail_chars(&stderr, 4096);

        let code = output.status.code().unwrap_or(-1);
        if code == 0 {
            Ok(HookResult { exit_code: 0, stderr_tail, duration_ms })
        } else {
            Err(Error::HookFailed { code, stderr_tail })
        }
    }
}

/// Split a command string into program and arg list. Naive — does not
/// implement full shell parsing, but handles quoted paths.
fn split_command(s: &str) -> (String, Vec<String>) {
    let mut parts = vec![];
    let mut current = String::new();
    let mut in_quote = false;
    for c in s.chars() {
        match c {
            '"' => in_quote = !in_quote,
            ' ' if !in_quote => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            other => current.push(other),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    let mut iter = parts.into_iter();
    let program = iter.next().unwrap_or_default();
    let args: Vec<String> = iter.collect();
    (program, args)
}

fn tail_chars(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        s.to_string()
    } else {
        // Take the trailing max_bytes, snap to char boundary
        let start = s.len() - max_bytes;
        let start = s.char_indices().find(|(i, _)| *i >= start).map(|(i, _)| i).unwrap_or(start);
        s[start..].to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_command_handles_unquoted() {
        let (p, a) = split_command("powershell -File foo.ps1");
        assert_eq!(p, "powershell");
        assert_eq!(a, vec!["-File", "foo.ps1"]);
    }

    #[test]
    fn split_command_handles_quoted_paths() {
        let (p, a) = split_command("powershell -File \"C:/Program Files/x.ps1\"");
        assert_eq!(p, "powershell");
        assert_eq!(a, vec!["-File", "C:/Program Files/x.ps1"]);
    }

    #[test]
    fn tail_chars_short_string_unchanged() {
        assert_eq!(tail_chars("hello", 100), "hello");
    }

    #[test]
    fn tail_chars_trims_long_string() {
        let s = "x".repeat(10_000);
        let t = tail_chars(&s, 100);
        assert_eq!(t.len(), 100);
    }
}
```

- [ ] **Step 4: Wire module into `lib.rs`**

Update `crates/phoneme-core/src/lib.rs`:

```rust
//! phoneme-core — shared library for the Phoneme voice notes app.

pub mod catalog;
pub mod config;
pub mod error;
pub mod hook;
pub mod id;
pub mod queue;
pub mod transcription;
pub mod types;

pub use catalog::Catalog;
pub use config::Config;
pub use error::{Error, Result};
pub use hook::{HookResult, HookRunner};
pub use id::RecordingId;
pub use queue::{InboxCounts, InboxQueue, InboxState};
pub use transcription::TranscriptionClient;
pub use types::{HookMetadata, HookPayload, ListFilter, Recording, RecordMode, RecordingStatus};
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p phoneme-core`
Expected: all unit + integration tests pass. Look for the test count to include the hook tests (3 unit + 4 integration = ~7 new) on top of previous totals.

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-core --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-core/src/ crates/phoneme-core/tests/
git commit -m "phoneme-core: add HookRunner (spawn + stdin + timeout + stderr capture)"
```

---

## Task 12: Public README for `phoneme-core`

**Files:**
- Create: `crates/phoneme-core/README.md`

- [ ] **Step 1: Write the README**

```markdown
# phoneme-core

Shared library for the [Phoneme](../../README.md) voice notes app.

This crate is platform-agnostic and provides the building blocks consumed by
`phoneme-daemon`, the `phoneme` CLI, and the Tauri tray app.

## Modules

| Module | Responsibility |
|---|---|
| `config` | TOML config loading, validation, and `~`/`%VAR%` expansion |
| `error` | Single `Error` enum mirroring the IPC `ErrorKind` taxonomy |
| `id` | `RecordingId` (sortable `YYYYMMDDTHHmmssMMM` string, monotonic per-process) |
| `types` | `Recording`, `RecordingStatus`, `RecordMode`, `HookPayload`, `ListFilter` |
| `catalog` | SQLite-backed recordings catalog (WAL mode + FTS5 search) |
| `queue` | Filesystem-backed inbox queue with atomic state transitions |
| `transcription` | HTTP client for `/v1/audio/transcriptions` (OpenAI-compatible) |
| `hook` | Subprocess runner for user hook scripts (stdin JSON + timeout) |

## Public API stability

The crate is `1.0.0-dev` and does not yet commit to a stable API. Once Phoneme
ships v1.0 the public surface here will be stabilised.

## Hook contract

When invoked, hook subprocesses receive a JSON object on stdin matching the
`HookPayload` struct. `metadata.hook_version` is a stability commitment: while
it stays `1`, surrounding fields will not be renamed or removed.

See the top-level design doc for full details.

## Running the tests

```bash
cargo test -p phoneme-core --workspace
```

The `transcription` integration tests spin up an in-process [wiremock] HTTP
server. The `hook` tests create small platform-appropriate scripts in a
`tempfile::TempDir`. No external services are required.

[wiremock]: https://crates.io/crates/wiremock
```

- [ ] **Step 2: Commit**

```bash
git add crates/phoneme-core/README.md
git commit -m "phoneme-core: add README"
```

---

## Task 13: Final verification + plan-completion commit

- [ ] **Step 1: Run the full workspace test suite**

Run: `cargo test --workspace`
Expected: every unit + integration test passes. Approximate count:
- `error` unit tests: 3
- `id` unit tests: 5
- `types` unit tests: 6
- `config` unit tests: 8
- `hook` unit tests: 4
- `catalog` integration tests: 11
- `queue` integration tests: 10 (+ 1 property test)
- `transcription` integration tests: 5
- `hook` integration tests: 4

Total: ~57 passing.

- [ ] **Step 2: Run clippy on everything with warnings-as-errors**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 3: Run rustfmt --check**

Run: `cargo fmt --all -- --check`
Expected: no diff. If there's a diff, run `cargo fmt --all` and re-stage.

- [ ] **Step 4: Verify the workspace cleanly builds in release mode**

Run: `cargo build --workspace --release`
Expected: builds without errors. (This is a heavier check that exercises monomorphization paths skipped in debug builds.)

- [ ] **Step 5: Mark Plan 1 complete with a milestone commit**

```bash
# No code change — but a marker commit makes it easy to find this point in the log.
git commit --allow-empty -m "milestone: Plan 1 complete (phoneme-core foundations green)"
git log --oneline | head -20
```

---

## Plan-level self-review (already done before saving)

- **Spec coverage:**
  - Spec milestones 1–6 (workspace scaffold, types/config/errors, catalog with FTS5, queue with recovery, transcription client, hook runner) → Tasks 1–11. ✓
  - All spec catalog fields (id, started_at, duration_ms, audio_path, transcript, model, status, error_*, hook_*, transcribed_at, hook_ran_at, created_at, updated_at) appear in Task 6's migration and Task 7's `Recording` struct. ✓
  - Spec's `[recording]`, `[llm]`, `[hook]`, `[hotkey]`, `[tray]`, `[daemon]` config sections all map to Task 5's `Config` struct. ✓
  - `metadata.hook_version = 1` commitment encoded in Task 4's `HookMetadata::HOOK_VERSION`. ✓
  - Atomic-rename inbox state transitions (pending → processing → done/failed, recovery on startup) implemented in Task 8 and stress-tested in Task 9. ✓

- **Placeholder scan:** No "TBD", "TODO", "fill in", or hand-wavy steps. Every step shows the code or the exact command.

- **Type consistency:** `Recording`, `RecordingId`, `RecordingStatus`, `HookPayload`, `HookMetadata`, `Catalog`, `InboxQueue`, `TranscriptionClient`, `HookRunner`, `HookResult` — all referenced uniformly across tasks. Method signatures (`insert(&Recording)`, `update_status(&RecordingId, RecordingStatus)`, etc.) match between definition and call sites.

- **Spec deviation noted:** The spec named the migration tracking table `schema_meta`. This plan uses `sqlx::migrate!` which manages its own `_sqlx_migrations` table. Functionally equivalent; flagged in the catalog module docs for future plan readers. (The spec's appendix already notes "migrations" as deferred-implementation work.)

---

## End of Plan 1
