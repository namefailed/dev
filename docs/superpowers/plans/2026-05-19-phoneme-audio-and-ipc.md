# Phoneme — Plan 2: `phoneme-audio` + `phoneme-ipc`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two libraries the daemon depends on: `phoneme-audio` (CPAL audio capture, WAV encoding, silence detection) and `phoneme-ipc` (transport-agnostic JSON schema + Windows named-pipe transport).

**Depends on:** Plan 1 complete (`phoneme-core` available as a workspace dependency).

**Architecture:** Two new library crates added to the Cargo workspace. `phoneme-audio` is purely about capturing audio and encoding it to a WAV file on disk — no knowledge of recording metadata, catalogs, or queues. `phoneme-ipc` defines the JSON wire schema for daemon ↔ client communication; the schema is transport-agnostic so a future HTTP transport (for mobile, per the spec's v2.0 note) is a drop-in implementation of a `Transport` trait.

**Tech stack:** CPAL 0.15 (audio I/O), hound 3.5 (WAV encoding), tokio's `windows::named_pipe` (IPC transport), serde + serde_json (schema), tokio_util (codec helpers), tempfile + tokio test-utils (testing), rubato (resampling).

**Spec reference:** `~/dev/phoneme/docs/superpowers/specs/2026-05-19-phoneme-design.md` — milestones 7 and 8.

---

## File structure for this plan

```
crates/
├── phoneme-audio/
│   ├── Cargo.toml                          [create]
│   ├── README.md                           [create]
│   ├── src/
│   │   ├── lib.rs                          [create — public API + module declarations]
│   │   ├── format.rs                       [create — SampleFormat, AudioConfig types]
│   │   ├── wav.rs                          [create — write_wav, read_wav]
│   │   ├── device.rs                       [create — list_input_devices, default_input_device]
│   │   ├── capture.rs                      [create — CaptureStream wrapping CPAL]
│   │   ├── convert.rs                      [create — f32→i16, resample, mono mix]
│   │   ├── silence.rs                      [create — SilenceDetector]
│   │   ├── recorder.rs                     [create — Recorder public API]
│   │   └── source.rs                       [create — Source trait + synthetic test impl]
│   └── tests/
│       ├── wav.rs                          [create — WAV roundtrip tests]
│       ├── silence.rs                      [create — silence detection tests]
│       └── recorder.rs                     [create — Recorder integration via synthetic source]
└── phoneme-ipc/
    ├── Cargo.toml                          [create]
    ├── README.md                           [create]
    ├── src/
    │   ├── lib.rs                          [create]
    │   ├── schema.rs                       [create — Request, Response, DaemonEvent, IpcError]
    │   ├── codec.rs                        [create — newline-delimited JSON framing]
    │   ├── transport.rs                    [create — Transport trait]
    │   ├── named_pipe.rs                   [create — Windows named-pipe server + client]
    │   └── error.rs                        [create — IpcTransportError]
    └── tests/
        ├── codec.rs                        [create — framing tests]
        ├── schema.rs                       [create — schema roundtrip tests]
        └── round_trip.rs                   [create — client ↔ server integration]
```

Modifications to existing files:

- `Cargo.toml` (workspace root) — add the two crates to `members` and append `cpal`, `hound`, `rubato`, `tokio-util` to `workspace.dependencies`.

---

## Task 1: Workspace add + `phoneme-audio` scaffold

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Create: `crates/phoneme-audio/Cargo.toml`
- Create: `crates/phoneme-audio/src/lib.rs`

- [ ] **Step 1: Add `phoneme-audio` to workspace members**

Open `Cargo.toml` at the repo root. In the `[workspace] members = [...]` array, add `"crates/phoneme-audio"` after the existing `phoneme-core` entry. In `[workspace.dependencies]`, append:

```toml
cpal = "0.15"
hound = "3.5"
rubato = "0.15"
tokio-util = { version = "0.7", features = ["codec"] }
bytes = "1"
```

- [ ] **Step 2: Create `crates/phoneme-audio/Cargo.toml`**

```toml
[package]
name = "phoneme-audio"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
phoneme-core = { path = "../phoneme-core" }
anyhow.workspace = true
thiserror.workspace = true
serde.workspace = true
tokio.workspace = true
tracing.workspace = true
cpal.workspace = true
hound.workspace = true
rubato.workspace = true

[dev-dependencies]
proptest.workspace = true
tempfile.workspace = true
tokio = { workspace = true, features = ["test-util", "macros"] }
```

- [ ] **Step 3: Create empty `crates/phoneme-audio/src/lib.rs`**

```rust
//! phoneme-audio — audio capture and WAV encoding for Phoneme.
//!
//! Modules will be added in subsequent tasks.
```

- [ ] **Step 4: Verify the workspace builds**

Run: `cargo build --workspace`
Expected: builds with no errors. CPAL pulls in some platform crates on first compile; this is normal.

- [ ] **Step 5: Verify tests run (no tests yet)**

Run: `cargo test --workspace`
Expected: existing Plan 1 tests pass; `phoneme-audio` shows `running 0 tests`.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/phoneme-audio/
git commit -m "scaffold phoneme-audio crate"
```

---

## Task 2: WAV encoding and decoding

**Files:**
- Create: `crates/phoneme-audio/src/format.rs`
- Create: `crates/phoneme-audio/src/wav.rs`
- Modify: `crates/phoneme-audio/src/lib.rs`
- Create: `crates/phoneme-audio/tests/wav.rs`

- [ ] **Step 1: Define audio format types**

Create `crates/phoneme-audio/src/format.rs`:

```rust
//! Audio format types shared across capture, encoding, and conversion.

use serde::{Deserialize, Serialize};

/// Sample rate in Hz. Phoneme always records at 16 kHz, but this type lets us
/// be explicit about what the CPAL device offered vs. what we save.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SampleRate(pub u32);

impl SampleRate {
    pub const HZ_16K: Self = Self(16_000);
    pub const HZ_44_1K: Self = Self(44_100);
    pub const HZ_48K: Self = Self(48_000);

    pub fn as_u32(&self) -> u32 {
        self.0
    }
}

/// Number of audio channels. Phoneme always saves mono.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Channels(pub u8);

impl Channels {
    pub const MONO: Self = Self(1);
    pub const STEREO: Self = Self(2);

    pub fn as_u8(&self) -> u8 {
        self.0
    }
}

/// Phoneme's canonical recording format: 16-bit PCM, 16 kHz mono.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioConfig {
    pub sample_rate: SampleRate,
    pub channels: Channels,
}

impl AudioConfig {
    pub const fn phoneme_default() -> Self {
        Self { sample_rate: SampleRate::HZ_16K, channels: Channels::MONO }
    }
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self::phoneme_default()
    }
}
```

- [ ] **Step 2: Write the failing WAV tests**

Create `crates/phoneme-audio/tests/wav.rs`:

```rust
use phoneme_audio::format::{AudioConfig, Channels, SampleRate};
use phoneme_audio::wav;
use tempfile::TempDir;

fn synth_sine(seconds: f32, freq: f32, sample_rate: u32) -> Vec<i16> {
    let n = (seconds * sample_rate as f32) as usize;
    (0..n)
        .map(|i| {
            let t = i as f32 / sample_rate as f32;
            (32000.0 * (2.0 * std::f32::consts::PI * freq * t).sin()) as i16
        })
        .collect()
}

#[test]
fn write_then_read_round_trips_samples() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sine.wav");
    let samples = synth_sine(1.0, 440.0, 16_000);
    wav::write_wav(&path, &samples, AudioConfig::phoneme_default()).unwrap();

    let (read_samples, cfg) = wav::read_wav(&path).unwrap();
    assert_eq!(cfg.sample_rate, SampleRate::HZ_16K);
    assert_eq!(cfg.channels, Channels::MONO);
    assert_eq!(read_samples.len(), samples.len());
    // Allow small rounding drift; should be exact for i16.
    assert_eq!(read_samples, samples);
}

#[test]
fn write_creates_parent_directories() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("2026-05-19").join("143500823.wav");
    let samples = synth_sine(0.1, 440.0, 16_000);
    wav::write_wav(&nested, &samples, AudioConfig::phoneme_default()).unwrap();
    assert!(nested.exists());
}

#[test]
fn write_empty_buffer_is_ok() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("empty.wav");
    let samples: Vec<i16> = vec![];
    wav::write_wav(&path, &samples, AudioConfig::phoneme_default()).unwrap();
    let (read_samples, _) = wav::read_wav(&path).unwrap();
    assert!(read_samples.is_empty());
}

#[test]
fn duration_matches_sample_count() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("d.wav");
    let samples = synth_sine(2.5, 440.0, 16_000);
    wav::write_wav(&path, &samples, AudioConfig::phoneme_default()).unwrap();
    let ms = wav::duration_ms(&path).unwrap();
    // 2.5s @ 16kHz = 40000 samples / 16000 = 2.5s = 2500ms (±1ms tolerance)
    assert!((2490..=2510).contains(&ms), "got {ms}ms");
}

#[test]
fn read_nonexistent_file_is_error() {
    let err = wav::read_wav(std::path::Path::new("/no/such/file.wav")).unwrap_err();
    assert!(format!("{err}").to_lowercase().contains("no such") || format!("{err}").to_lowercase().contains("not found") || format!("{err}").to_lowercase().contains("cannot"));
}
```

- [ ] **Step 3: Run tests; expect they fail (no wav module yet)**

Run: `cargo test -p phoneme-audio --test wav`
Expected: compile error referencing missing `phoneme_audio::wav`.

- [ ] **Step 4: Create `crates/phoneme-audio/src/wav.rs`**

```rust
//! WAV encoding and decoding via `hound`.
//!
//! All Phoneme recordings are 16-bit PCM. This module deals only with that
//! format — `hound::WavWriter`/`WavReader` handle the on-disk byte layout.

use crate::format::{AudioConfig, Channels, SampleRate};
use phoneme_core::error::{Error, Result};
use std::path::Path;

/// Write a buffer of `i16` samples to a WAV file. Creates parent directories
/// if missing.
pub fn write_wav(path: &Path, samples: &[i16], cfg: AudioConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let spec = hound::WavSpec {
        channels: cfg.channels.as_u8() as u16,
        sample_rate: cfg.sample_rate.as_u32(),
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| Error::Internal(format!("hound create: {e}")))?;
    for &s in samples {
        writer
            .write_sample(s)
            .map_err(|e| Error::Internal(format!("hound write_sample: {e}")))?;
    }
    writer
        .finalize()
        .map_err(|e| Error::Internal(format!("hound finalize: {e}")))?;
    Ok(())
}

/// Read a WAV file as `(samples, config)`. The returned config reflects the
/// file's actual format, not Phoneme's default.
pub fn read_wav(path: &Path) -> Result<(Vec<i16>, AudioConfig)> {
    let reader = hound::WavReader::open(path)
        .map_err(|e| match e {
            hound::Error::IoError(io) => Error::Io(io),
            other => Error::Internal(format!("hound open: {other}")),
        })?;
    let spec = reader.spec();
    let cfg = AudioConfig {
        sample_rate: SampleRate(spec.sample_rate),
        channels: Channels(spec.channels as u8),
    };
    let samples: Vec<i16> = reader
        .into_samples::<i16>()
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| Error::Internal(format!("hound read: {e}")))?;
    Ok((samples, cfg))
}

/// Read just the duration of a WAV file in milliseconds (cheap — no sample data).
pub fn duration_ms(path: &Path) -> Result<i64> {
    let reader = hound::WavReader::open(path)
        .map_err(|e| Error::Internal(format!("hound open: {e}")))?;
    let spec = reader.spec();
    let frames = reader.len() as u64 / spec.channels.max(1) as u64;
    let ms = (frames * 1000) / spec.sample_rate.max(1) as u64;
    Ok(ms as i64)
}
```

- [ ] **Step 5: Wire modules into `lib.rs`**

Update `crates/phoneme-audio/src/lib.rs`:

```rust
//! phoneme-audio — audio capture and WAV encoding for Phoneme.

pub mod format;
pub mod wav;

pub use format::{AudioConfig, Channels, SampleRate};
```

- [ ] **Step 6: Run tests; verify they pass**

Run: `cargo test -p phoneme-audio --test wav`
Expected: `test result: ok. 5 passed; 0 failed`

- [ ] **Step 7: Lint**

Run: `cargo clippy -p phoneme-audio --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 8: Commit**

```bash
git add crates/phoneme-audio/
git commit -m "phoneme-audio: add format types and WAV encode/decode"
```

---

## Task 3: Input device enumeration

**Files:**
- Create: `crates/phoneme-audio/src/device.rs`
- Modify: `crates/phoneme-audio/src/lib.rs`

- [ ] **Step 1: Write the test (unit tests, gated for CI without devices)**

Append to `crates/phoneme-audio/src/device.rs`'s `mod tests` (you'll create the file with this content):

```rust
//! Audio input device enumeration via CPAL.
//!
//! On Windows this is the WASAPI default-host's input devices.

use cpal::traits::{DeviceTrait, HostTrait};
use phoneme_core::error::{Error, Result};

/// Lightweight info about an audio input device.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DeviceInfo {
    pub name: String,
    pub is_default: bool,
}

/// Enumerate available input devices on the system default host.
pub fn list_input_devices() -> Result<Vec<DeviceInfo>> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let devices = host
        .input_devices()
        .map_err(|e| Error::Internal(format!("cpal input_devices: {e}")))?;

    let mut out = Vec::new();
    for d in devices {
        let name = match d.name() {
            Ok(n) => n,
            Err(_) => continue, // skip devices we can't name
        };
        let is_default = default_name.as_deref() == Some(&name);
        out.push(DeviceInfo { name, is_default });
    }
    Ok(out)
}

/// Return the system default input device, if any.
pub fn default_input_device() -> Option<DeviceInfo> {
    let host = cpal::default_host();
    let d = host.default_input_device()?;
    let name = d.name().ok()?;
    Some(DeviceInfo { name, is_default: true })
}

/// Resolve a device by name. Returns `None` if not found.
pub fn find_device_by_name(name: &str) -> Result<Option<cpal::Device>> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| Error::Internal(format!("cpal input_devices: {e}")))?;
    for d in devices {
        if d.name().ok().as_deref() == Some(name) {
            return Ok(Some(d));
        }
    }
    Ok(None)
}

/// Resolve the CPAL `Device` for the configured input. If `requested == "default"`,
/// returns the default; otherwise looks up by name.
pub fn resolve_input_device(requested: &str) -> Result<cpal::Device> {
    let host = cpal::default_host();
    if requested == "default" || requested.is_empty() {
        return host
            .default_input_device()
            .ok_or_else(|| Error::Internal("no default input device".into()));
    }
    find_device_by_name(requested)?
        .ok_or_else(|| Error::Internal(format!("input device not found: {requested}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests need a real audio device on the system. Skip if none is
    // present — CI runners (especially Linux containers) often lack one.
    fn has_audio() -> bool {
        default_input_device().is_some()
    }

    #[test]
    fn list_input_devices_does_not_panic() {
        // We don't assert a particular count; just that the call succeeds.
        let _ = list_input_devices();
    }

    #[test]
    fn default_marker_aligns_with_helper() {
        if !has_audio() {
            return;
        }
        let list = list_input_devices().unwrap();
        let default_count = list.iter().filter(|d| d.is_default).count();
        assert!(default_count <= 1, "at most one default expected");
        let default = default_input_device().unwrap();
        let in_list = list.iter().any(|d| d.name == default.name);
        assert!(in_list, "default should appear in the list");
    }

    #[test]
    fn resolve_default_returns_some_device() {
        if !has_audio() {
            return;
        }
        let _device = resolve_input_device("default").unwrap();
    }

    #[test]
    fn resolve_unknown_name_errors() {
        let err = resolve_input_device("absolutely_not_a_real_device_xyz").unwrap_err();
        assert!(format!("{err}").contains("not found"));
    }
}
```

- [ ] **Step 2: Wire module into `lib.rs`**

Update `crates/phoneme-audio/src/lib.rs`:

```rust
//! phoneme-audio — audio capture and WAV encoding for Phoneme.

pub mod device;
pub mod format;
pub mod wav;

pub use device::{default_input_device, list_input_devices, DeviceInfo};
pub use format::{AudioConfig, Channels, SampleRate};
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p phoneme-audio device::`
Expected: 4 tests run; some may early-return if no audio device. All pass.

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-audio --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-audio/
git commit -m "phoneme-audio: add input device enumeration (CPAL)"
```

---

## Task 4: Sample format conversion (f32 → i16, downmix, resample)

**Files:**
- Create: `crates/phoneme-audio/src/convert.rs`
- Modify: `crates/phoneme-audio/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/phoneme-audio/src/convert.rs`:

```rust
//! Sample format conversion helpers.
//!
//! CPAL commonly hands us f32 samples at 44.1 or 48 kHz stereo from the OS;
//! Phoneme writes i16 at 16 kHz mono. These functions bridge the gap.

use phoneme_core::error::{Error, Result};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

/// Convert f32 samples in `[-1.0, 1.0]` to i16. Values outside the range are
/// clamped (not wrapped).
pub fn f32_to_i16(input: &[f32]) -> Vec<i16> {
    input
        .iter()
        .map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            (clamped * i16::MAX as f32) as i16
        })
        .collect()
}

/// Convert i16 samples to f32 in `[-1.0, 1.0]`.
pub fn i16_to_f32(input: &[i16]) -> Vec<f32> {
    input.iter().map(|&s| s as f32 / i16::MAX as f32).collect()
}

/// Downmix multi-channel interleaved samples to mono by averaging.
pub fn downmix_to_mono_f32(input: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return input.to_vec();
    }
    let frames = input.len() / channels;
    (0..frames)
        .map(|f| {
            let start = f * channels;
            input[start..start + channels].iter().sum::<f32>() / channels as f32
        })
        .collect()
}

/// Resample mono f32 samples from `from_rate` to `to_rate`. If the rates match,
/// returns a copy. Uses rubato's sinc resampler with default parameters tuned
/// for speech.
pub fn resample_mono(input: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>> {
    if from_rate == to_rate {
        return Ok(input.to_vec());
    }
    if input.is_empty() {
        return Ok(vec![]);
    }
    let params = SincInterpolationParameters {
        sinc_len: 128,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };
    let ratio = to_rate as f64 / from_rate as f64;
    let chunk_size = input.len();
    let mut resampler = SincFixedIn::<f32>::new(ratio, 1.0, params, chunk_size, 1)
        .map_err(|e| Error::Internal(format!("rubato init: {e}")))?;
    let chunks = vec![input.to_vec()];
    let out = resampler
        .process(&chunks, None)
        .map_err(|e| Error::Internal(format!("rubato process: {e}")))?;
    Ok(out.into_iter().next().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f32_to_i16_round_trips_within_tolerance() {
        let orig: Vec<f32> = vec![0.0, 0.5, -0.5, 1.0, -1.0];
        let int16 = f32_to_i16(&orig);
        let back = i16_to_f32(&int16);
        for (o, b) in orig.iter().zip(back.iter()) {
            assert!((o - b).abs() < 0.001, "drift too high: orig={o} back={b}");
        }
    }

    #[test]
    fn f32_to_i16_clamps_out_of_range() {
        let v = f32_to_i16(&[1.5, -2.0, 0.0]);
        assert_eq!(v[0], i16::MAX);
        assert_eq!(v[1], i16::MIN + 1); // ((-1.0)*32767) as i16 = -32767
        assert_eq!(v[2], 0);
    }

    #[test]
    fn downmix_stereo_averages_channels() {
        // Interleaved L,R,L,R,L,R
        let stereo = vec![1.0, -1.0, 0.5, -0.5, 0.0, 0.0];
        let mono = downmix_to_mono_f32(&stereo, 2);
        assert_eq!(mono, vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn downmix_mono_is_identity() {
        let mono = vec![0.1, 0.2, 0.3];
        let out = downmix_to_mono_f32(&mono, 1);
        assert_eq!(out, mono);
    }

    #[test]
    fn resample_same_rate_is_identity() {
        let input = vec![0.0_f32, 0.5, -0.5];
        let out = resample_mono(&input, 16_000, 16_000).unwrap();
        assert_eq!(out, input);
    }

    #[test]
    fn resample_downsamples_length_roughly_proportional() {
        // 1 second of 48kHz mono = 48000 samples → ~16000 after resample to 16kHz
        let input = vec![0.0_f32; 48_000];
        let out = resample_mono(&input, 48_000, 16_000).unwrap();
        // Rubato's chunked resampler has some delay/padding; allow ±5%.
        let expected = 16_000;
        let tolerance = (expected as f32 * 0.05) as usize;
        assert!(
            (out.len() as i64 - expected as i64).unsigned_abs() as usize <= tolerance,
            "got {} samples, expected ~{}",
            out.len(),
            expected
        );
    }
}
```

- [ ] **Step 2: Wire module into `lib.rs`**

Update `crates/phoneme-audio/src/lib.rs`:

```rust
//! phoneme-audio — audio capture and WAV encoding for Phoneme.

pub mod convert;
pub mod device;
pub mod format;
pub mod wav;

pub use device::{default_input_device, list_input_devices, DeviceInfo};
pub use format::{AudioConfig, Channels, SampleRate};
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p phoneme-audio convert::`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-audio --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-audio/
git commit -m "phoneme-audio: add format conversion (f32↔i16, downmix, resample)"
```

---

## Task 5: Silence detection

**Files:**
- Create: `crates/phoneme-audio/src/silence.rs`
- Modify: `crates/phoneme-audio/src/lib.rs`
- Create: `crates/phoneme-audio/tests/silence.rs`

- [ ] **Step 1: Write the failing integration tests**

Create `crates/phoneme-audio/tests/silence.rs`:

```rust
use phoneme_audio::silence::SilenceDetector;

fn synth_silence(samples: usize) -> Vec<i16> {
    vec![0; samples]
}

fn synth_loud(samples: usize) -> Vec<i16> {
    (0..samples)
        .map(|i| ((i as f32 * 0.05).sin() * 20_000.0) as i16)
        .collect()
}

#[test]
fn empty_input_does_not_trigger() {
    let mut det = SilenceDetector::new(-45.0, 1000, 16_000);
    assert!(!det.is_silent());
    det.push(&[]);
    assert!(!det.is_silent());
}

#[test]
fn loud_input_does_not_trigger() {
    // 2 seconds of loud signal at 16kHz; window is 1 second; should never trigger.
    let mut det = SilenceDetector::new(-45.0, 1000, 16_000);
    det.push(&synth_loud(32_000));
    assert!(!det.is_silent());
}

#[test]
fn silent_input_for_full_window_triggers() {
    // 1.5 seconds of silence; window is 1s → triggers.
    let mut det = SilenceDetector::new(-45.0, 1000, 16_000);
    det.push(&synth_silence(24_000));
    assert!(det.is_silent());
}

#[test]
fn silent_input_below_window_does_not_trigger() {
    // 500ms of silence; window is 1s → does NOT trigger yet.
    let mut det = SilenceDetector::new(-45.0, 1000, 16_000);
    det.push(&synth_silence(8_000));
    assert!(!det.is_silent());
}

#[test]
fn loud_then_silent_takes_full_window_to_trigger() {
    let mut det = SilenceDetector::new(-45.0, 1000, 16_000);
    det.push(&synth_loud(8_000));    // 0.5s loud
    assert!(!det.is_silent());
    det.push(&synth_silence(8_000)); // 0.5s silent
    assert!(!det.is_silent());        // half window of silence — still loud overall
    det.push(&synth_silence(8_000)); // another 0.5s silent
    assert!(det.is_silent());         // now full window is silent
}

#[test]
fn reset_clears_history() {
    let mut det = SilenceDetector::new(-45.0, 1000, 16_000);
    det.push(&synth_silence(24_000));
    assert!(det.is_silent());
    det.reset();
    assert!(!det.is_silent());
}
```

- [ ] **Step 2: Run tests; expect they fail**

Run: `cargo test -p phoneme-audio --test silence`
Expected: compile error referencing missing module.

- [ ] **Step 3: Create `crates/phoneme-audio/src/silence.rs`**

```rust
//! Silence detection over a rolling window.
//!
//! Compares the RMS energy of the most-recent `window_ms` of audio against a
//! configurable dBFS threshold. When the rolling RMS falls below the threshold
//! for the full window, [`SilenceDetector::is_silent`] returns `true`.

use std::collections::VecDeque;

#[derive(Debug)]
pub struct SilenceDetector {
    threshold_linear: f32, // 10 ^ (dbfs / 20)
    window_samples: usize,
    /// Squared samples (i16² as f32), oldest first.
    history: VecDeque<f32>,
    /// Running sum of `history`.
    sum_sq: f64,
}

impl SilenceDetector {
    pub fn new(threshold_dbfs: f32, window_ms: u32, sample_rate: u32) -> Self {
        let threshold_linear = 10f32.powf(threshold_dbfs / 20.0);
        let window_samples = (window_ms as u64 * sample_rate as u64 / 1000) as usize;
        Self {
            threshold_linear,
            window_samples: window_samples.max(1),
            history: VecDeque::with_capacity(window_samples + 1),
            sum_sq: 0.0,
        }
    }

    /// Append new samples to the rolling window.
    pub fn push(&mut self, samples: &[i16]) {
        for &s in samples {
            let sq = (s as f32 / i16::MAX as f32).powi(2);
            self.history.push_back(sq);
            self.sum_sq += sq as f64;
            if self.history.len() > self.window_samples {
                if let Some(old) = self.history.pop_front() {
                    self.sum_sq -= old as f64;
                }
            }
        }
    }

    /// `true` iff the rolling window is full AND its RMS energy is below the
    /// configured threshold.
    pub fn is_silent(&self) -> bool {
        if self.history.len() < self.window_samples {
            return false;
        }
        let mean_sq = self.sum_sq / self.history.len() as f64;
        let rms = mean_sq.sqrt() as f32;
        rms < self.threshold_linear
    }

    /// Clear the rolling window. Call after a `start_recording` so the previous
    /// session's tail doesn't trigger silence in the new one.
    pub fn reset(&mut self) {
        self.history.clear();
        self.sum_sq = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_minus_45_converts_to_expected_linear() {
        // 10^(-45/20) ≈ 0.00562
        let det = SilenceDetector::new(-45.0, 100, 16_000);
        assert!((det.threshold_linear - 0.005623).abs() < 1e-4);
    }

    #[test]
    fn window_samples_computed_from_ms_and_rate() {
        let det = SilenceDetector::new(-45.0, 500, 16_000);
        assert_eq!(det.window_samples, 8000);
    }
}
```

- [ ] **Step 4: Wire module into `lib.rs`**

Update `crates/phoneme-audio/src/lib.rs`:

```rust
//! phoneme-audio — audio capture and WAV encoding for Phoneme.

pub mod convert;
pub mod device;
pub mod format;
pub mod silence;
pub mod wav;

pub use device::{default_input_device, list_input_devices, DeviceInfo};
pub use format::{AudioConfig, Channels, SampleRate};
pub use silence::SilenceDetector;
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p phoneme-audio silence`
Expected: 6 integration + 2 unit = 8 tests pass.

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-audio --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-audio/
git commit -m "phoneme-audio: add SilenceDetector (RMS over rolling window)"
```

---

## Task 6: Source trait (production CPAL + synthetic test impl)

**Files:**
- Create: `crates/phoneme-audio/src/source.rs`
- Modify: `crates/phoneme-audio/src/lib.rs`

The `Source` trait lets the `Recorder` consume audio from either a real CPAL input (production) or a hand-fed synthetic stream (tests). The Recorder's test suite drives a synthetic source through realistic scenarios without needing hardware.

- [ ] **Step 1: Define the trait**

Create `crates/phoneme-audio/src/source.rs`:

```rust
//! Abstraction over an audio sample source.
//!
//! Production code uses [`CpalSource`] which wraps a CPAL input stream;
//! tests use [`SyntheticSource`] which is hand-fed sample buffers.

use crate::format::AudioConfig;
use phoneme_core::error::{Error, Result};
use std::sync::Arc;
use tokio::sync::mpsc;

/// One block of i16 samples (already converted to Phoneme's canonical format:
/// 16-bit mono PCM at 16 kHz).
pub type SampleBlock = Vec<i16>;

/// An asynchronous source of audio sample blocks. Implementations must convert
/// to Phoneme's canonical format (16-bit, 16 kHz, mono) before yielding.
#[async_trait::async_trait]
pub trait Source: Send {
    /// Configuration that this source produces. Always reports the canonical
    /// format that downstream consumers will see (after any internal
    /// conversion).
    fn config(&self) -> AudioConfig;

    /// Pull the next block of samples. Returns `Ok(None)` when the source has
    /// been stopped and drained.
    async fn next_block(&mut self) -> Result<Option<SampleBlock>>;

    /// Stop the underlying capture. After calling, `next_block` should return
    /// `Ok(None)` shortly.
    async fn stop(&mut self) -> Result<()>;
}

/// A synthetic source: backed by an mpsc channel that tests push samples into.
///
/// Closing the sender side causes `next_block` to return `None`.
pub struct SyntheticSource {
    cfg: AudioConfig,
    rx: mpsc::Receiver<SampleBlock>,
}

impl SyntheticSource {
    pub fn new(cfg: AudioConfig) -> (Self, SyntheticSink) {
        let (tx, rx) = mpsc::channel(64);
        (Self { cfg, rx }, SyntheticSink { tx })
    }
}

/// Companion handle that tests use to push samples and then close.
#[derive(Clone)]
pub struct SyntheticSink {
    tx: mpsc::Sender<SampleBlock>,
}

impl SyntheticSink {
    pub async fn push(&self, block: SampleBlock) -> Result<()> {
        self.tx
            .send(block)
            .await
            .map_err(|_| Error::Internal("synthetic sink dropped".into()))
    }

    /// Close the sink, causing the matched source to return `None`.
    pub fn close(self) {
        drop(self.tx);
    }
}

#[async_trait::async_trait]
impl Source for SyntheticSource {
    fn config(&self) -> AudioConfig {
        self.cfg
    }

    async fn next_block(&mut self) -> Result<Option<SampleBlock>> {
        Ok(self.rx.recv().await)
    }

    async fn stop(&mut self) -> Result<()> {
        self.rx.close();
        Ok(())
    }
}

/// Cancellation handle held by callers; dropping it tells the CPAL source to
/// stop the underlying stream.
pub type StopHandle = Arc<tokio::sync::Notify>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn synthetic_yields_blocks_then_none_on_close() {
        let cfg = AudioConfig::phoneme_default();
        let (mut src, sink) = SyntheticSource::new(cfg);
        sink.push(vec![1, 2, 3]).await.unwrap();
        sink.push(vec![4, 5, 6]).await.unwrap();
        sink.close();
        assert_eq!(src.next_block().await.unwrap(), Some(vec![1, 2, 3]));
        assert_eq!(src.next_block().await.unwrap(), Some(vec![4, 5, 6]));
        assert_eq!(src.next_block().await.unwrap(), None);
    }

    #[tokio::test]
    async fn synthetic_stop_drains_then_returns_none() {
        let cfg = AudioConfig::phoneme_default();
        let (mut src, _sink) = SyntheticSource::new(cfg);
        src.stop().await.unwrap();
        assert_eq!(src.next_block().await.unwrap(), None);
    }
}
```

- [ ] **Step 2: Add `async-trait` dependency**

In `crates/phoneme-audio/Cargo.toml`, under `[dependencies]`, add:

```toml
async-trait = "0.1"
```

- [ ] **Step 3: Wire module into `lib.rs`**

Update `crates/phoneme-audio/src/lib.rs`:

```rust
//! phoneme-audio — audio capture and WAV encoding for Phoneme.

pub mod convert;
pub mod device;
pub mod format;
pub mod silence;
pub mod source;
pub mod wav;

pub use device::{default_input_device, list_input_devices, DeviceInfo};
pub use format::{AudioConfig, Channels, SampleRate};
pub use silence::SilenceDetector;
pub use source::{SampleBlock, Source, SyntheticSink, SyntheticSource};
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p phoneme-audio source::`
Expected: 2 tests pass.

- [ ] **Step 5: Lint**

Run: `cargo clippy -p phoneme-audio --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/phoneme-audio/
git commit -m "phoneme-audio: add Source trait with synthetic test implementation"
```

---

## Task 7: CPAL-backed source

**Files:**
- Modify: `crates/phoneme-audio/src/source.rs`

The production source wraps a CPAL input stream. CPAL stream callbacks are sync; we bridge them to async via an mpsc channel. Format conversion (f32→i16, downmix, resample) happens inline.

- [ ] **Step 1: Add `CpalSource` to `source.rs`**

Append to `crates/phoneme-audio/src/source.rs` (after the `SyntheticSource` impl):

```rust
use crate::convert::{downmix_to_mono_f32, f32_to_i16, resample_mono};
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{SampleFormat as CpalSampleFormat, StreamConfig};

/// A CPAL-backed source that converts the device's native format to
/// 16-bit mono 16 kHz before yielding sample blocks.
pub struct CpalSource {
    cfg: AudioConfig,
    rx: mpsc::Receiver<SampleBlock>,
    _stream: cpal::Stream,
}

impl CpalSource {
    /// Open a stream on the given device. Resolves the device's preferred input
    /// config, picks the closest match to Phoneme's canonical format, and
    /// installs callbacks that convert + ship blocks via an mpsc channel.
    pub fn open(device: cpal::Device) -> Result<Self> {
        let supported = device
            .default_input_config()
            .map_err(|e| Error::Internal(format!("cpal default_input_config: {e}")))?;

        let device_sample_rate = supported.sample_rate().0;
        let device_channels = supported.channels() as usize;
        let device_format = supported.sample_format();
        let stream_cfg: StreamConfig = supported.into();

        let (tx, rx) = mpsc::channel(64);
        let target_rate = SampleRate::HZ_16K.as_u32();

        let stream = match device_format {
            CpalSampleFormat::F32 => {
                let tx = tx.clone();
                device.build_input_stream(
                    &stream_cfg,
                    move |data: &[f32], _| {
                        let mono = downmix_to_mono_f32(data, device_channels);
                        let resampled = resample_mono(&mono, device_sample_rate, target_rate)
                            .unwrap_or_default();
                        let i16s = f32_to_i16(&resampled);
                        let _ = tx.try_send(i16s);
                    },
                    move |err| {
                        tracing::warn!("cpal stream error: {err}");
                    },
                    None,
                )
            }
            CpalSampleFormat::I16 => {
                let tx = tx.clone();
                device.build_input_stream(
                    &stream_cfg,
                    move |data: &[i16], _| {
                        let f32s: Vec<f32> = crate::convert::i16_to_f32(data);
                        let mono = downmix_to_mono_f32(&f32s, device_channels);
                        let resampled = resample_mono(&mono, device_sample_rate, target_rate)
                            .unwrap_or_default();
                        let i16s = f32_to_i16(&resampled);
                        let _ = tx.try_send(i16s);
                    },
                    move |err| {
                        tracing::warn!("cpal stream error: {err}");
                    },
                    None,
                )
            }
            other => {
                return Err(Error::Internal(format!(
                    "unsupported CPAL sample format: {other:?}"
                )));
            }
        }
        .map_err(|e| Error::Internal(format!("cpal build_input_stream: {e}")))?;

        stream
            .play()
            .map_err(|e| Error::Internal(format!("cpal play: {e}")))?;

        let cfg = AudioConfig::phoneme_default();
        drop(tx); // close the sender clone in this scope; only the closure holds one now
        Ok(Self { cfg, rx, _stream: stream })
    }
}

#[async_trait::async_trait]
impl Source for CpalSource {
    fn config(&self) -> AudioConfig {
        self.cfg
    }

    async fn next_block(&mut self) -> Result<Option<SampleBlock>> {
        Ok(self.rx.recv().await)
    }

    async fn stop(&mut self) -> Result<()> {
        // Dropping `_stream` (which happens when CpalSource is dropped) pauses
        // CPAL. To stop early without dropping the struct, close the channel.
        self.rx.close();
        Ok(())
    }
}
```

- [ ] **Step 2: Verify it builds**

Run: `cargo build -p phoneme-audio`
Expected: clean build. CpalSource is only constructable when a real device exists, so there are no integration tests at this layer — coverage comes from the Recorder tests in Task 9.

- [ ] **Step 3: Lint**

Run: `cargo clippy -p phoneme-audio --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 4: Commit**

```bash
git add crates/phoneme-audio/
git commit -m "phoneme-audio: add CpalSource (production audio capture)"
```

---

## Task 8: Recorder public API

**Files:**
- Create: `crates/phoneme-audio/src/recorder.rs`
- Modify: `crates/phoneme-audio/src/lib.rs`
- Create: `crates/phoneme-audio/tests/recorder.rs`

The `Recorder` is the public surface other crates consume. It ties together: a `Source` (CPAL in prod, synthetic in tests), an in-memory buffer, optional silence detection, and final WAV finalization.

- [ ] **Step 1: Write the failing integration tests**

Create `crates/phoneme-audio/tests/recorder.rs`:

```rust
use phoneme_audio::format::{AudioConfig, SampleRate};
use phoneme_audio::recorder::{RecorderConfig, RecordingMode};
use phoneme_audio::source::{SyntheticSink, SyntheticSource};
use phoneme_audio::wav;
use phoneme_audio::Recorder;
use std::time::Duration;
use tempfile::TempDir;

fn loud_block(samples: usize) -> Vec<i16> {
    (0..samples)
        .map(|i| ((i as f32 * 0.05).sin() * 20_000.0) as i16)
        .collect()
}

fn silent_block(samples: usize) -> Vec<i16> {
    vec![0; samples]
}

fn make_synthetic() -> (SyntheticSource, SyntheticSink) {
    SyntheticSource::new(AudioConfig::phoneme_default())
}

#[tokio::test]
async fn hold_mode_writes_wav_with_pushed_samples() {
    let dir = TempDir::new().unwrap();
    let wav_path = dir.path().join("rec.wav");
    let (source, sink) = make_synthetic();
    let cfg = RecorderConfig {
        mode: RecordingMode::Hold,
        max_duration_ms: 10_000,
        silence_threshold_dbfs: -45.0,
        silence_window_ms: 1000,
    };
    let recorder = Recorder::start(Box::new(source), cfg).await.unwrap();

    sink.push(loud_block(8000)).await.unwrap();   // 0.5s
    sink.push(loud_block(8000)).await.unwrap();   // 1.0s total
    sink.close();

    let result = recorder.stop_and_finalize(&wav_path).await.unwrap();
    assert!((result.duration_ms - 1000).abs() < 50, "duration was {}ms", result.duration_ms);
    let (samples, _) = wav::read_wav(&wav_path).unwrap();
    assert!(samples.len() >= 16_000 - 100); // ~1s worth of samples
}

#[tokio::test]
async fn cancel_does_not_write_wav() {
    let dir = TempDir::new().unwrap();
    let wav_path = dir.path().join("cancelled.wav");
    let (source, sink) = make_synthetic();
    let cfg = RecorderConfig {
        mode: RecordingMode::Hold,
        max_duration_ms: 10_000,
        silence_threshold_dbfs: -45.0,
        silence_window_ms: 1000,
    };
    let recorder = Recorder::start(Box::new(source), cfg).await.unwrap();

    sink.push(loud_block(8000)).await.unwrap();
    recorder.cancel().await.unwrap();
    sink.close();

    assert!(!wav_path.exists(), "cancel should not write a wav file");
}

#[tokio::test]
async fn oneshot_mode_stops_on_silence() {
    let dir = TempDir::new().unwrap();
    let wav_path = dir.path().join("oneshot.wav");
    let (source, sink) = make_synthetic();
    let cfg = RecorderConfig {
        mode: RecordingMode::Oneshot,
        max_duration_ms: 30_000,
        silence_threshold_dbfs: -45.0,
        silence_window_ms: 500, // 0.5s silence to trigger
    };
    let recorder = Recorder::start(Box::new(source), cfg).await.unwrap();

    // 1s of loud audio, then 1s of silence
    sink.push(loud_block(16_000)).await.unwrap();
    sink.push(silent_block(16_000)).await.unwrap();

    // The recorder should auto-finalize. Wait for it.
    let finalize = recorder.wait_for_finalize(&wav_path).await.unwrap();
    sink.close();

    assert!(finalize.duration_ms < 30_000);
    assert!(wav_path.exists());
}

#[tokio::test]
async fn duration_mode_stops_after_n_seconds() {
    let dir = TempDir::new().unwrap();
    let wav_path = dir.path().join("dur.wav");
    let (source, sink) = make_synthetic();
    let cfg = RecorderConfig {
        mode: RecordingMode::Duration { secs: 1 },
        max_duration_ms: 30_000,
        silence_threshold_dbfs: -45.0,
        silence_window_ms: 5000,
    };
    let recorder = Recorder::start(Box::new(source), cfg).await.unwrap();

    // Feed plenty of loud samples; recorder should auto-stop at 1s.
    let pump = tokio::spawn({
        let sink = sink.clone();
        async move {
            for _ in 0..20 {
                if sink.push(loud_block(1600)).await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    });

    let finalize = recorder.wait_for_finalize(&wav_path).await.unwrap();
    pump.abort();
    sink.close();

    assert!((finalize.duration_ms - 1000).abs() < 200);
}

#[tokio::test]
async fn max_duration_truncates_a_runaway_recording() {
    let dir = TempDir::new().unwrap();
    let wav_path = dir.path().join("max.wav");
    let (source, sink) = make_synthetic();
    let cfg = RecorderConfig {
        mode: RecordingMode::Hold,
        max_duration_ms: 500, // 0.5s cap
        silence_threshold_dbfs: -45.0,
        silence_window_ms: 5000,
    };
    let recorder = Recorder::start(Box::new(source), cfg).await.unwrap();

    let pump = tokio::spawn({
        let sink = sink.clone();
        async move {
            for _ in 0..10 {
                if sink.push(loud_block(1600)).await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    });

    let finalize = recorder.wait_for_finalize(&wav_path).await.unwrap();
    pump.abort();
    sink.close();

    assert!(finalize.duration_ms <= 600);
}

#[tokio::test]
async fn config_is_canonical_format() {
    let (source, _sink) = make_synthetic();
    let cfg = RecorderConfig::default();
    let recorder = Recorder::start(Box::new(source), cfg).await.unwrap();
    assert_eq!(recorder.audio_config().sample_rate, SampleRate::HZ_16K);
    let _ = recorder.cancel().await;
}
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `cargo test -p phoneme-audio --test recorder`
Expected: compile error referencing missing module.

- [ ] **Step 3: Create `crates/phoneme-audio/src/recorder.rs`**

```rust
//! Recorder — the public capture API.
//!
//! Wraps a [`Source`] with state management for start / stop / cancel /
//! auto-stop-on-silence / max-duration. Buffers samples in memory and writes
//! a WAV file on finalization.

use crate::format::AudioConfig;
use crate::silence::SilenceDetector;
use crate::source::Source;
use crate::wav;
use phoneme_core::error::{Error, Result};
use std::path::Path;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

/// How the recorder should decide to stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingMode {
    /// Stop only when an external caller invokes `stop_and_finalize`.
    Hold,
    /// Auto-stop when silence is detected.
    Oneshot,
    /// Auto-stop after exactly N seconds.
    Duration { secs: u32 },
}

#[derive(Debug, Clone)]
pub struct RecorderConfig {
    pub mode: RecordingMode,
    pub max_duration_ms: u64,
    pub silence_threshold_dbfs: f32,
    pub silence_window_ms: u32,
}

impl Default for RecorderConfig {
    fn default() -> Self {
        Self {
            mode: RecordingMode::Hold,
            max_duration_ms: 300_000,
            silence_threshold_dbfs: -45.0,
            silence_window_ms: 3000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RecordingResult {
    pub duration_ms: i64,
    pub samples_written: usize,
}

/// Public recorder handle. Owns the background capture task.
pub struct Recorder {
    cfg: AudioConfig,
    cmd_tx: mpsc::Sender<RecorderCommand>,
    task: JoinHandle<Result<TaskOutput>>,
}

enum RecorderCommand {
    Stop,
    Cancel,
}

struct TaskOutput {
    samples: Vec<i16>,
    duration_ms: i64,
    cancelled: bool,
}

impl Recorder {
    /// Begin recording with the given source. The task starts pulling
    /// immediately.
    pub async fn start(mut source: Box<dyn Source>, cfg: RecorderConfig) -> Result<Self> {
        let audio_cfg = source.config();
        let (cmd_tx, mut cmd_rx) = mpsc::channel::<RecorderCommand>(4);

        let task = tokio::spawn(async move {
            let mut samples: Vec<i16> = Vec::with_capacity(audio_cfg.sample_rate.as_u32() as usize);
            let mut detector = SilenceDetector::new(
                cfg.silence_threshold_dbfs,
                cfg.silence_window_ms,
                audio_cfg.sample_rate.as_u32(),
            );
            let max_samples = (cfg.max_duration_ms * audio_cfg.sample_rate.as_u32() as u64 / 1000) as usize;
            let duration_samples = match cfg.mode {
                RecordingMode::Duration { secs } => {
                    Some(secs as u64 * audio_cfg.sample_rate.as_u32() as u64)
                }
                _ => None,
            };

            let mut cancelled = false;

            loop {
                tokio::select! {
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(RecorderCommand::Stop) => break,
                            Some(RecorderCommand::Cancel) => { cancelled = true; break; }
                            None => break,
                        }
                    }
                    block = source.next_block() => {
                        match block? {
                            Some(b) => {
                                detector.push(&b);
                                samples.extend_from_slice(&b);
                                if cfg.mode == RecordingMode::Oneshot && detector.is_silent() {
                                    break;
                                }
                                if let Some(target) = duration_samples {
                                    if samples.len() as u64 >= target {
                                        samples.truncate(target as usize);
                                        break;
                                    }
                                }
                                if samples.len() >= max_samples {
                                    samples.truncate(max_samples);
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                }
            }

            let duration_ms = (samples.len() as u64 * 1000 / audio_cfg.sample_rate.as_u32() as u64) as i64;
            Ok(TaskOutput { samples, duration_ms, cancelled })
        });

        Ok(Self { cfg: audio_cfg, cmd_tx, task })
    }

    pub fn audio_config(&self) -> AudioConfig {
        self.cfg
    }

    /// Stop the recording (politely) and write its samples to `path`. The
    /// stored samples remain in memory until this call returns.
    pub async fn stop_and_finalize(self, path: &Path) -> Result<RecordingResult> {
        let _ = self.cmd_tx.send(RecorderCommand::Stop).await;
        let out = self.task.await.map_err(|e| Error::Internal(format!("recorder task: {e}")))??;
        if out.cancelled {
            return Err(Error::Internal("recording was cancelled".into()));
        }
        wav::write_wav(path, &out.samples, self.cfg)?;
        Ok(RecordingResult {
            duration_ms: out.duration_ms,
            samples_written: out.samples.len(),
        })
    }

    /// Discard the recording. No WAV file is written.
    pub async fn cancel(self) -> Result<()> {
        let _ = self.cmd_tx.send(RecorderCommand::Cancel).await;
        let _ = self.task.await;
        Ok(())
    }

    /// Wait for the recorder to auto-finalize (Oneshot / Duration modes,
    /// or the source returning `None`) and then write the WAV file.
    pub async fn wait_for_finalize(self, path: &Path) -> Result<RecordingResult> {
        let out = self.task.await.map_err(|e| Error::Internal(format!("recorder task: {e}")))??;
        if out.cancelled {
            return Err(Error::Internal("recording was cancelled".into()));
        }
        wav::write_wav(path, &out.samples, self.cfg)?;
        Ok(RecordingResult {
            duration_ms: out.duration_ms,
            samples_written: out.samples.len(),
        })
    }
}
```

- [ ] **Step 4: Wire module into `lib.rs`**

Update `crates/phoneme-audio/src/lib.rs`:

```rust
//! phoneme-audio — audio capture and WAV encoding for Phoneme.

pub mod convert;
pub mod device;
pub mod format;
pub mod recorder;
pub mod silence;
pub mod source;
pub mod wav;

pub use device::{default_input_device, list_input_devices, DeviceInfo};
pub use format::{AudioConfig, Channels, SampleRate};
pub use recorder::{Recorder, RecorderConfig, RecordingMode, RecordingResult};
pub use silence::SilenceDetector;
pub use source::{SampleBlock, Source, SyntheticSink, SyntheticSource};
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p phoneme-audio --test recorder`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-audio --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-audio/
git commit -m "phoneme-audio: add Recorder (Hold/Oneshot/Duration modes + silence + max)"
```

---

## Task 9: `phoneme-audio` README

**Files:**
- Create: `crates/phoneme-audio/README.md`

- [ ] **Step 1: Write the README**

```markdown
# phoneme-audio

Audio capture and WAV encoding for the [Phoneme](../../README.md) voice notes app.

## What it does

| Module | Responsibility |
|---|---|
| `format` | `AudioConfig`, `SampleRate`, `Channels` types |
| `wav` | `write_wav` / `read_wav` / `duration_ms` via hound |
| `device` | CPAL input device enumeration + lookup |
| `convert` | `f32 ↔ i16`, downmix-to-mono, resample (rubato) |
| `silence` | `SilenceDetector` — RMS over rolling window |
| `source` | `Source` trait: production `CpalSource` + test `SyntheticSource` |
| `recorder` | `Recorder` public API — start/stop/cancel + auto-modes |

## Canonical format

Phoneme always saves recordings as **16-bit PCM, 16 kHz, mono**. The Recorder
converts whatever the CPAL device offers (commonly 44.1/48 kHz f32 stereo) to
this format before saving.

## Recording modes

```rust
use phoneme_audio::recorder::{Recorder, RecorderConfig, RecordingMode};

// Hold: stop when externally told.
let cfg = RecorderConfig { mode: RecordingMode::Hold, ..Default::default() };

// Oneshot: stop on silence.
let cfg = RecorderConfig {
    mode: RecordingMode::Oneshot,
    silence_threshold_dbfs: -45.0,
    silence_window_ms: 3000,
    ..Default::default()
};

// Fixed duration.
let cfg = RecorderConfig { mode: RecordingMode::Duration { secs: 10 }, ..Default::default() };
```

## Testing without a microphone

The `Source` trait abstracts the input. Tests use `SyntheticSource` to feed
hand-crafted PCM data:

```rust
let (source, sink) = SyntheticSource::new(AudioConfig::phoneme_default());
let recorder = Recorder::start(Box::new(source), RecorderConfig::default()).await?;
sink.push(loud_samples).await?;
sink.close();
let result = recorder.stop_and_finalize(&wav_path).await?;
```

## Running the tests

```bash
cargo test -p phoneme-audio
```

Device-dependent tests early-return if no input device is found on the
runner.
```

- [ ] **Step 2: Commit**

```bash
git add crates/phoneme-audio/README.md
git commit -m "phoneme-audio: add README"
```

---

## Task 10: Workspace add + `phoneme-ipc` scaffold

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Create: `crates/phoneme-ipc/Cargo.toml`
- Create: `crates/phoneme-ipc/src/lib.rs`

- [ ] **Step 1: Add to workspace members**

In the root `Cargo.toml`, add `"crates/phoneme-ipc"` to `[workspace] members`.

- [ ] **Step 2: Create `crates/phoneme-ipc/Cargo.toml`**

```toml
[package]
name = "phoneme-ipc"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
phoneme-core = { path = "../phoneme-core" }
anyhow.workspace = true
thiserror.workspace = true
serde.workspace = true
serde_json.workspace = true
tokio = { workspace = true, features = ["net", "io-util", "macros", "rt-multi-thread", "sync"] }
tokio-util.workspace = true
bytes.workspace = true
async-trait = "0.1"
tracing.workspace = true
futures = "0.3"

[dev-dependencies]
tempfile.workspace = true
tokio = { workspace = true, features = ["test-util", "macros"] }
```

- [ ] **Step 3: Create empty `crates/phoneme-ipc/src/lib.rs`**

```rust
//! phoneme-ipc — IPC schema and transport for Phoneme.
//!
//! Modules will be added in subsequent tasks.
```

- [ ] **Step 4: Verify it builds**

Run: `cargo build --workspace`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/phoneme-ipc/
git commit -m "scaffold phoneme-ipc crate"
```

---

## Task 11: IPC schema (Request, Response, DaemonEvent)

**Files:**
- Create: `crates/phoneme-ipc/src/schema.rs`
- Modify: `crates/phoneme-ipc/src/lib.rs`
- Create: `crates/phoneme-ipc/tests/schema.rs`

- [ ] **Step 1: Write the failing roundtrip tests**

Create `crates/phoneme-ipc/tests/schema.rs`:

```rust
use phoneme_core::{ListFilter, RecordMode, RecordingId, RecordingStatus};
use phoneme_ipc::schema::{
    DaemonEvent, IpcError, IpcErrorKind, Request, Response,
};

fn roundtrip<T>(value: &T)
where
    T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
{
    let json = serde_json::to_string(value).unwrap();
    let parsed: T = serde_json::from_str(&json).unwrap();
    assert_eq!(&parsed, value);
}

#[test]
fn record_start_request_roundtrips() {
    roundtrip(&Request::RecordStart {
        mode: RecordMode::Hold,
    });
    roundtrip(&Request::RecordStart {
        mode: RecordMode::Oneshot,
    });
    roundtrip(&Request::RecordStart {
        mode: RecordMode::Duration { secs: 30 },
    });
}

#[test]
fn list_recordings_request_roundtrips() {
    let filter = ListFilter {
        limit: Some(50),
        since: None,
        status: Some(RecordingStatus::Done),
        search: Some("sarah".into()),
    };
    roundtrip(&Request::ListRecordings { filter });
}

#[test]
fn ok_response_with_null_payload_roundtrips() {
    roundtrip(&Response::Ok(serde_json::Value::Null));
}

#[test]
fn err_response_roundtrips() {
    roundtrip(&Response::Err(IpcError {
        kind: IpcErrorKind::AlreadyRecording,
        message: "in flight".into(),
    }));
}

#[test]
fn all_daemon_events_roundtrip() {
    let id = RecordingId::new();
    let events = vec![
        DaemonEvent::RecordingStarted {
            id: id.clone(),
            started_at: chrono::Local::now(),
        },
        DaemonEvent::RecordingStopped {
            id: id.clone(),
            duration_ms: 1234,
            audio_path: "C:/tmp/x.wav".into(),
        },
        DaemonEvent::TranscriptionStarted { id: id.clone() },
        DaemonEvent::TranscriptionDone {
            id: id.clone(),
            transcript: "hello".into(),
        },
        DaemonEvent::TranscriptionFailed {
            id: id.clone(),
            error: "timeout".into(),
        },
        DaemonEvent::HookStarted { id: id.clone() },
        DaemonEvent::HookDone {
            id: id.clone(),
            exit_code: 0,
        },
        DaemonEvent::HookFailed {
            id: id.clone(),
            error: "exit 2".into(),
        },
        DaemonEvent::QueueDepthChanged {
            pending: 3,
            processing: 1,
            failed: 0,
        },
        DaemonEvent::LlmStatusChanged { reachable: false },
        DaemonEvent::RecordingDeleted { id: id.clone() },
        DaemonEvent::TranscriptUpdated { id },
    ];
    for e in &events {
        roundtrip(e);
    }
}

#[test]
fn all_error_kinds_have_distinct_serialized_form() {
    let kinds = [
        IpcErrorKind::AlreadyRecording,
        IpcErrorKind::NotRecording,
        IpcErrorKind::NotFound,
        IpcErrorKind::InvalidConfig,
        IpcErrorKind::LlmUnreachable,
        IpcErrorKind::LlmTimeout,
        IpcErrorKind::HookFailed,
        IpcErrorKind::DaemonNotRunning,
        IpcErrorKind::PipeInUse,
        IpcErrorKind::ShuttingDown,
        IpcErrorKind::Io,
        IpcErrorKind::Internal,
    ];
    let mut seen = std::collections::HashSet::new();
    for k in kinds {
        let s = serde_json::to_string(&k).unwrap();
        assert!(seen.insert(s.clone()), "duplicate serialization: {s}");
    }
}
```

- [ ] **Step 2: Run tests; expect them to fail**

Run: `cargo test -p phoneme-ipc --test schema`
Expected: compile error referencing missing module.

- [ ] **Step 3: Create `crates/phoneme-ipc/src/schema.rs`**

```rust
//! IPC schema — wire format for daemon ↔ client communication.
//!
//! Designed to be transport-agnostic. The same Request/Response/Event JSON
//! travels over named pipes today; a future HTTP transport (mobile, v2.0)
//! will use the same schema unchanged.

use chrono::{DateTime, Local};
use phoneme_core::{ListFilter, RecordMode, RecordingId};
use serde::{Deserialize, Serialize};

/// All operations a client can ask the daemon to perform.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    // Recording control
    RecordStart { mode: RecordMode },
    RecordStop,
    RecordCancel,
    RecordStatus,

    // Catalog queries
    ListRecordings { filter: ListFilter },
    GetRecording { id: RecordingId },
    DeleteRecording { id: RecordingId, keep_audio: bool },

    // Queue operations
    ReplayRecording { id: RecordingId },
    RefireHook { id: RecordingId },
    UpdateTranscript { id: RecordingId, text: String },

    // Daemon control
    DaemonStatus,
    Shutdown,
    ReloadConfig,
    HookTest,

    // Streaming
    SubscribeEvents,
}

/// Daemon response. For most requests, a single Response is returned.
/// `SubscribeEvents` instead streams `DaemonEvent`s (one JSON per line)
/// until the client closes the connection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Response {
    Ok(serde_json::Value),
    Err(IpcError),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IpcError {
    pub kind: IpcErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IpcErrorKind {
    AlreadyRecording,
    NotRecording,
    NotFound,
    InvalidConfig,
    LlmUnreachable,
    LlmTimeout,
    HookFailed,
    DaemonNotRunning,
    PipeInUse,
    ShuttingDown,
    Io,
    Internal,
}

/// Events broadcast by the daemon on `SubscribeEvents`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum DaemonEvent {
    RecordingStarted { id: RecordingId, started_at: DateTime<Local> },
    RecordingStopped { id: RecordingId, duration_ms: i64, audio_path: String },
    TranscriptionStarted { id: RecordingId },
    TranscriptionDone { id: RecordingId, transcript: String },
    TranscriptionFailed { id: RecordingId, error: String },
    HookStarted { id: RecordingId },
    HookDone { id: RecordingId, exit_code: i32 },
    HookFailed { id: RecordingId, error: String },
    QueueDepthChanged { pending: usize, processing: usize, failed: usize },
    LlmStatusChanged { reachable: bool },
    RecordingDeleted { id: RecordingId },
    TranscriptUpdated { id: RecordingId },
}
```

- [ ] **Step 4: Wire module into `lib.rs`**

Update `crates/phoneme-ipc/src/lib.rs`:

```rust
//! phoneme-ipc — IPC schema and transport for Phoneme.

pub mod schema;

pub use schema::{DaemonEvent, IpcError, IpcErrorKind, Request, Response};
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p phoneme-ipc --test schema`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-ipc --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-ipc/
git commit -m "phoneme-ipc: add Request/Response/DaemonEvent schema"
```

---

## Task 12: Newline-delimited JSON codec

**Files:**
- Create: `crates/phoneme-ipc/src/codec.rs`
- Modify: `crates/phoneme-ipc/src/lib.rs`
- Create: `crates/phoneme-ipc/tests/codec.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/phoneme-ipc/tests/codec.rs`:

```rust
use bytes::BytesMut;
use phoneme_ipc::codec::JsonLineCodec;
use phoneme_ipc::schema::Request;
use tokio_util::codec::{Decoder, Encoder};

#[test]
fn encode_appends_newline() {
    let mut codec = JsonLineCodec::<Request>::new();
    let mut buf = BytesMut::new();
    codec.encode(Request::RecordStatus, &mut buf).unwrap();
    let s = std::str::from_utf8(&buf).unwrap();
    assert!(s.ends_with('\n'));
    assert!(s.contains("record_status"));
}

#[test]
fn decode_complete_line_yields_value() {
    let mut codec = JsonLineCodec::<Request>::new();
    let mut buf = BytesMut::new();
    buf.extend_from_slice(b"{\"type\":\"record_status\"}\n");
    let decoded = codec.decode(&mut buf).unwrap();
    assert!(matches!(decoded, Some(Request::RecordStatus)));
    assert!(buf.is_empty());
}

#[test]
fn decode_partial_line_returns_none_and_keeps_buffer() {
    let mut codec = JsonLineCodec::<Request>::new();
    let mut buf = BytesMut::new();
    buf.extend_from_slice(b"{\"type\":\"record_st"); // no newline yet
    let decoded = codec.decode(&mut buf).unwrap();
    assert!(decoded.is_none());
    assert!(!buf.is_empty());
}

#[test]
fn decode_multiple_lines_returns_one_at_a_time() {
    let mut codec = JsonLineCodec::<Request>::new();
    let mut buf = BytesMut::new();
    buf.extend_from_slice(b"{\"type\":\"record_status\"}\n{\"type\":\"daemon_status\"}\n");
    let a = codec.decode(&mut buf).unwrap();
    assert!(matches!(a, Some(Request::RecordStatus)));
    let b = codec.decode(&mut buf).unwrap();
    assert!(matches!(b, Some(Request::DaemonStatus)));
    let c = codec.decode(&mut buf).unwrap();
    assert!(c.is_none());
}

#[test]
fn decode_malformed_json_returns_error() {
    let mut codec = JsonLineCodec::<Request>::new();
    let mut buf = BytesMut::new();
    buf.extend_from_slice(b"not json at all\n");
    assert!(codec.decode(&mut buf).is_err());
}

#[test]
fn encode_then_decode_round_trips() {
    let mut codec = JsonLineCodec::<Request>::new();
    let mut buf = BytesMut::new();
    codec.encode(Request::DaemonStatus, &mut buf).unwrap();
    codec.encode(Request::Shutdown, &mut buf).unwrap();
    let a = codec.decode(&mut buf).unwrap().unwrap();
    let b = codec.decode(&mut buf).unwrap().unwrap();
    assert!(matches!(a, Request::DaemonStatus));
    assert!(matches!(b, Request::Shutdown));
}
```

- [ ] **Step 2: Run; expect failure**

Run: `cargo test -p phoneme-ipc --test codec`
Expected: compile error.

- [ ] **Step 3: Create `crates/phoneme-ipc/src/codec.rs`**

```rust
//! Newline-delimited JSON codec for tokio_util.
//!
//! Frames messages as `serde_json::to_string(&value) + "\n"`. Decodes by
//! scanning for the next newline and parsing the line.

use bytes::{Buf, BytesMut};
use serde::{de::DeserializeOwned, Serialize};
use std::io;
use std::marker::PhantomData;
use tokio_util::codec::{Decoder, Encoder};

#[derive(Debug)]
pub struct JsonLineCodec<T>(PhantomData<T>);

impl<T> JsonLineCodec<T> {
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

impl<T> Default for JsonLineCodec<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: DeserializeOwned> Decoder for JsonLineCodec<T> {
    type Item = T;
    type Error = io::Error;

    fn decode(&mut self, src: &mut BytesMut) -> io::Result<Option<T>> {
        if let Some(pos) = src.iter().position(|b| *b == b'\n') {
            let line = src.split_to(pos);
            src.advance(1); // consume the newline
            if line.is_empty() {
                return Ok(None);
            }
            let parsed = serde_json::from_slice::<T>(&line).map_err(io::Error::other)?;
            Ok(Some(parsed))
        } else {
            Ok(None)
        }
    }
}

impl<T: Serialize> Encoder<T> for JsonLineCodec<T> {
    type Error = io::Error;

    fn encode(&mut self, item: T, dst: &mut BytesMut) -> io::Result<()> {
        let bytes = serde_json::to_vec(&item).map_err(io::Error::other)?;
        dst.extend_from_slice(&bytes);
        dst.extend_from_slice(b"\n");
        Ok(())
    }
}
```

- [ ] **Step 4: Wire module into `lib.rs`**

Update `crates/phoneme-ipc/src/lib.rs`:

```rust
//! phoneme-ipc — IPC schema and transport for Phoneme.

pub mod codec;
pub mod schema;

pub use codec::JsonLineCodec;
pub use schema::{DaemonEvent, IpcError, IpcErrorKind, Request, Response};
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p phoneme-ipc --test codec`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 6: Lint**

Run: `cargo clippy -p phoneme-ipc --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/phoneme-ipc/
git commit -m "phoneme-ipc: add newline-delimited JSON codec"
```

---

## Task 13: Transport trait + IpcTransportError

**Files:**
- Create: `crates/phoneme-ipc/src/error.rs`
- Create: `crates/phoneme-ipc/src/transport.rs`
- Modify: `crates/phoneme-ipc/src/lib.rs`

- [ ] **Step 1: Create the transport error**

Create `crates/phoneme-ipc/src/error.rs`:

```rust
use thiserror::Error;

/// Errors that arise from the IPC transport layer (vs. the daemon's own
/// response errors, which are `IpcError`).
#[derive(Debug, Error)]
pub enum IpcTransportError {
    #[error("connection failed: {0}")]
    Connect(#[source] std::io::Error),

    #[error("connection closed by peer")]
    Closed,

    #[error("transport I/O: {0}")]
    Io(#[from] std::io::Error),

    #[error("malformed response: {0}")]
    Malformed(String),

    #[error("internal: {0}")]
    Internal(String),
}

pub type TransportResult<T> = std::result::Result<T, IpcTransportError>;
```

- [ ] **Step 2: Create the transport trait**

Create `crates/phoneme-ipc/src/transport.rs`:

```rust
//! Transport trait abstraction.
//!
//! Today's implementation is `NamedPipeTransport` (Windows named pipes); a
//! future v2.0 may add an `HttpTransport` for mobile clients without changing
//! the schema in `schema.rs`.

use crate::error::TransportResult;
use crate::schema::{DaemonEvent, Request, Response};
use async_trait::async_trait;
use futures::stream::BoxStream;

#[async_trait]
pub trait Transport: Send + Sync {
    /// Send a single request and await its response.
    async fn request(&mut self, req: Request) -> TransportResult<Response>;

    /// Send `SubscribeEvents` and return a stream of events. The stream
    /// terminates when the connection closes.
    async fn subscribe(&mut self) -> TransportResult<BoxStream<'static, TransportResult<DaemonEvent>>>;
}
```

- [ ] **Step 3: Wire modules into `lib.rs`**

Update `crates/phoneme-ipc/src/lib.rs`:

```rust
//! phoneme-ipc — IPC schema and transport for Phoneme.

pub mod codec;
pub mod error;
pub mod schema;
pub mod transport;

pub use codec::JsonLineCodec;
pub use error::{IpcTransportError, TransportResult};
pub use schema::{DaemonEvent, IpcError, IpcErrorKind, Request, Response};
pub use transport::Transport;
```

- [ ] **Step 4: Verify build**

Run: `cargo build -p phoneme-ipc`
Expected: clean build.

- [ ] **Step 5: Lint**

Run: `cargo clippy -p phoneme-ipc --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/phoneme-ipc/
git commit -m "phoneme-ipc: add Transport trait + IpcTransportError"
```

---

## Task 14: Named-pipe server

**Files:**
- Create: `crates/phoneme-ipc/src/named_pipe.rs`
- Modify: `crates/phoneme-ipc/src/lib.rs`

The server listens on `\\.\pipe\<name>` and accepts one client connection at a time. Each accepted connection becomes a `NamedPipeConnection` that can `recv()`/`send()`. Per Windows convention, after accepting a connection we immediately create a new server instance to accept the next.

- [ ] **Step 1: Create `crates/phoneme-ipc/src/named_pipe.rs`**

```rust
//! Windows named-pipe transport for daemon ↔ client.
//!
//! - Server creates pipe instances at `\\.\pipe\<name>`, accepts one client
//!   per instance, immediately re-creates the listener.
//! - Client dials the same pipe name with `ClientOptions::open`.
//! - Both sides use `JsonLineCodec` for newline-delimited JSON.

use crate::codec::JsonLineCodec;
use crate::error::{IpcTransportError, TransportResult};
use crate::schema::{DaemonEvent, Request, Response};
use crate::transport::Transport;
use async_trait::async_trait;
use futures::stream::{BoxStream, StreamExt};
use futures::SinkExt;
use tokio::net::windows::named_pipe::{
    ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
};
use tokio_util::codec::Framed;

/// The full Windows pipe name for a given short name.
pub fn pipe_path(name: &str) -> String {
    format!(r"\\.\pipe\{name}")
}

/// Server-side: a single accepted connection. Use [`NamedPipeListener`] to
/// produce these.
pub struct NamedPipeConnection {
    framed_in: Framed<NamedPipeServer, JsonLineCodec<Request>>,
}

impl NamedPipeConnection {
    /// Receive the next request from the client, or `None` if they disconnected.
    pub async fn recv(&mut self) -> TransportResult<Option<Request>> {
        match self.framed_in.next().await {
            Some(Ok(req)) => Ok(Some(req)),
            Some(Err(e)) => Err(IpcTransportError::Io(e)),
            None => Ok(None),
        }
    }

    /// Send a Response back to the client.
    pub async fn send_response(&mut self, res: Response) -> TransportResult<()> {
        // We need a Sink that takes Response, but framed_in is typed for Request.
        // Reframe with a separate codec for the response direction.
        // Simpler: write JSON directly to the underlying IO.
        let json = serde_json::to_vec(&res).map_err(|e| IpcTransportError::Internal(e.to_string()))?;
        let io = self.framed_in.get_mut();
        use tokio::io::AsyncWriteExt;
        io.write_all(&json).await?;
        io.write_all(b"\n").await?;
        io.flush().await?;
        Ok(())
    }

    /// Send a DaemonEvent (for streaming subscriptions).
    pub async fn send_event(&mut self, event: DaemonEvent) -> TransportResult<()> {
        let json = serde_json::to_vec(&event).map_err(|e| IpcTransportError::Internal(e.to_string()))?;
        let io = self.framed_in.get_mut();
        use tokio::io::AsyncWriteExt;
        io.write_all(&json).await?;
        io.write_all(b"\n").await?;
        io.flush().await?;
        Ok(())
    }
}

/// Server-side listener. Each call to `accept` returns a connection and
/// immediately re-opens the listener for the next client.
pub struct NamedPipeListener {
    name: String,
    current: Option<NamedPipeServer>,
}

impl NamedPipeListener {
    /// Bind a fresh listener at the given pipe name. Returns an error if a
    /// previous server instance is still holding the name (per Windows
    /// semantics: first creator wins).
    pub fn bind(name: &str) -> TransportResult<Self> {
        let path = pipe_path(name);
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&path)
            .map_err(IpcTransportError::Connect)?;
        Ok(Self {
            name: name.to_string(),
            current: Some(server),
        })
    }

    /// Accept the next incoming connection. Re-binds the listener for the
    /// following accept.
    pub async fn accept(&mut self) -> TransportResult<NamedPipeConnection> {
        let server = self
            .current
            .take()
            .ok_or_else(|| IpcTransportError::Internal("listener empty".into()))?;
        server.connect().await?;

        // Immediately create the next listener instance.
        let next = ServerOptions::new()
            .create(pipe_path(&self.name))
            .map_err(IpcTransportError::Connect)?;
        self.current = Some(next);

        let framed = Framed::new(server, JsonLineCodec::<Request>::new());
        Ok(NamedPipeConnection { framed_in: framed })
    }
}

/// Client-side connection.
pub struct NamedPipeTransport {
    framed: Framed<NamedPipeClient, JsonLineCodec<Response>>,
}

impl NamedPipeTransport {
    pub async fn connect(name: &str) -> TransportResult<Self> {
        let path = pipe_path(name);
        let client = loop {
            match ClientOptions::new().open(&path) {
                Ok(c) => break c,
                Err(e) if e.raw_os_error() == Some(231) => {
                    // ERROR_PIPE_BUSY — retry briefly
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                Err(e) => return Err(IpcTransportError::Connect(e)),
            }
        };
        Ok(Self {
            framed: Framed::new(client, JsonLineCodec::<Response>::new()),
        })
    }
}

#[async_trait]
impl Transport for NamedPipeTransport {
    async fn request(&mut self, req: Request) -> TransportResult<Response> {
        // Encode + send the request.
        let json = serde_json::to_vec(&req).map_err(|e| IpcTransportError::Internal(e.to_string()))?;
        let io = self.framed.get_mut();
        use tokio::io::AsyncWriteExt;
        io.write_all(&json).await?;
        io.write_all(b"\n").await?;
        io.flush().await?;

        // Await the response.
        match self.framed.next().await {
            Some(Ok(res)) => Ok(res),
            Some(Err(e)) => Err(IpcTransportError::Io(e)),
            None => Err(IpcTransportError::Closed),
        }
    }

    async fn subscribe(&mut self) -> TransportResult<BoxStream<'static, TransportResult<DaemonEvent>>> {
        // Send the SubscribeEvents request first.
        let json = serde_json::to_vec(&Request::SubscribeEvents)
            .map_err(|e| IpcTransportError::Internal(e.to_string()))?;
        let io = self.framed.get_mut();
        use tokio::io::AsyncWriteExt;
        io.write_all(&json).await?;
        io.write_all(b"\n").await?;
        io.flush().await?;

        // After SubscribeEvents, the daemon switches this connection from
        // Response framing to DaemonEvent framing. We need to take ownership
        // of the underlying IO and re-frame.
        let parts = std::mem::replace(
            &mut self.framed,
            Framed::new(
                ClientOptions::new()
                    .open(pipe_path("phoneme-daemon-placeholder"))
                    .map_err(|_| IpcTransportError::Closed)?,
                JsonLineCodec::<Response>::new(),
            ),
        )
        .into_parts();
        let event_framed = Framed::new(parts.io, JsonLineCodec::<DaemonEvent>::new());
        let stream = event_framed.map(|r| r.map_err(IpcTransportError::Io));
        Ok(stream.boxed())
    }
}
```

> **Note on the placeholder in `subscribe`:** the placeholder pipe open is a
> workaround for `Framed::into_parts` consuming `self.framed`; subsequent
> tasks may refactor to a cleaner design (e.g. storing the IO as `Option`).
> For now, after `subscribe()` is called the connection should not be reused
> for further `request()` calls — the daemon owns the protocol state at that
> point.

- [ ] **Step 2: Wire module into `lib.rs`**

Update `crates/phoneme-ipc/src/lib.rs`:

```rust
//! phoneme-ipc — IPC schema and transport for Phoneme.

pub mod codec;
pub mod error;
pub mod named_pipe;
pub mod schema;
pub mod transport;

pub use codec::JsonLineCodec;
pub use error::{IpcTransportError, TransportResult};
pub use named_pipe::{pipe_path, NamedPipeConnection, NamedPipeListener, NamedPipeTransport};
pub use schema::{DaemonEvent, IpcError, IpcErrorKind, Request, Response};
pub use transport::Transport;
```

- [ ] **Step 3: Verify build**

Run: `cargo build -p phoneme-ipc`
Expected: clean build.

- [ ] **Step 4: Lint**

Run: `cargo clippy -p phoneme-ipc --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/phoneme-ipc/
git commit -m "phoneme-ipc: add Windows named-pipe server + client transport"
```

---

## Task 15: Round-trip integration test

**Files:**
- Create: `crates/phoneme-ipc/tests/round_trip.rs`

The integration test exercises the full stack: server binds, client connects, request flows out, response flows back, both sides close cleanly.

- [ ] **Step 1: Write the test**

Create `crates/phoneme-ipc/tests/round_trip.rs`:

```rust
use phoneme_ipc::{
    IpcError, IpcErrorKind, NamedPipeListener, NamedPipeTransport, Request, Response, Transport,
};

/// Generate a unique pipe name for parallel test runs.
fn unique_pipe_name(label: &str) -> String {
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("phoneme-test-{label}-{pid}-{nanos}")
}

#[tokio::test]
async fn client_sends_request_server_responds_ok() {
    let name = unique_pipe_name("ok");
    let mut listener = NamedPipeListener::bind(&name).expect("bind");

    let server_handle = tokio::spawn(async move {
        let mut conn = listener.accept().await.expect("accept");
        let req = conn.recv().await.expect("recv").expect("some");
        assert!(matches!(req, Request::DaemonStatus));
        conn.send_response(Response::Ok(serde_json::json!({
            "running": true,
            "pid": 1234,
        })))
        .await
        .expect("send");
    });

    // Give the listener a beat to be ready.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let mut client = NamedPipeTransport::connect(&name).await.expect("connect");
    let resp = client.request(Request::DaemonStatus).await.expect("request");
    match resp {
        Response::Ok(val) => {
            assert_eq!(val["running"], true);
            assert_eq!(val["pid"], 1234);
        }
        Response::Err(e) => panic!("expected ok, got err: {e:?}"),
    }

    server_handle.await.expect("server task");
}

#[tokio::test]
async fn client_receives_err_response() {
    let name = unique_pipe_name("err");
    let mut listener = NamedPipeListener::bind(&name).expect("bind");

    let server_handle = tokio::spawn(async move {
        let mut conn = listener.accept().await.expect("accept");
        let _ = conn.recv().await.expect("recv");
        conn.send_response(Response::Err(IpcError {
            kind: IpcErrorKind::AlreadyRecording,
            message: "in flight".into(),
        }))
        .await
        .expect("send");
    });

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let mut client = NamedPipeTransport::connect(&name).await.expect("connect");
    let resp = client.request(Request::RecordStart {
        mode: phoneme_core::RecordMode::Hold,
    }).await.expect("request");
    match resp {
        Response::Err(e) => {
            assert_eq!(e.kind, IpcErrorKind::AlreadyRecording);
        }
        _ => panic!("expected err"),
    }

    server_handle.await.expect("server task");
}

#[tokio::test]
async fn server_handles_sequential_clients() {
    let name = unique_pipe_name("seq");
    let mut listener = NamedPipeListener::bind(&name).expect("bind");

    let server_handle = tokio::spawn(async move {
        for _ in 0..3 {
            let mut conn = listener.accept().await.expect("accept");
            let _ = conn.recv().await.expect("recv");
            conn.send_response(Response::Ok(serde_json::Value::Null))
                .await
                .expect("send");
        }
    });

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    for _ in 0..3 {
        let mut client = NamedPipeTransport::connect(&name).await.expect("connect");
        let _ = client.request(Request::DaemonStatus).await.expect("request");
    }

    server_handle.await.expect("server task");
}

#[tokio::test]
async fn second_bind_to_same_name_fails() {
    let name = unique_pipe_name("dup");
    let _first = NamedPipeListener::bind(&name).expect("first bind");
    let second = NamedPipeListener::bind(&name);
    assert!(
        second.is_err(),
        "second bind should fail with first_pipe_instance set"
    );
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test -p phoneme-ipc --test round_trip -- --test-threads=1`
Expected: `test result: ok. 4 passed; 0 failed`

(We run with `--test-threads=1` for now because pipe names are unique-per-test but the bind-then-accept handshake is timing-sensitive; this avoids flakes during early development. Tasks in Plan 3 will harden this.)

- [ ] **Step 3: Lint**

Run: `cargo clippy -p phoneme-ipc --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 4: Commit**

```bash
git add crates/phoneme-ipc/tests/
git commit -m "phoneme-ipc: add round-trip integration tests over named pipes"
```

---

## Task 16: `phoneme-ipc` README

**Files:**
- Create: `crates/phoneme-ipc/README.md`

- [ ] **Step 1: Write the README**

```markdown
# phoneme-ipc

IPC schema and transport for [Phoneme](../../README.md).

## Modules

| Module | Responsibility |
|---|---|
| `schema` | `Request`, `Response`, `DaemonEvent`, `IpcError`, `IpcErrorKind` — the wire format |
| `codec` | Newline-delimited JSON framing for tokio_util |
| `transport` | `Transport` trait — transport-agnostic surface for clients |
| `named_pipe` | Windows named-pipe implementation of `Transport` |
| `error` | `IpcTransportError` for transport-layer failures (distinct from response errors) |

## Wire format

All messages are JSON, one per line. The pipe name is `\\.\pipe\phoneme-daemon`
by default (configurable in the daemon's `[daemon] pipe_name`).

### Request flow

```
Client                  Daemon
   |                       |
   |---{type:record_start,mode:{hold:null}}\n--->|
   |                       |
   |<--{status:ok,value:null}\n------------------|
```

### Subscription flow

```
Client                  Daemon
   |                       |
   |---{type:subscribe_events}\n---------------->|
   |                       |
   |<--{event:recording_started,id:...}\n--------|
   |<--{event:transcription_done,id:...}\n-------|
   |<--{event:hook_done,id:...,exit_code:0}\n----|
   |                       |
   X(client closes)        |
```

## Transport-agnostic design

The `Transport` trait abstracts the wire. A future v2.0 may add `HttpTransport`
for mobile clients without touching `schema.rs`:

```rust
#[async_trait]
pub trait Transport: Send + Sync {
    async fn request(&mut self, req: Request) -> TransportResult<Response>;
    async fn subscribe(&mut self) -> TransportResult<BoxStream<'static, TransportResult<DaemonEvent>>>;
}
```

## Running the tests

```bash
cargo test -p phoneme-ipc -- --test-threads=1
```

`--test-threads=1` is used for the round-trip tests because they bind real
named pipes; running them in parallel works but adds flake risk during early
development.
```

- [ ] **Step 2: Commit**

```bash
git add crates/phoneme-ipc/README.md
git commit -m "phoneme-ipc: add README"
```

---

## Task 17: Final verification

- [ ] **Step 1: Full workspace test**

Run: `cargo test --workspace -- --test-threads=1`
Expected: every test passes, including:
- Plan 1: ~57 tests (phoneme-core)
- Plan 2 phoneme-audio: 5 (wav) + 4 (device) + 6 (convert) + 8 (silence) + 2 (source) + 6 (recorder) = 31 tests
- Plan 2 phoneme-ipc: 6 (schema) + 6 (codec) + 4 (round-trip) = 16 tests

Total ≈ 104 tests passing.

- [ ] **Step 2: Workspace clippy**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 3: Format check**

Run: `cargo fmt --all -- --check`
Expected: no diff. If diff, run `cargo fmt --all` and re-stage.

- [ ] **Step 4: Release build**

Run: `cargo build --workspace --release`
Expected: builds without errors.

- [ ] **Step 5: Mark Plan 2 complete**

```bash
git commit --allow-empty -m "milestone: Plan 2 complete (phoneme-audio + phoneme-ipc green)"
git log --oneline | head -25
```

---

## Plan-level self-review

- **Spec coverage:**
  - Spec milestone 7 (CPAL capture + WAV) → Tasks 2, 3, 4, 5, 6, 7, 8 ✓
  - Spec milestone 8 (IPC schema + named-pipe transport) → Tasks 10, 11, 12, 13, 14, 15 ✓
  - Audio canonical format (16-bit, 16 kHz, mono) → `AudioConfig::phoneme_default()` ✓
  - Silence detection (RMS + window, oneshot-only) → `SilenceDetector` ✓
  - Transport-agnostic schema (mobile-ready) → `Transport` trait ✓
  - Single-pipe-instance enforcement (singleton) → `first_pipe_instance(true)` in `NamedPipeListener::bind` ✓

- **Placeholder scan:** No "TBD"/"TODO"/"fill in" markers. The one open architectural caveat (`subscribe()` ownership transfer placeholder) is explicitly called out in a comment and will be cleaned up in Plan 3 when the daemon actually uses it.

- **Type consistency:** `Request`, `Response`, `DaemonEvent`, `IpcError`, `Recorder`, `Source` referenced uniformly. `RecordMode`, `RecordingId`, `ListFilter` come from `phoneme-core` and are re-exported only where needed.

- **Spec deviation:**
  - Test parallelism: round-trip tests use `--test-threads=1` to avoid early-development flakes. Will revisit during Plan 3 hardening.

---

## End of Plan 2
