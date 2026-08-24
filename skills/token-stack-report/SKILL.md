---
name: token-stack:report
description: Report observed token savings from RTK, Headroom, and Claude usage counters. Use for savings, compression, token reduction, or token-stack measurement.
user-invocable: true
---

# Token Stack Report

Run the read-only report:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.claude/skills/token-stack-report/scripts/token-stack-report.ps1"
```

Use `-Json` for automation and `-ProfileDirectory` for another profile. Report separate evidence:

- RTK: local command-output savings when `rtk gain` exposes counters.
- Headroom: safe `/stats` counters when proxy exposes them.
- Claude usage: observed input/output/cache/request totals from the sanitized usage counter.
- Ponytail/Caveman: observed usage only; no savings claim without matched A/B baseline.

Never add layer counters into one provider-savings number. Missing counters show `UNKNOWN`, not zero. Never output secrets, upstream URLs, prompts, transcripts, or raw logs.

