# Backup/restore cadence (S17)

- Cycle: nightly + before/after any flip; retention 7 days.
  Location: `%LOCALAPPDATA%\NEWSOS\phase12-backups-<YYYYMMDD>\`, outside git.
- Verify every cycle: copy to the target, then run, FROM THE MANIFEST'S OWN ROOT
  (manifest paths are prefixed `agents-backup/...`):
  `sha256sum -c backup-manifest.sha256`  -> expect all OK.
- Restore drill: copy a cycle back to the store root, hash-verify, run the
  canonical chat GET round-trip. Last drill: 9/9 OK (2026-09-01).
- Manifest holds hashes only; transcript bytes never enter the repo.
