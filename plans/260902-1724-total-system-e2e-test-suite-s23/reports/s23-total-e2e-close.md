# S23 total E2E close receipt

Date: 2026-09-02

| Run | Result |
| --- | --- |
| `run-total-tests.ps1 -SkipLive` | 6 PASS, 3 SKIP, 0 FAIL; exit 0 |
| `run-total-tests.ps1` | 6 PASS, 3 SKIP, 0 FAIL; container port 3737 is not host-published |
| Marker-removal negative proof | 5 PASS, 3 SKIP, 1 FAIL; exit 1 |

Final receipt: `plans/reports/total-e2e-test-2026-09-02T175605.json`.

The live overlay requires a non-empty Docker `HostPort` mapping so an unrelated
listener on port 3737 cannot be mistaken for the production container.
