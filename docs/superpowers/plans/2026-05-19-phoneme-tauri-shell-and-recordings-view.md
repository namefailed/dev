# Phoneme — Plan 4: Tauri Shell + RecordingsView

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Tauri desktop app's foundation — the GUI binary, the tray icon, the IPC bridge from frontend to daemon, and the hybrid master-detail RecordingsView (the home view, where users spend most of their time). By the end of this plan, Phoneme has a usable GUI: tray runs, window opens, recordings list populates from the daemon, detail pane plays audio and edits transcripts. Settings, Doctor, and Wizard come in Plan 5.

**Depends on:** Plans 1, 2, 3a, 3b complete.

**Architecture:** Tauri 2 desktop app with two halves:

- **`src-tauri/`** (Rust backend): owns the tray icon, the window lifecycle, and the bridge from frontend JS to `phoneme-daemon` (via a named-pipe client). Forwards `DaemonEvent`s from the daemon to the frontend as Tauri events.
- **`frontend/`** (Vite + vanilla TypeScript): the UI. Calls into the Rust bridge via `invoke()` to send requests and listens for `daemon-event` to react to live state.

```
   ┌─────────────────────────────────────────────────┐
   │              Tauri main window                   │
   │  ┌─────────────────────────────────────────────┐│
   │  │ Frontend (Vite + TS):                       ││
   │  │   App.ts                                    ││
   │  │   ├── HeaderBar                             ││
   │  │   └── RecordingsView                        ││
   │  │       ├── RecordingsList (table)            ││
   │  │       └── RecordingDetail (pane)            ││
   │  └────────────▲────────────────────────────────┘│
   │       invoke() │ listen()                       │
   │   ┌────────────▼────────────────────────────────┐│
   │   │ Tauri backend (src-tauri):                  ││
   │   │   commands.rs  — #[tauri::command] handlers ││
   │   │   bridge.rs    — NamedPipeTransport client  ││
   │   │   tray.rs      — tray icon + menu           ││
   │   │   events.rs    — DaemonEvent → emit()       ││
   │   └────────────▲────────────────────────────────┘│
   └────────────────┼─────────────────────────────────┘
                    │ \\.\pipe\phoneme-daemon
                    ▼
              phoneme-daemon
```

**Tech stack:** Tauri 2 (desktop), Vite 5, TypeScript 5, wavesurfer.js 7 (waveform player), the existing Rust workspace.

**Spec reference:** `~/dev/phoneme/docs/superpowers/specs/2026-05-19-phoneme-design.md` — milestones 12 and 13.

---

## File structure for this plan

```
src-tauri/
├── Cargo.toml                                [create]
├── tauri.conf.json                           [create — Tauri config]
├── build.rs                                  [create — Tauri build script]
├── icons/                                    [create — tray + window icons]
│   ├── icon.ico                              [create]
│   ├── tray-idle.png
│   ├── tray-recording.png
│   ├── tray-transcribing.png
│   └── tray-error.png
├── capabilities/
│   └── default.json                          [create]
└── src/
    ├── main.rs                               [create — Tauri entrypoint]
    ├── lib.rs                                [create — library code separated for testability]
    ├── bridge.rs                             [create — IPC client wrapping phoneme-ipc]
    ├── commands.rs                           [create — #[tauri::command] surface]
    ├── tray.rs                               [create — tray icon + menu + state-driven icon swaps]
    ├── events.rs                             [create — DaemonEvent → app.emit_all]
    └── window.rs                             [create — window open/close/minimize]

frontend/
├── package.json                              [create]
├── tsconfig.json                             [create]
├── vite.config.ts                            [create]
├── index.html                                [create]
└── src/
    ├── main.ts                               [create — app bootstrap]
    ├── App.ts                                [create — top-level shell]
    ├── router.ts                             [create — view switching]
    ├── services/
    │   ├── ipc.ts                            [create — invoke() wrapper]
    │   └── events.ts                         [create — listen() wrapper]
    ├── state/
    │   ├── store.ts                          [create — simple reactive state]
    │   └── shortcuts.ts                      [create — global keyboard shortcuts]
    ├── components/
    │   ├── HeaderBar.ts                      [create]
    │   ├── RecordingsView/
    │   │   ├── index.ts                      [create — RecordingsView orchestrator]
    │   │   ├── RecordingsList.ts             [create — multi-column table]
    │   │   ├── RecordingDetail.ts            [create — right pane content]
    │   │   ├── WaveformPlayer.ts             [create — wavesurfer.js wrapper]
    │   │   ├── TranscriptEditor.ts           [create — autosize textarea]
    │   │   ├── ActionRow.ts                  [create — play/copy/replay/delete buttons]
    │   │   ├── Splitter.ts                   [create — drag-to-resize divider]
    │   │   └── styles.css                    [create]
    │   └── shared/
    │       ├── Button.ts                     [create]
    │       ├── StatusPill.ts                 [create]
    │       └── styles.css                    [create]
    └── styles/
        ├── theme.css                         [create — Catppuccin Mocha tokens]
        └── reset.css                         [create]
```

Modifications:
- `Cargo.toml` (workspace) — add `"src-tauri"` to `members`.

---

## Task 1: Workspace add + Tauri scaffold + frontend bootstrap

**Files:**
- Modify: `Cargo.toml` (workspace)
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/capabilities/default.json`
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.ts`

- [ ] **Step 1: Install tauri-cli**

Run: `cargo install tauri-cli --version "^2.0"`
Expected: installs the `cargo tauri` subcommand.

- [ ] **Step 2: Workspace + dependencies**

In root `Cargo.toml`:
- Add `"src-tauri"` to `[workspace] members`.
- Append to `[workspace.dependencies]`:

```toml
tauri = { version = "2", features = [] }
tauri-build = "2"
tauri-plugin-shell = "2"
```

- [ ] **Step 3: `src-tauri/Cargo.toml`**

```toml
[package]
name = "phoneme-tray"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
name = "phoneme_tray_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[[bin]]
name = "phoneme-tray"
path = "src/main.rs"

[build-dependencies]
tauri-build = { workspace = true }

[dependencies]
phoneme-core = { path = "../crates/phoneme-core" }
phoneme-ipc = { path = "../crates/phoneme-ipc" }
tauri = { workspace = true, features = ["tray-icon", "image-png"] }
tauri-plugin-shell.workspace = true
tokio.workspace = true
serde.workspace = true
serde_json.workspace = true
anyhow.workspace = true
thiserror.workspace = true
tracing.workspace = true
futures = "0.3"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 4: `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Phoneme",
  "version": "1.0.0-dev",
  "identifier": "com.namefailed.phoneme",
  "build": {
    "frontendDist": "../frontend/dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm --dir ../frontend dev",
    "beforeBuildCommand": "pnpm --dir ../frontend build"
  },
  "app": {
    "windows": [
      {
        "title": "Phoneme",
        "width": 1100,
        "height": 720,
        "minWidth": 800,
        "minHeight": 500,
        "visible": false,
        "decorations": true,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    },
    "trayIcon": {
      "iconPath": "icons/tray-idle.png",
      "iconAsTemplate": false
    }
  },
  "bundle": {
    "active": true,
    "icon": ["icons/icon.ico"],
    "category": "Productivity",
    "shortDescription": "Local-first voice notes",
    "longDescription": "Phoneme — local-first voice notes for Windows. Press a hotkey, speak, get a transcript via your locally-running LLM.",
    "targets": ["msi"]
  }
}
```

- [ ] **Step 5: `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 6: `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for Phoneme",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "core:event:default",
    "shell:default"
  ]
}
```

- [ ] **Step 7: `src-tauri/src/main.rs`**

```rust
//! Phoneme tray app entrypoint.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8: Create placeholder icons**

A real release needs proper icons. For now, create transparent PNGs as placeholders so the build doesn't fail:

```bash
# In src-tauri/icons/, create 32x32 placeholder PNGs:
# tray-idle.png, tray-recording.png, tray-transcribing.png, tray-error.png
# Plus icon.ico for the bundle.
```

The build process will use the canonical Tauri icon if these are missing — generate via `cargo tauri icon` once a real source PNG is available.

- [ ] **Step 9: `frontend/package.json`**

```json
{
  "name": "phoneme-frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "wavesurfer.js": "^7.7.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.4.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 10: `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 11: `frontend/vite.config.ts`**

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

- [ ] **Step 12: `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Phoneme</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 13: `frontend/src/main.ts`**

```typescript
const app = document.getElementById("app");
if (app) {
  app.innerHTML = "<p>Phoneme — stub. UI to come.</p>";
}
```

- [ ] **Step 14: Install frontend deps + verify Tauri builds**

```bash
cd frontend && pnpm install && cd ..
cargo tauri build --debug
```

Expected: the Tauri build produces a working `phoneme-tray.exe` in `src-tauri/target/debug/`. The window is invisible (per config); we'll trigger visibility via tray menu in Task 4.

- [ ] **Step 15: Commit**

```bash
git add Cargo.toml src-tauri/ frontend/
git commit -m "scaffold Tauri shell + Vite/TS frontend"
```

---

## Task 2: Backend bridge — connect to phoneme-daemon over IPC

**Files:**
- Create: `src-tauri/src/bridge.rs`
- Modify: `src-tauri/src/main.rs`

The bridge is a long-lived `NamedPipeTransport` (one for request/response, separate connections for `subscribe`). Wrapped in a `tokio::sync::Mutex` so multiple frontend invocations can use it safely.

- [ ] **Step 1: Create `src-tauri/src/bridge.rs`**

```rust
//! Connection to phoneme-daemon — wraps phoneme-ipc client.

use phoneme_core::Config;
use phoneme_ipc::{NamedPipeTransport, Request, Response, Transport};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Bridge {
    inner: Arc<Mutex<NamedPipeTransport>>,
    pipe_name: String,
    pub config: Arc<Config>,
}

impl Bridge {
    pub async fn connect(config: Config) -> anyhow::Result<Self> {
        let pipe_name = config.daemon.pipe_name.clone();
        let transport = NamedPipeTransport::connect(&pipe_name).await?;
        Ok(Self {
            inner: Arc::new(Mutex::new(transport)),
            pipe_name,
            config: Arc::new(config),
        })
    }

    pub async fn reconnect(&self) -> anyhow::Result<()> {
        let new_transport = NamedPipeTransport::connect(&self.pipe_name).await?;
        let mut guard = self.inner.lock().await;
        *guard = new_transport;
        Ok(())
    }

    pub async fn request(&self, req: Request) -> anyhow::Result<Response> {
        let mut guard = self.inner.lock().await;
        match guard.request(req.clone()).await {
            Ok(r) => Ok(r),
            Err(_) => {
                drop(guard);
                self.reconnect().await?;
                let mut guard = self.inner.lock().await;
                Ok(guard.request(req).await?)
            }
        }
    }
}
```

- [ ] **Step 2: Wire into main.rs**

```rust
//! Phoneme tray app entrypoint.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;

use bridge::Bridge;

#[tokio::main]
async fn main() {
    let config = phoneme_core::Config::default();
    let bridge = match Bridge::connect(config).await {
        Ok(b) => Some(b),
        Err(e) => {
            tracing::warn!(error = %e, "could not connect to daemon at startup; will retry on first action");
            None
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(bridge)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify build**

Run: `cargo build -p phoneme-tray`
Expected: clean. (The frontend doesn't need to rebuild for this Rust-only change.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "phoneme-tray: add Bridge (NamedPipeTransport wrapper with reconnect)"
```

---

## Task 3: Tauri commands — frontend ↔ backend bridge

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

Each `#[tauri::command]` is a typed RPC the frontend can invoke. They translate to `Request` → daemon, then unwrap the `Response::Ok` JSON value back to the frontend.

- [ ] **Step 1: Create `src-tauri/src/commands.rs`**

```rust
//! Tauri commands — frontend invokes these via `invoke("…")`.

use crate::bridge::Bridge;
use phoneme_core::{ListFilter, RecordMode, RecordingId};
use phoneme_ipc::{Request, Response};
use serde_json::Value;
use tauri::State;

type Br<'r> = State<'r, Option<Bridge>>;

async fn forward(bridge: &Option<Bridge>, req: Request) -> Result<Value, String> {
    let bridge = bridge
        .as_ref()
        .ok_or_else(|| "daemon not reachable; start it with `phoneme daemon --start`".to_string())?;
    match bridge.request(req).await {
        Ok(Response::Ok(v)) => Ok(v),
        Ok(Response::Err(e)) => Err(format!("{}: {}", json_kind(&e.kind), e.message)),
        Err(e) => Err(format!("transport error: {e}")),
    }
}

fn json_kind(k: &phoneme_ipc::IpcErrorKind) -> &'static str {
    use phoneme_ipc::IpcErrorKind::*;
    match k {
        AlreadyRecording => "already_recording",
        NotRecording => "not_recording",
        NotFound => "not_found",
        InvalidConfig => "invalid_config",
        LlmUnreachable => "llm_unreachable",
        LlmTimeout => "llm_timeout",
        HookFailed => "hook_failed",
        DaemonNotRunning => "daemon_not_running",
        PipeInUse => "pipe_in_use",
        ShuttingDown => "shutting_down",
        Io => "io",
        Internal => "internal",
    }
}

#[tauri::command]
pub async fn list_recordings(bridge: Br<'_>, limit: Option<u32>) -> Result<Value, String> {
    let filter = ListFilter { limit, ..Default::default() };
    forward(&bridge, Request::ListRecordings { filter }).await
}

#[tauri::command]
pub async fn get_recording(bridge: Br<'_>, id: String) -> Result<Value, String> {
    forward(&bridge, Request::GetRecording { id: RecordingId::from_string(id) }).await
}

#[tauri::command]
pub async fn delete_recording(bridge: Br<'_>, id: String, keep_audio: bool) -> Result<Value, String> {
    forward(&bridge, Request::DeleteRecording { id: RecordingId::from_string(id), keep_audio }).await
}

#[tauri::command]
pub async fn record_start(bridge: Br<'_>, mode: String) -> Result<Value, String> {
    let mode = match mode.as_str() {
        "hold" => RecordMode::Hold,
        "oneshot" => RecordMode::Oneshot,
        other => {
            if let Some(secs) = other.strip_prefix("duration:") {
                let secs: u32 = secs.parse().map_err(|_| "bad duration")?;
                RecordMode::Duration { secs }
            } else {
                return Err(format!("unknown mode: {other}"));
            }
        }
    };
    forward(&bridge, Request::RecordStart { mode }).await
}

#[tauri::command]
pub async fn record_stop(bridge: Br<'_>) -> Result<Value, String> {
    forward(&bridge, Request::RecordStop).await
}

#[tauri::command]
pub async fn record_cancel(bridge: Br<'_>) -> Result<Value, String> {
    forward(&bridge, Request::RecordCancel).await
}

#[tauri::command]
pub async fn replay_recording(bridge: Br<'_>, id: String) -> Result<Value, String> {
    forward(&bridge, Request::ReplayRecording { id: RecordingId::from_string(id) }).await
}

#[tauri::command]
pub async fn refire_hook(bridge: Br<'_>, id: String) -> Result<Value, String> {
    forward(&bridge, Request::RefireHook { id: RecordingId::from_string(id) }).await
}

#[tauri::command]
pub async fn update_transcript(bridge: Br<'_>, id: String, text: String) -> Result<Value, String> {
    forward(&bridge, Request::UpdateTranscript { id: RecordingId::from_string(id), text }).await
}

#[tauri::command]
pub async fn daemon_status(bridge: Br<'_>) -> Result<Value, String> {
    forward(&bridge, Request::DaemonStatus).await
}
```

- [ ] **Step 2: Register commands in main.rs**

```rust
mod commands;

// In tauri::Builder::default():
.invoke_handler(tauri::generate_handler![
    commands::list_recordings,
    commands::get_recording,
    commands::delete_recording,
    commands::record_start,
    commands::record_stop,
    commands::record_cancel,
    commands::replay_recording,
    commands::refire_hook,
    commands::update_transcript,
    commands::daemon_status,
])
```

- [ ] **Step 3: Verify build**

Run: `cargo build -p phoneme-tray`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "phoneme-tray: add Tauri commands for daemon IPC operations"
```

---

## Task 4: Tray icon + menu + state-driven icon swaps

**Files:**
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/main.rs`

Per spec, the tray has 6 states (idle/recording/transcribing/catchup/llm-error/hook-failed) and a right-click menu (Record/Stop, Show window, Doctor, Settings, Pause hotkey, Quit). Icons swap based on `DaemonEvent` updates.

- [ ] **Step 1: Create `src-tauri/src/tray.rs`**

```rust
//! Tray icon — visual state + menu.

use anyhow::Result;
use tauri::{
    image::Image,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Idle,
    Recording,
    Transcribing,
    CatchupBacklog(u32),
    LlmError,
    HookFailed,
}

impl TrayState {
    pub fn icon_path(&self) -> &'static str {
        match self {
            Self::Idle => "icons/tray-idle.png",
            Self::Recording => "icons/tray-recording.png",
            Self::Transcribing | Self::CatchupBacklog(_) => "icons/tray-transcribing.png",
            Self::LlmError | Self::HookFailed => "icons/tray-error.png",
        }
    }

    pub fn tooltip(&self) -> String {
        match self {
            Self::Idle => "Phoneme — ready".into(),
            Self::Recording => "Recording…".into(),
            Self::Transcribing => "Transcribing".into(),
            Self::CatchupBacklog(n) => format!("{n} pending — LLM unreachable"),
            Self::LlmError => "LLM unreachable — click to open Doctor".into(),
            Self::HookFailed => "Last hook failed — click to view".into(),
        }
    }
}

pub fn install(app: &AppHandle) -> Result<TrayIcon> {
    let record_item = MenuItem::with_id(app, "record", "● Record", true, None::<&str>)?;
    let stop_item = MenuItem::with_id(app, "stop", "◼ Stop", false, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show_window", "Show window", true, None::<&str>)?;
    let doctor_item = MenuItem::with_id(app, "doctor", "Doctor", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &record_item,
            &stop_item,
            &PredefinedMenuItem::separator(app)?,
            &show_item,
            &doctor_item,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon(Image::from_path(TrayState::Idle.icon_path())?)
        .tooltip(TrayState::Idle.tooltip())
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    Ok(tray)
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        "record" => {
            let _ = app.emit("menu:record", ());
        }
        "stop" => {
            let _ = app.emit("menu:stop", ());
        }
        "show_window" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "doctor" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit("nav:doctor", ());
            }
        }
        "settings" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit("nav:settings", ());
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

fn handle_tray_event(tray: &TrayIcon, event: TrayIconEvent) {
    use tauri::tray::{MouseButton, MouseButtonState};
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        if let Some(window) = tray.app_handle().get_webview_window("main") {
            let visible = window.is_visible().unwrap_or(false);
            if visible {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

/// Switch the tray icon and tooltip to reflect a new state.
pub fn update_state(tray: &TrayIcon, state: TrayState) -> Result<()> {
    tray.set_icon(Some(Image::from_path(state.icon_path())?))?;
    tray.set_tooltip(Some(state.tooltip()))?;
    Ok(())
}
```

- [ ] **Step 2: Wire into main.rs setup hook**

```rust
mod tray;

tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(bridge)
    .setup(|app| {
        let _tray = tray::install(&app.handle())?;
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![...])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

- [ ] **Step 3: Run and verify**

Run: `cargo tauri dev`
Expected: a tray icon appears in the system tray. Right-clicking shows the menu. Left-clicking toggles the window (if visible at all).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "phoneme-tray: add tray icon + menu + state machine"
```

---

## Task 5: Event subscription bridge

**Files:**
- Create: `src-tauri/src/events.rs`
- Modify: `src-tauri/src/main.rs`

A background tokio task subscribes to `DaemonEvent`s via the bridge and re-emits them as Tauri events (`daemon-event`). The frontend listens with `listen("daemon-event", …)`.

- [ ] **Step 1: Create `src-tauri/src/events.rs`**

```rust
//! Bridge daemon events to the frontend via Tauri's emit().

use crate::bridge::Bridge;
use crate::tray::{self, TrayState};
use futures::StreamExt;
use phoneme_ipc::{DaemonEvent, NamedPipeTransport, Transport};
use tauri::{AppHandle, Emitter, Manager};

pub fn spawn(app: AppHandle, bridge: Bridge) {
    tokio::spawn(async move {
        loop {
            match run_once(app.clone(), bridge.clone()).await {
                Ok(()) => break,
                Err(e) => {
                    tracing::warn!(error = %e, "event stream ended; reconnecting in 2s");
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    });
}

async fn run_once(app: AppHandle, bridge: Bridge) -> anyhow::Result<()> {
    // Open a SEPARATE pipe connection for the subscription (per spec: the
    // pipe gets dedicated to event streaming after SubscribeEvents).
    let mut sub_transport = NamedPipeTransport::connect(&bridge.config.daemon.pipe_name).await?;
    let mut stream = sub_transport.subscribe().await?;

    while let Some(item) = stream.next().await {
        match item {
            Ok(event) => {
                // Update tray state for relevant events.
                if let Some(state) = derive_tray_state(&event) {
                    if let Some(tray) = app.tray_by_id("main") {
                        let _ = tray::update_state(&tray, state);
                    }
                }
                // Re-emit to the frontend.
                let _ = app.emit("daemon-event", &event);
            }
            Err(e) => {
                tracing::warn!(error = %e, "subscribe stream error");
                break;
            }
        }
    }
    Ok(())
}

fn derive_tray_state(event: &DaemonEvent) -> Option<TrayState> {
    match event {
        DaemonEvent::RecordingStarted { .. } => Some(TrayState::Recording),
        DaemonEvent::RecordingStopped { .. } => Some(TrayState::Transcribing),
        DaemonEvent::TranscriptionDone { .. } | DaemonEvent::HookDone { .. } => Some(TrayState::Idle),
        DaemonEvent::TranscriptionFailed { .. } => Some(TrayState::LlmError),
        DaemonEvent::HookFailed { .. } => Some(TrayState::HookFailed),
        DaemonEvent::QueueDepthChanged { pending, .. } if *pending > 0 => {
            Some(TrayState::CatchupBacklog(*pending as u32))
        }
        DaemonEvent::LlmStatusChanged { reachable: false } => Some(TrayState::LlmError),
        DaemonEvent::LlmStatusChanged { reachable: true } => Some(TrayState::Idle),
        _ => None,
    }
}
```

- [ ] **Step 2: Wire into main.rs setup**

```rust
mod events;

.setup(|app| {
    let _tray = tray::install(&app.handle())?;
    if let Some(bridge) = app.state::<Option<Bridge>>().inner().clone() {
        events::spawn(app.handle().clone(), bridge);
    }
    Ok(())
})
```

The `state.inner().clone()` only works if `Bridge` is `Clone` (it is — Arcs inside).

- [ ] **Step 3: Verify it runs**

With the daemon running in another terminal (`cargo run -p phoneme-daemon -- --foreground`):
Run: `cargo tauri dev`
Trigger a recording from the CLI: `cargo run -p phoneme -- record --oneshot` (this needs synthetic audio support from Plan 3a's test-mode feature, OR a real mic).
Expected: the tray icon changes to "recording" and back to "idle" as the pipeline runs.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "phoneme-tray: bridge DaemonEvents to frontend + tray state"
```

---

## Task 6: Frontend foundation — services, state, theme

**Files:**
- Create: `frontend/src/services/ipc.ts`
- Create: `frontend/src/services/events.ts`
- Create: `frontend/src/state/store.ts`
- Create: `frontend/src/styles/theme.css`
- Create: `frontend/src/styles/reset.css`
- Create: `frontend/src/App.ts`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: `frontend/src/services/ipc.ts`**

```typescript
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type Recording = {
  id: string;
  started_at: string;
  duration_ms: number;
  audio_path: string;
  transcript: string | null;
  model: string | null;
  status: string;
  error_kind?: string | null;
  error_message?: string | null;
  hook_command?: string | null;
  hook_exit_code?: number | null;
  hook_duration_ms?: number | null;
  transcribed_at?: string | null;
  hook_ran_at?: string | null;
};

export type RecordMode = "hold" | "oneshot" | `duration:${number}`;

export async function listRecordings(limit?: number): Promise<Recording[]> {
  return await tauriInvoke<Recording[]>("list_recordings", { limit });
}

export async function getRecording(id: string): Promise<Recording> {
  return await tauriInvoke<Recording>("get_recording", { id });
}

export async function deleteRecording(id: string, keepAudio = false): Promise<void> {
  await tauriInvoke("delete_recording", { id, keepAudio });
}

export async function recordStart(mode: RecordMode): Promise<{ id: string }> {
  return await tauriInvoke<{ id: string }>("record_start", { mode });
}

export async function recordStop(): Promise<void> {
  await tauriInvoke("record_stop");
}

export async function recordCancel(): Promise<void> {
  await tauriInvoke("record_cancel");
}

export async function replayRecording(id: string): Promise<void> {
  await tauriInvoke("replay_recording", { id });
}

export async function refireHook(id: string): Promise<void> {
  await tauriInvoke("refire_hook", { id });
}

export async function updateTranscript(id: string, text: string): Promise<void> {
  await tauriInvoke("update_transcript", { id, text });
}

export async function daemonStatus(): Promise<{ running: boolean; pid: number }> {
  return await tauriInvoke("daemon_status");
}
```

- [ ] **Step 2: `frontend/src/services/events.ts`**

```typescript
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type DaemonEvent =
  | { event: "recording_started"; id: string; started_at: string }
  | { event: "recording_stopped"; id: string; duration_ms: number; audio_path: string }
  | { event: "transcription_started"; id: string }
  | { event: "transcription_done"; id: string; transcript: string }
  | { event: "transcription_failed"; id: string; error: string }
  | { event: "hook_started"; id: string }
  | { event: "hook_done"; id: string; exit_code: number }
  | { event: "hook_failed"; id: string; error: string }
  | { event: "queue_depth_changed"; pending: number; processing: number; failed: number }
  | { event: "llm_status_changed"; reachable: boolean }
  | { event: "recording_deleted"; id: string }
  | { event: "transcript_updated"; id: string };

export type EventHandler = (event: DaemonEvent) => void;

export async function subscribe(handler: EventHandler): Promise<UnlistenFn> {
  return await listen<DaemonEvent>("daemon-event", (e) => handler(e.payload));
}

export async function onMenu(name: string, handler: () => void): Promise<UnlistenFn> {
  return await listen(`menu:${name}`, () => handler());
}

export async function onNav(name: string, handler: () => void): Promise<UnlistenFn> {
  return await listen(`nav:${name}`, () => handler());
}
```

- [ ] **Step 3: `frontend/src/state/store.ts`**

```typescript
//! Tiny reactive store — observable state without a framework.

export type Subscriber<T> = (value: T) => void;

export class Store<T> {
  private value: T;
  private subscribers = new Set<Subscriber<T>>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(updater: T | ((prev: T) => T)): void {
    const next = typeof updater === "function" ? (updater as (prev: T) => T)(this.value) : updater;
    if (next === this.value) return;
    this.value = next;
    for (const sub of this.subscribers) sub(next);
  }

  subscribe(sub: Subscriber<T>): () => void {
    this.subscribers.add(sub);
    sub(this.value);
    return () => this.subscribers.delete(sub);
  }
}
```

- [ ] **Step 4: `frontend/src/styles/reset.css`**

```css
*, *::before, *::after {
  box-sizing: border-box;
}
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--bg-deep);
  color: var(--fg-default);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}
button {
  font: inherit;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
}
input, textarea {
  font: inherit;
  background: none;
  border: none;
  color: inherit;
}
```

- [ ] **Step 5: `frontend/src/styles/theme.css` — Catppuccin Mocha**

```css
:root {
  --bg-deep: #11111b;
  --bg-elevated: #1e1e2e;
  --bg-surface: #181825;
  --border: #45475a;
  --border-subtle: #313244;
  --fg-default: #cdd6f4;
  --fg-muted: #9399b2;
  --fg-faded: #6c7086;
  --accent: #cba6f7;
  --accent-fg: #11111b;
  --ok: #a6e3a1;
  --warn: #f9e2af;
  --err: #f38ba8;
  --info: #89b4fa;
}
```

- [ ] **Step 6: `frontend/src/App.ts`**

```typescript
export class App {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="app-shell">
        <p>Phoneme — loading…</p>
      </div>
    `;
  }
}
```

- [ ] **Step 7: Update `frontend/src/main.ts`**

```typescript
import "./styles/theme.css";
import "./styles/reset.css";
import { App } from "./App";

const root = document.getElementById("app");
if (root) {
  new App(root);
}
```

- [ ] **Step 8: Verify dev build**

```bash
cd frontend && pnpm dev
```

Open http://localhost:5173 (or run `cargo tauri dev`). The window shows "Phoneme — loading…" with the dark theme applied.

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "frontend: add services + state store + theme"
```

---

## Task 7: HeaderBar component

**Files:**
- Create: `frontend/src/components/HeaderBar.ts`
- Create: `frontend/src/components/shared/styles.css`

- [ ] **Step 1: `frontend/src/components/HeaderBar.ts`**

```typescript
//! Always-visible top bar: search, filter pills, settings.

import "./shared/styles.css";

export type HeaderBarState = {
  searchQuery: string;
  statusFilter: string | null;
  dateFilter: string | null;
};

export type HeaderBarCallbacks = {
  onSearchChange: (q: string) => void;
  onOpenSettings: () => void;
};

export class HeaderBar {
  private container: HTMLElement;
  private callbacks: HeaderBarCallbacks;

  constructor(container: HTMLElement, callbacks: HeaderBarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="headerbar">
        <input type="search" class="search" placeholder="Search transcripts…" id="hb-search" />
        <span class="filter-pill">All time ▾</span>
        <span class="filter-pill">All status ▾</span>
        <button class="icon-btn" id="hb-settings" aria-label="Settings">⚙</button>
      </div>
    `;
    const search = this.container.querySelector<HTMLInputElement>("#hb-search");
    if (search) {
      search.addEventListener("input", (e) => {
        const q = (e.target as HTMLInputElement).value;
        this.callbacks.onSearchChange(q);
      });
    }
    const settings = this.container.querySelector("#hb-settings");
    if (settings) {
      settings.addEventListener("click", () => this.callbacks.onOpenSettings());
    }
  }
}
```

- [ ] **Step 2: `frontend/src/components/shared/styles.css`**

```css
.headerbar {
  background: var(--bg-surface);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 10px;
  align-items: center;
  flex-shrink: 0;
}
.headerbar .search {
  background: var(--bg-deep);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 6px 12px;
  color: var(--fg-default);
  flex: 1;
  font-size: 13px;
}
.headerbar .search:focus {
  outline: none;
  border-color: var(--accent);
}
.headerbar .filter-pill {
  background: rgba(203,166,247,0.15);
  color: var(--accent);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  border: 1px solid rgba(203,166,247,0.3);
  cursor: pointer;
}
.headerbar .icon-btn {
  background: rgba(255,255,255,0.04);
  border-radius: 6px;
  padding: 4px 10px;
  color: var(--fg-muted);
  font-size: 16px;
}
.headerbar .icon-btn:hover {
  color: var(--fg-default);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
}
.status-pill.done    { background: rgba(166,227,161,0.15); color: var(--ok); }
.status-pill.failed  { background: rgba(243,139,168,0.15); color: var(--err); }
.status-pill.pending { background: rgba(249,226,175,0.15); color: var(--warn); }
.status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--fg-muted);
}
.status-dot.done    { background: var(--ok); }
.status-dot.failed  { background: var(--err); }
.status-dot.pending { background: var(--warn); }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "frontend: add HeaderBar component + shared styles"
```

---

## Task 8: RecordingsList — the multi-column table

**Files:**
- Create: `frontend/src/components/RecordingsView/RecordingsList.ts`
- Create: `frontend/src/components/RecordingsView/styles.css`

- [ ] **Step 1: `frontend/src/components/RecordingsView/RecordingsList.ts`**

```typescript
import { listRecordings, type Recording } from "../../services/ipc";
import { Store } from "../../state/store";

import "./styles.css";

export type RecordingsListState = {
  recordings: Recording[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
};

export class RecordingsList {
  private container: HTMLElement;
  private state: Store<RecordingsListState>;
  private onSelect: (id: string) => void;

  constructor(container: HTMLElement, state: Store<RecordingsListState>, onSelect: (id: string) => void) {
    this.container = container;
    this.state = state;
    this.onSelect = onSelect;
    state.subscribe(() => this.render());
    this.render();
  }

  async refresh() {
    this.state.set({ ...this.state.get(), loading: true, error: null });
    try {
      const rows = await listRecordings(200);
      this.state.set({ ...this.state.get(), recordings: rows, loading: false });
    } catch (e) {
      this.state.set({ ...this.state.get(), error: String(e), loading: false });
    }
  }

  render() {
    const s = this.state.get();
    if (s.loading && s.recordings.length === 0) {
      this.container.innerHTML = `<div class="empty">Loading…</div>`;
      return;
    }
    if (s.error) {
      this.container.innerHTML = `<div class="empty error">${s.error}</div>`;
      return;
    }
    if (s.recordings.length === 0) {
      this.container.innerHTML = `<div class="empty">
        <p>No recordings yet.</p>
        <p class="hint">Press your hotkey or run <code>phoneme record --oneshot</code>.</p>
      </div>`;
      return;
    }

    const head = `
      <div class="rec-table-head">
        <span>Time</span>
        <span>Dur</span>
        <span>Status</span>
        <span>Transcript</span>
      </div>
    `;
    const rows = s.recordings
      .map((r) => this.renderRow(r, r.id === s.selectedId))
      .join("");
    this.container.innerHTML = `<div class="rec-table">${head}${rows}</div>`;

    this.container.querySelectorAll<HTMLElement>(".rec-row").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        if (id) this.onSelect(id);
      });
    });
  }

  private renderRow(r: Recording, active: boolean): string {
    const time = formatTime(r.started_at);
    const dur = formatDuration(r.duration_ms);
    const statusClass = statusToClass(r.status);
    const preview = (r.transcript ?? truncatedError(r)).slice(0, 80);
    return `
      <div class="rec-row ${active ? "active" : ""}" data-id="${r.id}">
        <span class="rec-time">${time}</span>
        <span class="rec-dur">${dur}</span>
        <span class="rec-status"><span class="status-dot ${statusClass}"></span></span>
        <span class="rec-preview">${escapeHtml(preview)}</span>
      </div>
    `;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)
    .toString()
    .padStart(2, "0")}s`;
}

function statusToClass(status: string): string {
  if (status === "done") return "done";
  if (status === "transcribe_failed" || status === "hook_failed") return "failed";
  return "pending";
}

function truncatedError(r: Recording): string {
  if (r.error_message) return `(${r.error_message})`;
  if (r.status === "transcribe_failed") return "(transcription failed)";
  if (r.status === "hook_failed") return "(hook failed)";
  return "(processing…)";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 2: `frontend/src/components/RecordingsView/styles.css`**

```css
.rec-table {
  height: 100%;
  overflow: auto;
  background: var(--bg-elevated);
}
.rec-table-head {
  position: sticky;
  top: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  padding: 8px 14px;
  display: grid;
  grid-template-columns: 80px 60px 40px 1fr;
  gap: 10px;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--fg-faded);
  letter-spacing: 0.5px;
}
.rec-row {
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  display: grid;
  grid-template-columns: 80px 60px 40px 1fr;
  gap: 10px;
  font-size: 13px;
  color: var(--fg-default);
  cursor: pointer;
}
.rec-row:hover {
  background: rgba(255,255,255,0.03);
}
.rec-row.active {
  background: rgba(203,166,247,0.12);
  border-left: 3px solid var(--accent);
  padding-left: 11px;
}
.rec-time,
.rec-dur {
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.rec-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--fg-muted);
}
.empty .hint {
  font-size: 12px;
  color: var(--fg-faded);
}
.empty code {
  background: var(--bg-surface);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 12px;
}
.empty.error {
  color: var(--err);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "frontend: add RecordingsList (multi-column table + status dots)"
```

---

## Task 9: RecordingDetail — right pane with waveform + transcript editor

**Files:**
- Create: `frontend/src/components/RecordingsView/RecordingDetail.ts`
- Create: `frontend/src/components/RecordingsView/WaveformPlayer.ts`
- Create: `frontend/src/components/RecordingsView/TranscriptEditor.ts`
- Create: `frontend/src/components/RecordingsView/ActionRow.ts`

- [ ] **Step 1: `frontend/src/components/RecordingsView/WaveformPlayer.ts`**

```typescript
import WaveSurfer from "wavesurfer.js";
import { convertFileSrc } from "@tauri-apps/api/core";

export class WaveformPlayer {
  private wavesurfer: WaveSurfer | null = null;

  mount(container: HTMLElement, audioPath: string) {
    if (this.wavesurfer) {
      this.wavesurfer.destroy();
    }
    this.wavesurfer = WaveSurfer.create({
      container,
      waveColor: "#585b70",
      progressColor: "#cba6f7",
      cursorColor: "#cdd6f4",
      barWidth: 2,
      barGap: 1,
      height: 60,
      url: convertFileSrc(audioPath),
    });
  }

  togglePlay() {
    if (!this.wavesurfer) return;
    this.wavesurfer.playPause();
  }

  destroy() {
    this.wavesurfer?.destroy();
    this.wavesurfer = null;
  }
}
```

- [ ] **Step 2: `frontend/src/components/RecordingsView/TranscriptEditor.ts`**

```typescript
import { updateTranscript } from "../../services/ipc";

export class TranscriptEditor {
  private container: HTMLElement;
  private id: string;
  private initial: string;
  private current: string;
  private onDirtyChange: (dirty: boolean) => void;

  constructor(container: HTMLElement, id: string, initial: string, onDirtyChange: (dirty: boolean) => void) {
    this.container = container;
    this.id = id;
    this.initial = initial;
    this.current = initial;
    this.onDirtyChange = onDirtyChange;
    this.render();
  }

  private render() {
    this.container.innerHTML = `
      <textarea class="transcript-textarea" rows="6">${escape(this.initial)}</textarea>
    `;
    const ta = this.container.querySelector<HTMLTextAreaElement>(".transcript-textarea");
    if (!ta) return;
    autosize(ta);
    ta.addEventListener("input", () => {
      this.current = ta.value;
      this.onDirtyChange(this.current !== this.initial);
    });
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        this.save();
      }
    });
  }

  async save() {
    if (this.current === this.initial) return;
    await updateTranscript(this.id, this.current);
    this.initial = this.current;
    this.onDirtyChange(false);
  }
}

function autosize(ta: HTMLTextAreaElement) {
  const resize = () => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  };
  ta.addEventListener("input", resize);
  resize();
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

- [ ] **Step 3: `frontend/src/components/RecordingsView/ActionRow.ts`**

```typescript
import { deleteRecording, refireHook, replayRecording } from "../../services/ipc";

export type ActionRowCallbacks = {
  onTogglePlay: () => void;
  onRefresh: () => void;
};

export class ActionRow {
  private container: HTMLElement;
  private id: string;
  private cbs: ActionRowCallbacks;

  constructor(container: HTMLElement, id: string, cbs: ActionRowCallbacks) {
    this.container = container;
    this.id = id;
    this.cbs = cbs;
    this.render();
  }

  private render() {
    this.container.innerHTML = `
      <div class="action-row">
        <button class="primary" data-act="play">▶ Play</button>
        <button data-act="replay">↻ Re-transcribe</button>
        <button data-act="refire">⚡ Re-fire hook</button>
        <button data-act="copy">📋 Copy</button>
        <button data-act="reveal">📂 Reveal</button>
        <button class="danger" data-act="delete">🗑 Delete</button>
      </div>
    `;
    this.container.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => this.handle(btn.dataset.act!));
    });
  }

  private async handle(act: string) {
    if (act === "play") this.cbs.onTogglePlay();
    else if (act === "replay") {
      await replayRecording(this.id);
      this.cbs.onRefresh();
    } else if (act === "refire") {
      await refireHook(this.id);
      this.cbs.onRefresh();
    } else if (act === "delete") {
      if (confirm("Delete this recording?")) {
        await deleteRecording(this.id, false);
        this.cbs.onRefresh();
      }
    }
  }
}
```

- [ ] **Step 4: `frontend/src/components/RecordingsView/RecordingDetail.ts`**

```typescript
import { getRecording, type Recording } from "../../services/ipc";
import { ActionRow } from "./ActionRow";
import { TranscriptEditor } from "./TranscriptEditor";
import { WaveformPlayer } from "./WaveformPlayer";

export class RecordingDetail {
  private container: HTMLElement;
  private recording: Recording | null = null;
  private player = new WaveformPlayer();
  private editor: TranscriptEditor | null = null;
  private onRefresh: () => void;
  private dirty = false;

  constructor(container: HTMLElement, onRefresh: () => void) {
    this.container = container;
    this.onRefresh = onRefresh;
    this.renderEmpty();
  }

  async show(id: string) {
    try {
      this.recording = await getRecording(id);
      this.renderRecording();
    } catch (e) {
      this.container.innerHTML = `<div class="empty error">Failed to load: ${String(e)}</div>`;
    }
  }

  private renderEmpty() {
    this.container.innerHTML = `
      <div class="empty">
        <p>Select a recording to view details.</p>
      </div>
    `;
  }

  private renderRecording() {
    if (!this.recording) return;
    const r = this.recording;
    this.container.innerHTML = `
      <div class="detail">
        <div class="detail-header">
          <div>
            <div class="detail-title">${formatDate(r.started_at)}</div>
            <div class="detail-meta">${(r.duration_ms / 1000).toFixed(1)}s · ${r.status}</div>
          </div>
        </div>
        <div class="waveform" id="wf-${r.id}"></div>
        <div id="actions"></div>
        <div class="transcript-block">
          <div id="editor"></div>
        </div>
        <div class="detail-footer">
          <span>Hook exit: ${r.hook_exit_code ?? "—"}</span>
          <span>${r.audio_path}</span>
        </div>
      </div>
    `;
    const wf = this.container.querySelector<HTMLElement>(`#wf-${r.id}`);
    if (wf) this.player.mount(wf, r.audio_path);

    const actions = this.container.querySelector<HTMLElement>("#actions");
    if (actions) {
      new ActionRow(actions, r.id, {
        onTogglePlay: () => this.player.togglePlay(),
        onRefresh: () => this.onRefresh(),
      });
    }

    const editorRoot = this.container.querySelector<HTMLElement>("#editor");
    if (editorRoot) {
      this.editor = new TranscriptEditor(
        editorRoot,
        r.id,
        r.transcript ?? "",
        (d) => {
          this.dirty = d;
          // Optionally show a "save" indicator
        }
      );
    }
  }

  hasDirtyEdits(): boolean {
    return this.dirty;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
```

- [ ] **Step 5: Extend `styles.css`**

Append to `frontend/src/components/RecordingsView/styles.css`:

```css
.detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  overflow: auto;
}
.detail-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
}
.detail-title {
  font-size: 14px;
  color: var(--fg-default);
}
.detail-meta {
  color: var(--fg-muted);
  font-size: 12px;
}
.waveform {
  margin: 16px 18px;
}
.action-row {
  padding: 0 18px 12px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.action-row button {
  background: rgba(255,255,255,0.06);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--fg-default);
}
.action-row button:hover {
  background: rgba(255,255,255,0.1);
}
.action-row button.primary {
  background: var(--accent);
  color: var(--accent-fg);
}
.action-row button.danger {
  color: var(--err);
}
.transcript-block {
  margin: 0 18px 18px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 14px;
}
.transcript-textarea {
  width: 100%;
  resize: none;
  outline: none;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  color: var(--fg-default);
  background: transparent;
}
.detail-footer {
  padding: 0 18px 16px;
  color: var(--fg-muted);
  font-size: 11px;
  display: flex;
  gap: 16px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 10px;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "frontend: add RecordingDetail (waveform player + transcript editor + action row)"
```

---

## Task 10: Splitter + RecordingsView orchestrator + live updates

**Files:**
- Create: `frontend/src/components/RecordingsView/Splitter.ts`
- Create: `frontend/src/components/RecordingsView/index.ts`
- Modify: `frontend/src/App.ts`

- [ ] **Step 1: `frontend/src/components/RecordingsView/Splitter.ts`**

```typescript
//! Drag-to-resize divider between two panes.

export class Splitter {
  private container: HTMLElement;
  private leftPercent: number;
  private onChange: (percent: number) => void;

  constructor(container: HTMLElement, initial: number, onChange: (pct: number) => void) {
    this.container = container;
    this.leftPercent = initial;
    this.onChange = onChange;
    this.render();
  }

  private render() {
    this.container.innerHTML = `<div class="splitter-handle"></div>`;
    const handle = this.container.querySelector<HTMLElement>(".splitter-handle");
    if (!handle) return;
    let dragging = false;
    handle.addEventListener("mousedown", () => {
      dragging = true;
      document.body.style.cursor = "col-resize";
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
      document.body.style.cursor = "";
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const parent = this.container.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      this.leftPercent = Math.max(20, Math.min(80, pct));
      this.onChange(this.leftPercent);
    });
  }
}
```

- [ ] **Step 2: `frontend/src/components/RecordingsView/index.ts`**

```typescript
//! RecordingsView — the home view's split layout, live updates, keyboard.

import { subscribe, type DaemonEvent } from "../../services/events";
import { Store } from "../../state/store";
import { RecordingsList, type RecordingsListState } from "./RecordingsList";
import { RecordingDetail } from "./RecordingDetail";
import { Splitter } from "./Splitter";
import "./styles.css";

export class RecordingsView {
  private container: HTMLElement;
  private list: RecordingsList;
  private detail: RecordingDetail;
  private state: Store<RecordingsListState>;
  private splitPercent = 50;
  private detailVisible = true;
  private unsub: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.state = new Store<RecordingsListState>({
      recordings: [],
      selectedId: null,
      loading: false,
      error: null,
    });

    this.container.innerHTML = `
      <div class="rv-shell" id="rv-shell">
        <div class="rv-list" id="rv-list"></div>
        <div class="rv-splitter" id="rv-split"></div>
        <div class="rv-detail" id="rv-detail"></div>
      </div>
    `;

    const listRoot = this.container.querySelector<HTMLElement>("#rv-list")!;
    const detailRoot = this.container.querySelector<HTMLElement>("#rv-detail")!;
    const splitRoot = this.container.querySelector<HTMLElement>("#rv-split")!;

    this.list = new RecordingsList(listRoot, this.state, (id) => this.onSelect(id));
    this.detail = new RecordingDetail(detailRoot, () => this.refresh());
    new Splitter(splitRoot, this.splitPercent, (pct) => {
      this.splitPercent = pct;
      this.applyLayout();
    });

    this.applyLayout();
    this.refresh();
    this.subscribeToEvents();
    this.installShortcuts();
  }

  async refresh() {
    await this.list.refresh();
  }

  toggleDetail() {
    this.detailVisible = !this.detailVisible;
    this.applyLayout();
  }

  private applyLayout() {
    const shell = this.container.querySelector<HTMLElement>("#rv-shell");
    if (!shell) return;
    if (this.detailVisible) {
      shell.style.gridTemplateColumns = `${this.splitPercent}% 4px ${100 - this.splitPercent}%`;
    } else {
      shell.style.gridTemplateColumns = `1fr 0 0`;
    }
  }

  private onSelect(id: string) {
    this.state.set({ ...this.state.get(), selectedId: id });
    this.detail.show(id);
  }

  private async subscribeToEvents() {
    this.unsub = await subscribe((event: DaemonEvent) => {
      const eventName = (event as { event: string }).event;
      if (
        eventName === "recording_stopped" ||
        eventName === "transcription_done" ||
        eventName === "transcription_failed" ||
        eventName === "hook_done" ||
        eventName === "hook_failed" ||
        eventName === "recording_deleted" ||
        eventName === "transcript_updated"
      ) {
        this.refresh();
      }
    });
  }

  private installShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "\\") {
        e.preventDefault();
        this.toggleDetail();
      }
    });
  }
}
```

- [ ] **Step 3: Update `App.ts` to mount RecordingsView**

```typescript
import { HeaderBar } from "./components/HeaderBar";
import { RecordingsView } from "./components/RecordingsView";

export class App {
  private container: HTMLElement;
  private header: HeaderBar;
  private recordings: RecordingsView;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="app-shell">
        <div id="hdr"></div>
        <div id="main"></div>
      </div>
      <style>
        .app-shell { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
        #main { overflow: hidden; }
        .rv-shell {
          display: grid;
          height: 100%;
        }
        .rv-list, .rv-detail { overflow: auto; }
        .rv-splitter { background: var(--border); cursor: col-resize; }
        .rv-splitter:hover { background: var(--accent); }
      </style>
    `;

    this.header = new HeaderBar(this.container.querySelector("#hdr") as HTMLElement, {
      onSearchChange: () => {
        // Search wiring lands in Plan 5 (Settings + filtering).
      },
      onOpenSettings: () => {
        // Settings view lands in Plan 5.
      },
    });

    this.recordings = new RecordingsView(this.container.querySelector("#main") as HTMLElement);
  }
}
```

- [ ] **Step 4: Run end-to-end**

```bash
# Terminal A
cargo run -p phoneme-daemon -- --foreground
# Terminal B
cargo tauri dev
```

Expected:
- Window opens.
- Empty-state message appears (no recordings yet).
- Trigger a recording via CLI: `cargo run -p phoneme -- record --start`, wait, `cargo run -p phoneme -- record --stop`.
- After the daemon finishes the pipeline, the new recording appears in the list automatically (via DaemonEvent → refresh).
- Click the row → detail pane shows waveform + transcript editor.

- [ ] **Step 5: Lint + format**

```bash
cd frontend && pnpm type-check
cargo clippy -p phoneme-tray --all-targets -- -D warnings
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "frontend: assemble RecordingsView (split layout, live updates, keyboard shortcuts)"
```

---

## Task 11: README + final verification

**Files:**
- Create: `src-tauri/README.md`
- Create: `frontend/README.md`

- [ ] **Step 1: `src-tauri/README.md`**

```markdown
# phoneme-tray (Tauri shell)

The Tauri desktop app's Rust side — owns the tray icon, the bridge to
`phoneme-daemon`, and exposes Tauri commands the frontend invokes.

## Modules

| Module | Responsibility |
|---|---|
| `bridge` | `NamedPipeTransport` client wrapped in tokio Mutex; auto-reconnect |
| `commands` | `#[tauri::command]` surface — list/get/start/stop/etc. |
| `tray` | System tray icon + menu + state-driven icon swaps |
| `events` | Background subscriber: forwards `DaemonEvent`s to frontend |
| `window` | Window open/close/minimize helpers |

## Running

```bash
# Terminal A
cargo run -p phoneme-daemon -- --foreground
# Terminal B
cargo tauri dev
```

For production build:
```bash
cargo tauri build
```
Produces `src-tauri/target/release/bundle/msi/Phoneme_<version>_x64_en-US.msi`.
```

- [ ] **Step 2: `frontend/README.md`**

```markdown
# Phoneme — Frontend

Vite + vanilla TypeScript. No framework. Theme: Catppuccin Mocha.

## Structure

```
src/
├── main.ts                # bootstrap
├── App.ts                 # top-level shell
├── services/
│   ├── ipc.ts             # invoke() wrapper, typed Recording etc.
│   └── events.ts          # listen() wrapper, DaemonEvent type
├── state/
│   └── store.ts           # tiny reactive store
└── components/
    ├── HeaderBar.ts
    └── RecordingsView/
        ├── index.ts        # orchestrator
        ├── RecordingsList.ts
        ├── RecordingDetail.ts
        ├── WaveformPlayer.ts
        ├── TranscriptEditor.ts
        ├── ActionRow.ts
        └── Splitter.ts
```

## Dev

```bash
pnpm install
pnpm dev
```

Or launch via Tauri: `cargo tauri dev`.

## Why no framework?

The UI surface is small (4 views, all custom). Adding React/Vue/Svelte for
this would cost ~50 KB of dependency for very little leverage. Vanilla TS
with a tiny `Store` class is enough for the reactive bits, and the lack of
build-step magic makes the codebase trivially debuggable in DevTools.
```

- [ ] **Step 3: Workspace verification**

```bash
cargo test --workspace -- --test-threads=1
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cd frontend && pnpm type-check && cd ..
cargo tauri build --debug
```

Expected: all green. The Tauri build produces a working `.exe` and (in release) MSI.

- [ ] **Step 4: Mark Plan 4 complete**

```bash
git add src-tauri/README.md frontend/README.md
git commit -m "phoneme-tray + frontend: add READMEs"
git commit --allow-empty -m "milestone: Plan 4 complete (Tauri shell + RecordingsView green)"
git log --oneline | head -35
```

---

## Plan-level self-review

- **Spec coverage:**
  - Milestone 12 (Tauri shell + tray + IPC bridge) → Tasks 1, 2, 3, 4, 5 ✓
  - Milestone 13 (RecordingsView with hybrid layout) → Tasks 7, 8, 9, 10 ✓
  - Hybrid master-detail with collapsible detail (Ctrl+\) → Task 10 ✓
  - Multi-column list (Time/Dur/Status/Transcript) → Task 8 ✓
  - Waveform player (wavesurfer.js) → Task 9 ✓
  - Editable transcript with dirty tracking + Ctrl+S → Task 9 ✓
  - Live updates via DaemonEvent → Task 10 ✓
  - Tray states (6 states from spec) → Tasks 4 + 5 ✓
  - Tray menu (Record/Stop, Show, Doctor, Settings, Quit) → Task 4 ✓
  - Catppuccin Mocha theme → Task 6 ✓

- **Spec deviations:**
  - The Settings and Doctor menu items route to placeholder events (`nav:settings`, `nav:doctor`) — they only become functional in Plan 5.
  - Pause Hotkey menu entry omitted from v1.0; only added if user enables the tray hotkey (Settings → Hotkey).
  - Bulk selection (Shift-click / Ctrl-click) deferred to Plan 5's polish task.

- **Open items deferred to execution:**
  - Real tray icon PNG assets — currently placeholders. Generate proper 16x16/32x32 sets before release.
  - Window close → minimize-to-tray behavior — wire in a `WindowEvent::CloseRequested` handler in Task 4 or as a polish item.

---

## End of Plan 4
