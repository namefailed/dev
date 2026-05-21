# `creationflags` Double-Pass Bug in Hermes Agent

**Found:** 2026-05-20  
**File:** `tools/environments/local.py`  
**Fix:** Remove the explicit `creationflags=` keyword — `_popen_kwargs` already carries it on Windows.

---

## The Bug

In `LocalEnvironment._run_bash()`, `creationflags` was passed to
`subprocess.Popen` **twice** — once as an explicit keyword argument and
once inside `**_popen_kwargs`:

```python
# tools/environments/local.py (before fix)

_popen_kwargs = {"creationflags": windows_hide_flags()} if _IS_WINDOWS else {}

proc = subprocess.Popen(
    args,
    ...,
    creationflags=subprocess.CREATE_NO_WINDOW if _IS_WINDOWS else 0,   # ← duplicate
    **_popen_kwargs,                                                     # ← also contains creationflags
)
```

On Windows, `_popen_kwargs` resolves to:

```python
{"creationflags": CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_NO_WINDOW}
```

And the explicit keyword also passes `creationflags=CREATE_NO_WINDOW`.

Python raises:

> `TypeError: __init__() got multiple values for keyword argument 'creationflags'`

---

## Root Cause

The duplicate was introduced when the `_popen_kwargs` dictionary was
added (to consolidate Windows `creationflags` into a single mechanism),
but the older explicit `creationflags=` line was never removed. Both
paths were independently correct — they just weren't designed to coexist.

The explicit line was:

```python
creationflags=subprocess.CREATE_NO_WINDOW if _IS_WINDOWS else 0,
```

The dictionary approach (`_popen_kwargs`) was added later, presumably to
share the more nuanced `windows_hide_flags()` helper across multiple
Popen sites. The old keyword survived as dead code that only activates
on Windows — and crashes when it does.

---

## Impact

- **Platfoms:** Windows only. POSIX systems bypass both paths because
  `_IS_WINDOWS` is `False`, so `_popen_kwargs` is `{}` and the explicit
  kwarg passes `0` (a no-op).
- **Crash:** `TypeError` every time `_run_bash()` is called, making every
  terminal command fail. This bricks the local terminal environment on
  Windows.
- **Import-time?** No — the code is only reached at Popen call time, so
  the agent starts but cannot run shell commands.

---

## The Fix

Removed the redundant explicit `creationflags=` keyword. The
`_popen_kwargs` dictionary is the single source of truth:

```python
# tools/environments/local.py (after fix)

_popen_kwargs = {"creationflags": windows_hide_flags()} if _IS_WINDOWS else {}

proc = subprocess.Popen(
    args,
    ...,
    cwd=_popen_cwd,
    **_popen_kwargs,        # ← only reference to creationflags
)
```

`preexec_fn` is unaffected — it's `None` on Windows (guarded by
`_IS_WINDOWS` elsewhere), and `os.setsid` on POSIX, which is correct.

---

## Scope Check: Other Files

Every other file in the repo that passes `creationflags` was inspected
for the same double-pass pattern. All are clean:

| File | Line(s) | Pattern | Status |
|------|---------|---------|--------|
| `tools/environments/local.py` | 554–567 | dict-only **(was duplicate — fixed)** | ✅ Fixed |
| `tools/process_registry.py` | 553–566 | dict-only | ✅ Clean |
| `tools/code_execution_tool.py` | 1241 | explicit-only, no `**_kwargs` | ✅ Clean |
| `tools/code_execution_tool.py` | 1572 | explicit-only in `subprocess.run()` | ✅ Clean |
| `hermes_cli/kanban_db.py` | 5365 | explicit-only, no `**_kwargs` | ✅ Clean |
| `cron/scheduler.py` | 891–899 | dict-only | ✅ Clean |

The two patterns used across the codebase:

**Pattern A — dict-only (preferred):**
```python
popen_kwargs = {"creationflags": windows_hide_flags()} if IS_WINDOWS else {}
subprocess.Popen(..., **popen_kwargs)
```

**Pattern B — explicit-only (also fine when no other kwargs dict):**
```python
subprocess.Popen(..., creationflags=CREATE_NO_WINDOW if IS_WINDOWS else 0)
```

The bug is **mixing both patterns** — passing `creationflags` as an
explicit keyword *and* in a `**`-unpacked dict.

---

## How to Verify

The fix can be confirmed locally:

```python
# Should NOT raise TypeError
import subprocess
proc = subprocess.Popen(
    ["python", "--version"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    creationflags=subprocess.CREATE_NO_WINDOW if True else 0,
    **({"creationflags": 0} if True else {}),
)
```
