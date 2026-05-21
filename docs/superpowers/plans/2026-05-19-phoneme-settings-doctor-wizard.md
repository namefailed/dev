# Phoneme — Plan 5: Settings + Doctor + First-Run Wizard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the GUI with the three remaining views: **Settings** (every config knob in one scrollable surface), **Doctor** (red/green checklist + fix-it actions), and the **First-Run Wizard** (7-step onboarding that produces a valid `config.toml`). At the end of this plan, a fresh-install user can launch Phoneme, walk through setup, and record their first voice note end-to-end.

**Depends on:** Plans 1, 2, 3a, 3b, 4 complete.

**Architecture:** Extends the Tauri shell from Plan 4 with three new views. Settings reads/writes config via new `read_config` / `write_config` Tauri commands. Doctor calls IPC commands plus does some local filesystem checks. The Wizard is a self-contained component with its own multi-step state machine; mounts at app start when no config exists. The view router (a tiny finite state machine in `App.ts`) switches between `recordings | settings | doctor | wizard`.

**Tech stack:** Same as Plan 4. Adds `tauri-plugin-fs` (file picker for hooks/models) and `tauri-plugin-dialog` (confirmations).

**Spec reference:** `~/dev/phoneme/docs/superpowers/specs/2026-05-19-phoneme-design.md` — milestones 14, 15, 16.

---

## File structure for this plan

```
src-tauri/src/
├── commands.rs                              [modify — add read_config, write_config, doctor checks]
├── doctor.rs                                [create — Rust-side filesystem + IPC checks]
├── config_io.rs                             [create — read/write config.toml atomically]
└── wizard.rs                                [create — backend support for wizard test actions]

frontend/src/
├── router.ts                                [create — view switching state machine]
├── App.ts                                   [modify — mount router]
└── components/
    ├── SettingsView/
    │   ├── index.ts                         [create — orchestrator]
    │   ├── SectionLlm.ts                    [create]
    │   ├── SectionRecording.ts              [create]
    │   ├── SectionHotkey.ts                 [create]
    │   ├── SectionHook.ts                   [create]
    │   ├── SectionStorage.ts                [create]
    │   ├── SectionTray.ts                   [create]
    │   ├── SectionAdvanced.ts               [create]
    │   ├── form.ts                          [create — shared form helpers]
    │   └── styles.css                       [create]
    ├── DoctorView/
    │   ├── index.ts                         [create — checklist + actions]
    │   └── styles.css                       [create]
    └── FirstRunWizard/
        ├── index.ts                         [create — orchestrator + step state]
        ├── steps/
        │   ├── Welcome.ts                   [create]
        │   ├── ModePicker.ts                [create]
        │   ├── ConfigureMode.ts             [create]
        │   ├── Microphone.ts                [create]
        │   ├── Hook.ts                      [create]
        │   ├── Hotkey.ts                    [create]
        │   └── Done.ts                      [create]
        └── styles.css                       [create]
```

Modifications:
- `src-tauri/Cargo.toml` — add `tauri-plugin-dialog`, `tauri-plugin-fs`.
- `Cargo.toml` (workspace) — add these plugin deps to `workspace.dependencies`.

---

## Task 1: Backend — config_io + read/write Tauri commands

**Files:**
- Create: `src-tauri/src/config_io.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `Cargo.toml` (workspace) and `src-tauri/Cargo.toml`

- [ ] **Step 1: Add plugins to workspace deps**

In root `Cargo.toml`:

```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

In `src-tauri/Cargo.toml`:

```toml
tauri-plugin-dialog.workspace = true
tauri-plugin-fs.workspace = true
```

- [ ] **Step 2: Create `src-tauri/src/config_io.rs`**

```rust
//! Atomic config.toml read/write.

use phoneme_core::Config;
use std::path::{Path, PathBuf};

pub fn config_path() -> anyhow::Result<PathBuf> {
    phoneme_core::config::default_config_path()
        .ok_or_else(|| anyhow::anyhow!("could not resolve config path"))
}

pub fn read() -> anyhow::Result<Config> {
    let path = config_path()?;
    if path.exists() {
        Ok(Config::load(&path)?)
    } else {
        Ok(Config::default())
    }
}

/// Write the config atomically: temp file → rename.
pub fn write(config: &Config) -> anyhow::Result<()> {
    config.validate()?;
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = toml::to_string_pretty(config)?;
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn exists() -> bool {
    config_path().map(|p| p.exists()).unwrap_or(false)
}
```

- [ ] **Step 3: Extend `src-tauri/src/commands.rs`**

Add these commands:

```rust
use crate::config_io;
use phoneme_core::Config;

#[tauri::command]
pub fn read_config() -> Result<Config, String> {
    config_io::read().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_config(config: Config) -> Result<(), String> {
    config_io::write(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn config_exists() -> bool {
    config_io::exists()
}

#[tauri::command]
pub fn config_path() -> Result<String, String> {
    config_io::config_path()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Register commands in main.rs**

```rust
mod config_io;

.invoke_handler(tauri::generate_handler![
    // ... existing commands
    commands::read_config,
    commands::write_config,
    commands::config_exists,
    commands::config_path,
])
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_fs::init())
```

- [ ] **Step 5: Verify build**

Run: `cargo build -p phoneme-tray`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml src-tauri/
git commit -m "phoneme-tray: add config read/write + dialog/fs plugins"
```

---

## Task 2: Backend — doctor checks + wizard backend helpers

**Files:**
- Create: `src-tauri/src/doctor.rs`
- Create: `src-tauri/src/wizard.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create `src-tauri/src/doctor.rs`**

```rust
//! Doctor checks — combines local filesystem checks with daemon IPC.

use phoneme_core::Config;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CheckResult {
    pub name: String,
    pub ok: bool,
    pub detail: String,
    pub fix_action: Option<String>, // e.g., "open_logs", "rebuild_catalog"
}

pub fn run_local_checks(cfg: &Config) -> Vec<CheckResult> {
    let mut out = Vec::new();

    // Config file present.
    let cfg_path = crate::config_io::config_path().ok();
    out.push(CheckResult {
        name: "Config file".into(),
        ok: cfg_path.as_ref().map(|p| p.exists()).unwrap_or(false),
        detail: cfg_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        fix_action: Some("open_config".into()),
    });

    // Audio directory writable.
    let audio_dir = std::path::Path::new(&cfg.recording.audio_dir);
    let writable = audio_dir.exists() || std::fs::create_dir_all(audio_dir).is_ok();
    out.push(CheckResult {
        name: "Audio directory".into(),
        ok: writable,
        detail: format!(
            "{} ({})",
            audio_dir.display(),
            free_space_label(audio_dir)
        ),
        fix_action: Some("open_audio_dir".into()),
    });

    // Hook executable resolvable.
    let hook_first = cfg.hook.command.split_whitespace().next().unwrap_or("");
    let hook_ok = which::which(hook_first).is_ok() || std::path::Path::new(hook_first).exists();
    out.push(CheckResult {
        name: "Hook command".into(),
        ok: hook_ok,
        detail: cfg.hook.command.clone(),
        fix_action: Some("open_hooks_folder".into()),
    });

    // Model file (only relevant in bundled modes).
    if cfg.llm.mode == phoneme_core::config::LlmMode::BundledModel {
        let model_ok = std::path::Path::new(&cfg.llm.model_path).exists();
        out.push(CheckResult {
            name: "Model file".into(),
            ok: model_ok,
            detail: cfg.llm.model_path.clone(),
            fix_action: None,
        });
    }

    out
}

fn free_space_label(path: &std::path::Path) -> String {
    // Cheap approximation: try `fs::metadata` length on the parent.
    match std::fs::metadata(path) {
        Ok(_) => "writable".into(),
        Err(_) => "not writable".into(),
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/wizard.rs`**

```rust
//! Wizard-only backend helpers.

use crate::bridge::Bridge;
use phoneme_core::Config;
use phoneme_ipc::{Request, Response, Transport};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct TestConnectResult {
    pub ok: bool,
    pub message: String,
}

/// Test that `cfg.llm.external_url` responds. Best-effort HEAD/GET probe.
pub async fn test_llm_endpoint(url: &str) -> TestConnectResult {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    match client.get(url).send().await {
        Ok(r) => TestConnectResult {
            ok: r.status().is_success() || r.status().is_client_error(),
            message: format!("HTTP {}", r.status()),
        },
        Err(e) => TestConnectResult {
            ok: false,
            message: format!("{e}"),
        },
    }
}

/// Run the configured hook with a sample payload via the daemon.
pub async fn test_hook(bridge: Option<&Bridge>) -> TestConnectResult {
    let Some(bridge) = bridge else {
        return TestConnectResult { ok: false, message: "daemon not reachable".into() };
    };
    match bridge.request(Request::HookTest).await {
        Ok(Response::Ok(v)) => TestConnectResult {
            ok: v["exit_code"].as_i64() == Some(0),
            message: format!("exit {} in {}ms", v["exit_code"], v["duration_ms"]),
        },
        Ok(Response::Err(e)) => TestConnectResult { ok: false, message: e.message },
        Err(e) => TestConnectResult { ok: false, message: e.to_string() },
    }
}
```

Add `reqwest` to `src-tauri/Cargo.toml` dependencies:

```toml
reqwest = { workspace = true }
```

- [ ] **Step 3: Extend `commands.rs`**

```rust
use crate::doctor::CheckResult;
use crate::wizard::TestConnectResult;

#[tauri::command]
pub fn doctor_local_checks() -> Result<Vec<CheckResult>, String> {
    let cfg = crate::config_io::read().map_err(|e| e.to_string())?;
    Ok(crate::doctor::run_local_checks(&cfg))
}

#[tauri::command]
pub async fn wizard_test_llm(url: String) -> Result<TestConnectResult, String> {
    Ok(crate::wizard::test_llm_endpoint(&url).await)
}

#[tauri::command]
pub async fn wizard_test_hook(bridge: tauri::State<'_, Option<crate::bridge::Bridge>>) -> Result<TestConnectResult, String> {
    Ok(crate::wizard::test_hook(bridge.as_ref()).await)
}

#[tauri::command]
pub fn list_input_devices() -> Result<Vec<String>, String> {
    let devices = phoneme_audio::list_input_devices().map_err(|e| e.to_string())?;
    Ok(devices.into_iter().map(|d| d.name).collect())
}
```

- [ ] **Step 4: Register in main.rs**

Add to `invoke_handler!`: `commands::doctor_local_checks`, `commands::wizard_test_llm`, `commands::wizard_test_hook`, `commands::list_input_devices`.

- [ ] **Step 5: Build + commit**

```bash
cargo build -p phoneme-tray && cargo clippy -p phoneme-tray --all-targets -- -D warnings
git add src-tauri/
git commit -m "phoneme-tray: add doctor + wizard backend commands"
```

---

## Task 3: View router

**Files:**
- Create: `frontend/src/router.ts`
- Modify: `frontend/src/App.ts`

- [ ] **Step 1: `frontend/src/router.ts`**

```typescript
import { Store } from "./state/store";

export type ViewName = "recordings" | "settings" | "doctor" | "wizard";

export type RouterState = {
  current: ViewName;
};

export class Router {
  state = new Store<RouterState>({ current: "recordings" });

  go(view: ViewName) {
    this.state.set({ current: view });
  }
}
```

- [ ] **Step 2: Rewire `App.ts` around the router**

```typescript
import { HeaderBar } from "./components/HeaderBar";
import { RecordingsView } from "./components/RecordingsView";
import { SettingsView } from "./components/SettingsView";
import { DoctorView } from "./components/DoctorView";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { Router, type ViewName } from "./router";
import { onNav } from "./services/events";
import { invoke } from "@tauri-apps/api/core";

export class App {
  private container: HTMLElement;
  private router = new Router();
  private mainEl: HTMLElement;
  private headerEl: HTMLElement;
  private current: { destroy?: () => void } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="app-shell">
        <div id="hdr"></div>
        <div id="main"></div>
      </div>
    `;
    this.headerEl = container.querySelector("#hdr")!;
    this.mainEl = container.querySelector("#main")!;

    new HeaderBar(this.headerEl, {
      onSearchChange: () => {},
      onOpenSettings: () => this.router.go("settings"),
    });

    this.router.state.subscribe((s) => this.mount(s.current));

    // Tray menu navigation.
    void onNav("settings", () => this.router.go("settings"));
    void onNav("doctor", () => this.router.go("doctor"));

    // Auto-launch wizard if no config exists.
    void this.maybeAutoWizard();
  }

  private async maybeAutoWizard() {
    const exists = await invoke<boolean>("config_exists");
    if (!exists) {
      this.router.go("wizard");
    }
  }

  private mount(view: ViewName) {
    this.current?.destroy?.();
    this.mainEl.innerHTML = "";
    switch (view) {
      case "recordings":
        this.current = new RecordingsView(this.mainEl);
        break;
      case "settings":
        this.current = new SettingsView(this.mainEl, () => this.router.go("recordings"));
        break;
      case "doctor":
        this.current = new DoctorView(this.mainEl, () => this.router.go("recordings"));
        break;
      case "wizard":
        this.current = new FirstRunWizard(this.mainEl, () => this.router.go("recordings"));
        break;
    }
  }
}
```

The new view classes don't exist yet — Tasks 4–7 add them. For this commit to compile, add stub modules:

- [ ] **Step 3: Stub the new view modules**

Create `frontend/src/components/SettingsView/index.ts`:

```typescript
export class SettingsView {
  constructor(container: HTMLElement, _onClose: () => void) {
    container.innerHTML = `<div class="empty"><p>Settings — coming soon</p></div>`;
  }
}
```

Same pattern for `frontend/src/components/DoctorView/index.ts` and `frontend/src/components/FirstRunWizard/index.ts`.

- [ ] **Step 4: Verify build + commit**

```bash
cd frontend && pnpm type-check && cd ..
cargo build -p phoneme-tray
git add frontend/
git commit -m "frontend: add view router + stub Settings/Doctor/Wizard views"
```

---

## Task 4: SettingsView — LLM + Recording sections

**Files:**
- Create: `frontend/src/components/SettingsView/form.ts`
- Create: `frontend/src/components/SettingsView/styles.css`
- Create: `frontend/src/components/SettingsView/SectionLlm.ts`
- Create: `frontend/src/components/SettingsView/SectionRecording.ts`
- Modify: `frontend/src/components/SettingsView/index.ts`

- [ ] **Step 1: Shared form helpers — `form.ts`**

```typescript
//! Tiny declarative form helpers.

export type FieldKind = "text" | "number" | "checkbox" | "select" | "textarea";

export type Field = {
  key: string;                  // dotted path e.g. "llm.timeout_secs"
  label: string;
  kind: FieldKind;
  help?: string;
  options?: { value: string; label: string }[]; // for "select"
};

export function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setByPath(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  const last = parts.pop()!;
  const target = parts.reduce((o, k) => o[k], obj);
  target[last] = value;
}

export function renderField(field: Field, value: any): string {
  switch (field.kind) {
    case "text":
      return `<input type="text" data-key="${field.key}" value="${escapeAttr(String(value ?? ""))}" />`;
    case "number":
      return `<input type="number" data-key="${field.key}" value="${value ?? 0}" />`;
    case "checkbox":
      return `<input type="checkbox" data-key="${field.key}" ${value ? "checked" : ""} />`;
    case "select":
      return `<select data-key="${field.key}">${field.options
        ?.map((o) => `<option value="${o.value}" ${o.value === value ? "selected" : ""}>${o.label}</option>`)
        .join("")}</select>`;
    case "textarea":
      return `<textarea data-key="${field.key}" rows="3">${escape(String(value ?? ""))}</textarea>`;
  }
}

export function bindFieldEvents(root: HTMLElement, config: any) {
  root.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => {
    const key = el.getAttribute("data-key")!;
    const tag = el.tagName.toLowerCase();
    const handler = () => {
      const value = readEl(el);
      setByPath(config, key, value);
    };
    if (tag === "input" && (el as HTMLInputElement).type === "checkbox") {
      el.addEventListener("change", handler);
    } else {
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    }
  });
}

function readEl(el: HTMLElement): any {
  if (el.tagName === "SELECT") return (el as HTMLSelectElement).value;
  const input = el as HTMLInputElement;
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  return input.value;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escape(s).replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Common styles — `styles.css`**

```css
.settings-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
}
.settings-toolbar {
  padding: 12px 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 12px;
  align-items: center;
}
.settings-toolbar h2 { margin: 0; font-size: 18px; color: var(--fg-default); }
.settings-toolbar .spacer { flex: 1; }
.settings-toolbar button {
  background: rgba(255,255,255,0.06);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--fg-default);
}
.settings-toolbar button.primary {
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
.settings-section {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 16px;
}
.settings-section h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.settings-field {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 12px;
  align-items: start;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.settings-field:last-child { border-bottom: none; }
.settings-field label {
  color: var(--fg-default);
  font-size: 13px;
  padding-top: 4px;
}
.settings-field .help {
  color: var(--fg-faded);
  font-size: 11px;
  margin-top: 2px;
}
.settings-field input,
.settings-field select,
.settings-field textarea {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 6px 10px;
  color: var(--fg-default);
  font-size: 13px;
  width: 100%;
  max-width: 380px;
}
.settings-field input:focus,
.settings-field select:focus,
.settings-field textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.settings-field .inline-button {
  background: rgba(255,255,255,0.06);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--fg-default);
  margin-left: 8px;
}
.test-result {
  padding: 6px 10px;
  border-radius: 4px;
  margin-top: 8px;
  font-size: 12px;
}
.test-result.ok { background: rgba(166,227,161,0.15); color: var(--ok); }
.test-result.err { background: rgba(243,139,168,0.15); color: var(--err); }
```

- [ ] **Step 3: `SectionLlm.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { renderField, bindFieldEvents } from "./form";

export class SectionLlm {
  constructor(container: HTMLElement, private config: any) {
    this.render(container);
  }

  private render(container: HTMLElement) {
    container.innerHTML = `
      <div class="settings-section">
        <h3>LLM</h3>
        <div class="settings-field">
          <label>Mode</label>
          <div>
            ${renderField({ key: "llm.mode", label: "Mode", kind: "select", options: [
              { value: "external", label: "External (BYO server)" },
              { value: "bundled_model", label: "Bundled server + my model" },
              { value: "bundled_download", label: "Bundled server + downloaded model (v1.1)" },
            ]}, this.config.llm.mode)}
          </div>
        </div>
        <div class="settings-field">
          <label>External URL</label>
          <div>
            ${renderField({ key: "llm.external_url", label: "", kind: "text" }, this.config.llm.external_url)}
            <button class="inline-button" id="test-llm">Test</button>
            <div class="test-result" id="llm-result" style="display:none"></div>
          </div>
        </div>
        <div class="settings-field">
          <label>Model file (.gguf)</label>
          <div>
            ${renderField({ key: "llm.model_path", label: "", kind: "text" }, this.config.llm.model_path)}
            <button class="inline-button" id="pick-model">Browse…</button>
          </div>
        </div>
        <div class="settings-field">
          <label>Timeout (seconds)</label>
          <div>${renderField({ key: "llm.timeout_secs", label: "", kind: "number" }, this.config.llm.timeout_secs)}</div>
        </div>
        <div class="settings-field">
          <label>System prompt</label>
          <div>${renderField({ key: "llm.system_prompt", label: "", kind: "textarea" }, this.config.llm.system_prompt)}</div>
        </div>
      </div>
    `;
    bindFieldEvents(container, this.config);

    container.querySelector("#test-llm")?.addEventListener("click", async () => {
      const result = await invoke<{ ok: boolean; message: string }>("wizard_test_llm", {
        url: this.config.llm.external_url,
      });
      const el = container.querySelector<HTMLElement>("#llm-result")!;
      el.style.display = "block";
      el.className = `test-result ${result.ok ? "ok" : "err"}`;
      el.textContent = result.message;
    });

    container.querySelector("#pick-model")?.addEventListener("click", async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        filters: [{ name: "GGUF model", extensions: ["gguf"] }],
      });
      if (typeof path === "string") {
        const input = container.querySelector<HTMLInputElement>(`[data-key="llm.model_path"]`)!;
        input.value = path;
        this.config.llm.model_path = path;
      }
    });
  }
}
```

- [ ] **Step 4: `SectionRecording.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { renderField, bindFieldEvents } from "./form";

export class SectionRecording {
  constructor(container: HTMLElement, private config: any) {
    this.render(container);
  }

  private async render(container: HTMLElement) {
    const devices: string[] = await invoke("list_input_devices").catch(() => []);
    container.innerHTML = `
      <div class="settings-section">
        <h3>Recording</h3>
        <div class="settings-field">
          <label>Microphone</label>
          <div>
            ${renderField(
              { key: "recording.input_device", label: "", kind: "select",
                options: [{ value: "default", label: "(system default)" }].concat(
                  devices.map((d) => ({ value: d, label: d }))
                ) },
              this.config.recording.input_device
            )}
          </div>
        </div>
        <div class="settings-field">
          <label>Audio directory</label>
          <div>${renderField({ key: "recording.audio_dir", label: "", kind: "text" }, this.config.recording.audio_dir)}</div>
        </div>
        <div class="settings-field">
          <label>Max duration (seconds)</label>
          <div>${renderField({ key: "recording.max_duration_secs", label: "", kind: "number" }, this.config.recording.max_duration_secs)}</div>
        </div>
        <div class="settings-field">
          <label>Silence threshold (dBFS)</label>
          <div>${renderField({ key: "recording.silence_threshold_dbfs", label: "", kind: "number" }, this.config.recording.silence_threshold_dbfs)}</div>
        </div>
        <div class="settings-field">
          <label>Silence window (ms)</label>
          <div>${renderField({ key: "recording.silence_window_ms", label: "", kind: "number" }, this.config.recording.silence_window_ms)}</div>
        </div>
      </div>
    `;
    bindFieldEvents(container, this.config);
  }
}
```

- [ ] **Step 5: Update `SettingsView/index.ts` skeleton**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { SectionLlm } from "./SectionLlm";
import { SectionRecording } from "./SectionRecording";
import "./styles.css";

export class SettingsView {
  constructor(private container: HTMLElement, private onClose: () => void) {
    this.render();
  }

  private async render() {
    const config: any = await invoke("read_config");
    this.container.innerHTML = `
      <div class="settings-view">
        <div class="settings-toolbar">
          <h2>Settings</h2>
          <span class="spacer"></span>
          <button id="settings-close">Close</button>
          <button class="primary" id="settings-save">Save</button>
        </div>
        <div class="settings-body" id="settings-body"></div>
      </div>
    `;
    const body = this.container.querySelector<HTMLElement>("#settings-body")!;
    new SectionLlm(body, config);
    new SectionRecording(body, config);

    this.container.querySelector("#settings-close")?.addEventListener("click", () => this.onClose());
    this.container.querySelector("#settings-save")?.addEventListener("click", async () => {
      try {
        await invoke("write_config", { config });
        this.onClose();
      } catch (e) {
        alert(`Save failed: ${e}`);
      }
    });
  }
}
```

- [ ] **Step 6: Build + commit**

```bash
cd frontend && pnpm type-check && cd ..
git add frontend/
git commit -m "frontend: add SettingsView with LLM + Recording sections"
```

---

## Task 5: SettingsView — remaining sections (Hotkey, Hook, Storage, Tray, Advanced)

**Files:**
- Create: `frontend/src/components/SettingsView/SectionHotkey.ts`
- Create: `frontend/src/components/SettingsView/SectionHook.ts`
- Create: `frontend/src/components/SettingsView/SectionStorage.ts`
- Create: `frontend/src/components/SettingsView/SectionTray.ts`
- Create: `frontend/src/components/SettingsView/SectionAdvanced.ts`
- Modify: `frontend/src/components/SettingsView/index.ts`

Each section follows the same pattern as `SectionLlm` and `SectionRecording`. Show one in full detail; the rest mirror.

- [ ] **Step 1: `SectionHotkey.ts`**

```typescript
import { renderField, bindFieldEvents } from "./form";

export class SectionHotkey {
  constructor(container: HTMLElement, private config: any) {
    container.innerHTML = `
      <div class="settings-section">
        <h3>Global Hotkey</h3>
        <div class="settings-field">
          <label>Enable</label>
          <div>
            ${renderField({ key: "hotkey.enabled", label: "", kind: "checkbox" }, this.config.hotkey.enabled)}
            <div class="help">If you use Kanata/AHK/WHKD to bind a hotkey externally, leave this OFF.</div>
          </div>
        </div>
        <div class="settings-field">
          <label>Combo</label>
          <div>${renderField({ key: "hotkey.combo", label: "", kind: "text" }, this.config.hotkey.combo)}</div>
        </div>
        <div class="settings-field">
          <label>Mode</label>
          <div>${renderField(
            { key: "hotkey.mode", label: "", kind: "select", options: [
              { value: "hold", label: "Hold (push-to-talk)" },
              { value: "toggle", label: "Toggle (tap to start, tap to stop)" },
            ]},
            this.config.hotkey.mode
          )}</div>
        </div>
      </div>
    `;
    bindFieldEvents(container, this.config);
  }
}
```

- [ ] **Step 2: `SectionHook.ts`**

Same pattern. Fields: `hook.command` (text + Browse button), `hook.timeout_secs` (number). Add a "Test hook" button that invokes `wizard_test_hook` and displays result inline.

- [ ] **Step 3: `SectionStorage.ts`**

Fields: `recording.audio_dir` (with "Open" button that uses `tauri-plugin-shell` to open Explorer at the path). Add "Open data folder" button.

- [ ] **Step 4: `SectionTray.ts`**

Fields: `tray.show_on_startup`, `tray.minimize_to_tray`, `tray.start_at_login` — all checkboxes.

- [ ] **Step 5: `SectionAdvanced.ts`**

Fields: `daemon.log_level` (select: error/warn/info/debug/trace). Buttons: "Open daemon.log", "Open config.toml", "Rebuild catalog".

- [ ] **Step 6: Wire into `SettingsView/index.ts`**

```typescript
import { SectionHotkey } from "./SectionHotkey";
import { SectionHook } from "./SectionHook";
import { SectionStorage } from "./SectionStorage";
import { SectionTray } from "./SectionTray";
import { SectionAdvanced } from "./SectionAdvanced";

// In render(), after the existing two sections:
new SectionHotkey(body, config);
new SectionHook(body, config);
new SectionStorage(body, config);
new SectionTray(body, config);
new SectionAdvanced(body, config);
```

- [ ] **Step 7: Verify + commit**

```bash
cd frontend && pnpm type-check && cd ..
cargo tauri dev
# Open settings, verify all sections render and save works
git add frontend/
git commit -m "frontend: complete SettingsView (Hotkey, Hook, Storage, Tray, Advanced)"
```

---

## Task 6: DoctorView

**Files:**
- Create: `frontend/src/components/DoctorView/index.ts`
- Create: `frontend/src/components/DoctorView/styles.css`

- [ ] **Step 1: `DoctorView/index.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  fix_action: string | null;
};

export class DoctorView {
  private container: HTMLElement;
  private onClose: () => void;

  constructor(container: HTMLElement, onClose: () => void) {
    this.container = container;
    this.onClose = onClose;
    this.render();
  }

  private async render() {
    this.container.innerHTML = `
      <div class="doctor-view">
        <div class="settings-toolbar">
          <h2>Doctor</h2>
          <span class="spacer"></span>
          <button id="doctor-refresh">Re-run all</button>
          <button id="doctor-close">Close</button>
        </div>
        <div class="settings-body" id="doctor-body">Loading…</div>
      </div>
    `;
    this.container.querySelector("#doctor-close")?.addEventListener("click", () => this.onClose());
    this.container.querySelector("#doctor-refresh")?.addEventListener("click", () => this.runChecks());
    await this.runChecks();
  }

  private async runChecks() {
    const body = this.container.querySelector<HTMLElement>("#doctor-body");
    if (!body) return;
    body.textContent = "Running checks…";

    // Daemon checks
    const daemonChecks = await this.daemonChecks();
    const localChecks = await invoke<CheckResult[]>("doctor_local_checks").catch(() => []);
    const all = [...daemonChecks, ...localChecks];

    body.innerHTML = `
      <div class="doctor-list">
        ${all
          .map(
            (c) => `
          <div class="doctor-row ${c.ok ? "ok" : "fail"}">
            <span class="doctor-mark">${c.ok ? "✓" : "✗"}</span>
            <div class="doctor-name">${c.name}</div>
            <div class="doctor-detail">${c.detail}</div>
            ${c.fix_action ? `<button class="doctor-fix" data-action="${c.fix_action}">Fix</button>` : ""}
          </div>
        `
          )
          .join("")}
      </div>
    `;

    body.querySelectorAll<HTMLButtonElement>(".doctor-fix").forEach((btn) => {
      btn.addEventListener("click", () => this.handleFix(btn.dataset.action!));
    });
  }

  private async daemonChecks(): Promise<CheckResult[]> {
    try {
      const status: { running: boolean; pid: number } = await invoke("daemon_status");
      return [
        {
          name: "Daemon",
          ok: status.running,
          detail: `pid ${status.pid}`,
          fix_action: null,
        },
      ];
    } catch (e) {
      return [
        {
          name: "Daemon",
          ok: false,
          detail: String(e),
          fix_action: "start_daemon",
        },
      ];
    }
  }

  private async handleFix(action: string) {
    const shell = await import("@tauri-apps/plugin-shell");
    switch (action) {
      case "open_config":
        await invoke("config_path").then((p: any) => shell.open(p));
        break;
      // Add more as needed.
    }
    await this.runChecks();
  }
}
```

- [ ] **Step 2: `DoctorView/styles.css`**

```css
.doctor-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
}
.doctor-list {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
}
.doctor-row {
  display: grid;
  grid-template-columns: 24px 200px 1fr auto;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border-subtle);
  align-items: center;
}
.doctor-row:last-child { border-bottom: none; }
.doctor-row.ok .doctor-mark { color: var(--ok); }
.doctor-row.fail .doctor-mark { color: var(--err); }
.doctor-mark { font-size: 18px; text-align: center; }
.doctor-name { font-weight: 600; color: var(--fg-default); }
.doctor-detail { color: var(--fg-muted); font-size: 12px; }
.doctor-fix {
  background: rgba(203,166,247,0.15);
  color: var(--accent);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd frontend && pnpm type-check && cd ..
cargo tauri dev
git add frontend/
git commit -m "frontend: add DoctorView (daemon + local checks with fix-it buttons)"
```

---

## Task 7: FirstRunWizard — orchestrator + steps 1–3

**Files:**
- Create: `frontend/src/components/FirstRunWizard/index.ts`
- Create: `frontend/src/components/FirstRunWizard/styles.css`
- Create: `frontend/src/components/FirstRunWizard/steps/Welcome.ts`
- Create: `frontend/src/components/FirstRunWizard/steps/ModePicker.ts`
- Create: `frontend/src/components/FirstRunWizard/steps/ConfigureMode.ts`

- [ ] **Step 1: `FirstRunWizard/index.ts` — orchestrator + step state**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { Welcome } from "./steps/Welcome";
import { ModePicker } from "./steps/ModePicker";
import { ConfigureMode } from "./steps/ConfigureMode";
import { Microphone } from "./steps/Microphone";
import { Hook } from "./steps/Hook";
import { Hotkey } from "./steps/Hotkey";
import { Done } from "./steps/Done";
import "./styles.css";

export type WizardStep = "welcome" | "mode" | "configure" | "mic" | "hook" | "hotkey" | "done";

export class FirstRunWizard {
  private container: HTMLElement;
  private onComplete: () => void;
  private step: WizardStep = "welcome";
  private config: any;
  private current: any;

  constructor(container: HTMLElement, onComplete: () => void) {
    this.container = container;
    this.onComplete = onComplete;
    this.init();
  }

  private async init() {
    this.config = await invoke("read_config"); // defaults if no file exists
    this.render();
  }

  private async render() {
    this.container.innerHTML = `
      <div class="wizard-shell">
        <div class="wizard-header">
          <div class="wizard-brand">🎙 Phoneme — Setup</div>
          <div class="wizard-dots" id="wizard-dots"></div>
        </div>
        <div class="wizard-body" id="wizard-body"></div>
        <div class="wizard-footer" id="wizard-footer"></div>
      </div>
    `;
    this.renderDots();
    this.renderStep();
  }

  private renderDots() {
    const all: WizardStep[] = ["welcome", "mode", "configure", "mic", "hook", "hotkey", "done"];
    const idx = all.indexOf(this.step);
    const dots = this.container.querySelector("#wizard-dots")!;
    dots.innerHTML = all
      .map((s, i) => {
        const klass = i < idx ? "done" : i === idx ? "active" : "";
        return `<span class="wizard-dot ${klass}" title="${s}"></span>`;
      })
      .join("");
  }

  private renderStep() {
    const body = this.container.querySelector<HTMLElement>("#wizard-body")!;
    const footer = this.container.querySelector<HTMLElement>("#wizard-footer")!;
    const cbs = {
      onNext: () => this.go("next"),
      onBack: () => this.go("back"),
      onSkip: () => this.skip(),
    };
    switch (this.step) {
      case "welcome": this.current = new Welcome(body, footer, this.config, cbs); break;
      case "mode": this.current = new ModePicker(body, footer, this.config, cbs); break;
      case "configure": this.current = new ConfigureMode(body, footer, this.config, cbs); break;
      case "mic": this.current = new Microphone(body, footer, this.config, cbs); break;
      case "hook": this.current = new Hook(body, footer, this.config, cbs); break;
      case "hotkey": this.current = new Hotkey(body, footer, this.config, cbs); break;
      case "done": this.current = new Done(body, footer, this.config, cbs); break;
    }
  }

  private go(direction: "next" | "back") {
    const all: WizardStep[] = ["welcome", "mode", "configure", "mic", "hook", "hotkey", "done"];
    const idx = all.indexOf(this.step);
    const next = direction === "next" ? Math.min(idx + 1, all.length - 1) : Math.max(idx - 1, 0);
    this.step = all[next];
    this.renderDots();
    this.renderStep();
  }

  private async skip() {
    // Persist whatever defaults we have and exit.
    await invoke("write_config", { config: this.config });
    this.onComplete();
  }
}
```

- [ ] **Step 2: `Welcome.ts`**

```typescript
export type StepCallbacks = {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
};

export class Welcome {
  constructor(body: HTMLElement, footer: HTMLElement, _config: any, cbs: StepCallbacks) {
    body.innerHTML = `
      <h2 class="wizard-title">Welcome to Phoneme</h2>
      <p class="wizard-subtitle">Local-first voice notes. Press a hotkey, speak, get a transcript — all on your machine.</p>
      <ul class="wizard-bullets">
        <li>Records audio via your microphone</li>
        <li>Transcribes locally with llama-server (no cloud)</li>
        <li>Emits the transcript as JSON to your hook script</li>
      </ul>
      <p class="wizard-subtitle">Let's get it set up.</p>
    `;
    footer.innerHTML = `
      <span class="spacer"></span>
      <button class="wizard-btn primary" id="next">Continue →</button>
    `;
    footer.querySelector("#next")?.addEventListener("click", () => cbs.onNext());
  }
}
```

- [ ] **Step 3: `ModePicker.ts`**

```typescript
import type { StepCallbacks } from "./Welcome";

export class ModePicker {
  constructor(body: HTMLElement, footer: HTMLElement, private config: any, cbs: StepCallbacks) {
    body.innerHTML = `
      <h2 class="wizard-title">How do you want to run transcription?</h2>
      <p class="wizard-subtitle">Phoneme needs a llama-server endpoint. Pick the setup that fits — you can change this later in Settings.</p>
      <div class="mode-cards">
        <div class="mode-card" data-mode="external">
          <div class="mode-icon">🔗</div>
          <div class="mode-name">Use my own server</div>
          <div class="mode-desc">I already run llama-server. Just point Phoneme at it.</div>
        </div>
        <div class="mode-card recommended" data-mode="bundled_model">
          <div class="mode-badge">RECOMMENDED</div>
          <div class="mode-icon">📦</div>
          <div class="mode-name">Bundled server + my model</div>
          <div class="mode-desc">Phoneme runs llama-server for you. You provide a GGUF model.</div>
        </div>
        <div class="mode-card disabled" data-mode="bundled_download">
          <div class="mode-badge soon">v1.1</div>
          <div class="mode-icon">⬇</div>
          <div class="mode-name">Download for me</div>
          <div class="mode-desc">Coming in the next release.</div>
        </div>
      </div>
    `;
    footer.innerHTML = `
      <button class="wizard-btn" id="back">← Back</button>
      <span class="spacer"></span>
      <button class="wizard-btn" id="skip">Skip setup</button>
      <button class="wizard-btn primary" id="next" disabled>Continue →</button>
    `;
    body.querySelectorAll<HTMLElement>(".mode-card[data-mode]:not(.disabled)").forEach((card) => {
      card.addEventListener("click", () => {
        body.querySelectorAll(".mode-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        this.config.llm.mode = card.dataset.mode;
        footer.querySelector<HTMLButtonElement>("#next")!.disabled = false;
      });
    });
    footer.querySelector("#back")?.addEventListener("click", () => cbs.onBack());
    footer.querySelector("#skip")?.addEventListener("click", () => cbs.onSkip());
    footer.querySelector("#next")?.addEventListener("click", () => cbs.onNext());
  }
}
```

- [ ] **Step 4: `ConfigureMode.ts`**

Branches on `config.llm.mode`:
- `external`: URL field + Test button
- `bundled_model`: file picker for `.gguf` + Test (calls `wizard_test_llm` after spawning a temp llama-server — simpler: just verify the file exists for v1, real test happens after daemon starts).
- `bundled_download`: shown only if user selected mode 3 (disabled in v1); skip directly.

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { StepCallbacks } from "./Welcome";

export class ConfigureMode {
  constructor(body: HTMLElement, footer: HTMLElement, private config: any, cbs: StepCallbacks) {
    const mode = this.config.llm.mode;
    if (mode === "external") {
      this.renderExternal(body, footer, cbs);
    } else if (mode === "bundled_model") {
      this.renderBundledModel(body, footer, cbs);
    } else {
      cbs.onNext();
    }
  }

  private renderExternal(body: HTMLElement, footer: HTMLElement, cbs: StepCallbacks) {
    body.innerHTML = `
      <h2 class="wizard-title">Point at your llama-server</h2>
      <p class="wizard-subtitle">Enter the URL of your running llama-server with an OpenAI-compatible API.</p>
      <div class="wizard-field">
        <label>Endpoint URL</label>
        <input type="text" id="url" value="${this.config.llm.external_url}" />
      </div>
      <button class="wizard-btn" id="test">Test connection</button>
      <div class="test-result" id="result" style="display:none"></div>
    `;
    this.renderFooter(footer, cbs);
    body.querySelector<HTMLInputElement>("#url")!.addEventListener("input", (e) => {
      this.config.llm.external_url = (e.target as HTMLInputElement).value;
    });
    body.querySelector("#test")?.addEventListener("click", async () => {
      const r = await invoke<{ ok: boolean; message: string }>("wizard_test_llm", {
        url: this.config.llm.external_url,
      });
      const el = body.querySelector<HTMLElement>("#result")!;
      el.style.display = "block";
      el.className = `test-result ${r.ok ? "ok" : "err"}`;
      el.textContent = r.message;
    });
  }

  private async renderBundledModel(body: HTMLElement, footer: HTMLElement, cbs: StepCallbacks) {
    body.innerHTML = `
      <h2 class="wizard-title">Pick your model file</h2>
      <p class="wizard-subtitle">A GGUF model file (e.g., Gemma-4-E4B Q5_K_M).</p>
      <div class="wizard-field">
        <label>Model path</label>
        <input type="text" id="path" value="${this.config.llm.model_path}" />
        <button class="wizard-btn small" id="browse">Browse…</button>
      </div>
    `;
    this.renderFooter(footer, cbs);
    body.querySelector("#browse")?.addEventListener("click", async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        filters: [{ name: "GGUF model", extensions: ["gguf"] }],
      });
      if (typeof path === "string") {
        this.config.llm.model_path = path;
        body.querySelector<HTMLInputElement>("#path")!.value = path;
      }
    });
    body.querySelector<HTMLInputElement>("#path")!.addEventListener("input", (e) => {
      this.config.llm.model_path = (e.target as HTMLInputElement).value;
    });
  }

  private renderFooter(footer: HTMLElement, cbs: StepCallbacks) {
    footer.innerHTML = `
      <button class="wizard-btn" id="back">← Back</button>
      <span class="spacer"></span>
      <button class="wizard-btn" id="skip">Skip setup</button>
      <button class="wizard-btn primary" id="next">Continue →</button>
    `;
    footer.querySelector("#back")?.addEventListener("click", () => cbs.onBack());
    footer.querySelector("#skip")?.addEventListener("click", () => cbs.onSkip());
    footer.querySelector("#next")?.addEventListener("click", () => cbs.onNext());
  }
}
```

- [ ] **Step 5: `styles.css`**

```css
.wizard-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
}
.wizard-header {
  background: var(--bg-surface);
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 16px;
  align-items: center;
}
.wizard-brand { color: var(--fg-default); font-weight: 600; }
.wizard-dots { display: flex; gap: 6px; margin-left: auto; }
.wizard-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); }
.wizard-dot.active { background: var(--accent); }
.wizard-dot.done { background: var(--ok); }
.wizard-body { flex: 1; padding: 36px 48px; overflow-y: auto; }
.wizard-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 12px;
  align-items: center;
}
.wizard-footer .spacer { flex: 1; }
.wizard-title { font-size: 24px; color: var(--fg-default); margin: 0 0 8px; }
.wizard-subtitle { color: var(--fg-muted); margin: 0 0 24px; font-size: 14px; }
.wizard-bullets { color: var(--fg-default); }
.wizard-bullets li { margin-bottom: 6px; }
.wizard-btn {
  background: rgba(255,255,255,0.06);
  border-radius: 6px;
  padding: 8px 18px;
  font-size: 13px;
  color: var(--fg-default);
}
.wizard-btn.primary {
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
.wizard-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.wizard-btn.small { padding: 4px 10px; font-size: 12px; }
.wizard-field { margin-bottom: 16px; }
.wizard-field label {
  display: block;
  color: var(--fg-muted);
  font-size: 12px;
  margin-bottom: 4px;
}
.wizard-field input {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 12px;
  color: var(--fg-default);
  width: 100%;
  max-width: 500px;
  font-size: 14px;
}
.mode-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-top: 12px;
}
.mode-card {
  background: var(--bg-surface);
  border: 2px solid var(--border-subtle);
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  position: relative;
}
.mode-card:hover { border-color: var(--fg-faded); }
.mode-card.recommended { border-color: var(--accent); background: rgba(203,166,247,0.06); }
.mode-card.selected { background: rgba(203,166,247,0.12); border-color: var(--accent); }
.mode-card.disabled { opacity: 0.5; cursor: not-allowed; }
.mode-badge {
  position: absolute;
  top: -10px;
  right: 12px;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: bold;
}
.mode-badge.soon { background: var(--fg-faded); color: var(--bg-deep); }
.mode-icon { font-size: 28px; margin-bottom: 8px; }
.mode-name { font-size: 15px; color: var(--fg-default); font-weight: 600; }
.mode-desc { color: var(--fg-muted); font-size: 12px; margin-top: 6px; }
```

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "frontend: add FirstRunWizard orchestrator + Welcome/ModePicker/ConfigureMode steps"
```

---

## Task 8: Wizard steps 4–7 (Microphone, Hook, Hotkey, Done)

**Files:**
- Create: `frontend/src/components/FirstRunWizard/steps/Microphone.ts`
- Create: `frontend/src/components/FirstRunWizard/steps/Hook.ts`
- Create: `frontend/src/components/FirstRunWizard/steps/Hotkey.ts`
- Create: `frontend/src/components/FirstRunWizard/steps/Done.ts`

- [ ] **Step 1: `Microphone.ts`**

Lists `list_input_devices` results, lets user pick one, shows live level meter (uses `phoneme-audio`'s test recording via a new IPC test command — defer to v1.1 if level meter is complex; just show device list for v1).

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { StepCallbacks } from "./Welcome";

export class Microphone {
  constructor(body: HTMLElement, footer: HTMLElement, private config: any, cbs: StepCallbacks) {
    this.render(body, footer, cbs);
  }

  private async render(body: HTMLElement, footer: HTMLElement, cbs: StepCallbacks) {
    const devices: string[] = await invoke("list_input_devices").catch(() => []);
    body.innerHTML = `
      <h2 class="wizard-title">Microphone</h2>
      <p class="wizard-subtitle">Pick the input device Phoneme should record from.</p>
      <div class="wizard-field">
        <label>Device</label>
        <select id="dev">
          <option value="default">(system default)</option>
          ${devices.map((d) => `<option value="${d}">${d}</option>`).join("")}
        </select>
      </div>
    `;
    this.renderFooter(footer, cbs);
    body.querySelector<HTMLSelectElement>("#dev")!.value = this.config.recording.input_device;
    body.querySelector<HTMLSelectElement>("#dev")!.addEventListener("change", (e) => {
      this.config.recording.input_device = (e.target as HTMLSelectElement).value;
    });
  }

  private renderFooter(footer: HTMLElement, cbs: StepCallbacks) {
    footer.innerHTML = `
      <button class="wizard-btn" id="back">← Back</button>
      <span class="spacer"></span>
      <button class="wizard-btn" id="skip">Skip setup</button>
      <button class="wizard-btn primary" id="next">Continue →</button>
    `;
    footer.querySelector("#back")?.addEventListener("click", () => cbs.onBack());
    footer.querySelector("#skip")?.addEventListener("click", () => cbs.onSkip());
    footer.querySelector("#next")?.addEventListener("click", () => cbs.onNext());
  }
}
```

- [ ] **Step 2: `Hook.ts`**

```typescript
import type { StepCallbacks } from "./Welcome";

export class Hook {
  constructor(body: HTMLElement, footer: HTMLElement, private config: any, cbs: StepCallbacks) {
    body.innerHTML = `
      <h2 class="wizard-title">Hook (delivery)</h2>
      <p class="wizard-subtitle">Phoneme runs this script with the transcript as JSON on stdin. Default writes to stdout.</p>
      <div class="wizard-field">
        <label>Hook command</label>
        <input type="text" id="cmd" value="${this.config.hook.command}" />
      </div>
      <div class="wizard-field">
        <label>Timeout (seconds)</label>
        <input type="number" id="to" value="${this.config.hook.timeout_secs}" />
      </div>
    `;
    footer.innerHTML = `
      <button class="wizard-btn" id="back">← Back</button>
      <span class="spacer"></span>
      <button class="wizard-btn" id="skip">Skip setup</button>
      <button class="wizard-btn primary" id="next">Continue →</button>
    `;
    body.querySelector<HTMLInputElement>("#cmd")!.addEventListener("input", (e) => {
      this.config.hook.command = (e.target as HTMLInputElement).value;
    });
    body.querySelector<HTMLInputElement>("#to")!.addEventListener("input", (e) => {
      this.config.hook.timeout_secs = Number((e.target as HTMLInputElement).value);
    });
    footer.querySelector("#back")?.addEventListener("click", () => cbs.onBack());
    footer.querySelector("#skip")?.addEventListener("click", () => cbs.onSkip());
    footer.querySelector("#next")?.addEventListener("click", () => cbs.onNext());
  }
}
```

- [ ] **Step 3: `Hotkey.ts`**

```typescript
import type { StepCallbacks } from "./Welcome";

export class Hotkey {
  constructor(body: HTMLElement, footer: HTMLElement, private config: any, cbs: StepCallbacks) {
    body.innerHTML = `
      <h2 class="wizard-title">Hotkey (optional)</h2>
      <p class="wizard-subtitle">Want a global hotkey for hold-to-talk? If you use Kanata/AHK to bind this externally, leave it off.</p>
      <div class="wizard-field">
        <label><input type="checkbox" id="enabled" ${this.config.hotkey.enabled ? "checked" : ""} /> Enable global hotkey</label>
      </div>
      <div class="wizard-field">
        <label>Combo</label>
        <input type="text" id="combo" value="${this.config.hotkey.combo}" />
      </div>
    `;
    footer.innerHTML = `
      <button class="wizard-btn" id="back">← Back</button>
      <span class="spacer"></span>
      <button class="wizard-btn" id="skip">Skip setup</button>
      <button class="wizard-btn primary" id="next">Continue →</button>
    `;
    body.querySelector<HTMLInputElement>("#enabled")!.addEventListener("change", (e) => {
      this.config.hotkey.enabled = (e.target as HTMLInputElement).checked;
    });
    body.querySelector<HTMLInputElement>("#combo")!.addEventListener("input", (e) => {
      this.config.hotkey.combo = (e.target as HTMLInputElement).value;
    });
    footer.querySelector("#back")?.addEventListener("click", () => cbs.onBack());
    footer.querySelector("#skip")?.addEventListener("click", () => cbs.onSkip());
    footer.querySelector("#next")?.addEventListener("click", () => cbs.onNext());
  }
}
```

- [ ] **Step 4: `Done.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { StepCallbacks } from "./Welcome";

export class Done {
  constructor(body: HTMLElement, footer: HTMLElement, private config: any, cbs: StepCallbacks) {
    body.innerHTML = `
      <h2 class="wizard-title">You're set up</h2>
      <p class="wizard-subtitle">Try saying something now.</p>
      <button class="wizard-record-big" id="record">● Record now</button>
    `;
    footer.innerHTML = `
      <button class="wizard-btn" id="back">← Back</button>
      <span class="spacer"></span>
      <button class="wizard-btn primary" id="finish">Finish</button>
    `;
    body.querySelector("#record")?.addEventListener("click", async () => {
      try {
        await invoke("record_start", { mode: "oneshot" });
      } catch (e) {
        alert(`Failed: ${e}`);
      }
    });
    footer.querySelector("#back")?.addEventListener("click", () => cbs.onBack());
    footer.querySelector("#finish")?.addEventListener("click", async () => {
      await invoke("write_config", { config: this.config });
      cbs.onNext(); // index.ts handles onComplete via onNext from last step
    });
  }
}
```

Update `FirstRunWizard/index.ts` so that `done`'s `onNext` triggers `onComplete`:

```typescript
private go(direction: "next" | "back") {
  const all: WizardStep[] = ["welcome", "mode", "configure", "mic", "hook", "hotkey", "done"];
  const idx = all.indexOf(this.step);
  if (direction === "next" && this.step === "done") {
    this.onComplete();
    return;
  }
  // ... existing logic
}
```

- [ ] **Step 5: Add the big Record button style**

In `FirstRunWizard/styles.css`:

```css
.wizard-record-big {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 36px;
  margin: 24px auto;
  display: block;
  cursor: pointer;
}
.wizard-record-big:hover {
  transform: scale(1.05);
  transition: transform 0.15s;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "frontend: complete FirstRunWizard (Microphone/Hook/Hotkey/Done steps)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Manual end-to-end**

```bash
# Terminal A
cargo run -p phoneme-daemon -- --foreground

# Terminal B
cargo tauri dev
```

If no `config.toml` exists at `%APPDATA%\phoneme\config.toml`, the wizard launches. Walk through it. After completion, the recordings view appears. Open Settings → all sections render. Open Doctor → all checks visible.

- [ ] **Step 2: Type-check + lint**

```bash
cd frontend && pnpm type-check && cd ..
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

Expected: clean.

- [ ] **Step 3: Mark Plan 5 complete**

```bash
git commit --allow-empty -m "milestone: Plan 5 complete (Settings + Doctor + Wizard green)"
git log --oneline | head -40
```

---

## Plan-level self-review

- **Spec coverage:**
  - Milestone 14 (Settings) → Tasks 4, 5 ✓
  - Milestone 15 (Doctor) → Task 6 ✓
  - Milestone 16 (First-run wizard) → Tasks 7, 8 ✓
  - All seven wizard steps from spec ✓
  - Atomic config.toml write (temp → rename) → Task 1 ✓
  - Wizard auto-launches on missing config → Task 3 ✓
  - Doctor's fix-it buttons → Task 6 ✓
  - Tray menu nav (Settings/Doctor) → Task 3 ✓

- **Spec deviations:**
  - Microphone "live level meter" deferred — wizard shows device picker only. Acceptable for v1; revisit if onboarding feels weak.
  - Doctor checks are a starter set (daemon, config, audio dir, hook, model file). Add more per spec's full DoctorView mock during polish.
  - Wizard hotkey "combo capture" uses a text input instead of KeyboardEvent capture; user types `Ctrl+Alt+Space` literally. Real combo capture is a v1.1 polish item.

- **Open items deferred to execution:**
  - "Pause hotkey" tray menu entry when hotkey enabled.
  - Hook test result UI in `SectionHook` (parallel to LLM test in `SectionLlm`).
  - "Rebuild catalog" button wiring in `SectionAdvanced` — currently the spec daemon supports it via reconcile.rs; expose as an IPC command and call from settings.

---

## End of Plan 5
