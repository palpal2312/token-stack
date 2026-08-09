# Navigation Latency Report (Session 112)

## Page Performance Breakdown

| Page | Backend API Latency (ms) | Frontend Render Cost/Delay (ms) | Perceived Transition Speed |
| :--- | :--- | :--- | :--- |
| `/agents` | ~38ms | - | Fast |
| `/overview/fleet-board` | ~42ms | - | Fast |
| `/sen/metrics` | ~77ms | - | Noticeable |
| `/builders` | ~9ms | Background model hydration (`hydrateSequentially` running post-load, fetching missing models per profile). Probe latency affects health state update. | Instant (Interactive State) / Noticeable (Probes) |
| `/routers` | ~9ms (warmed API), ~246ms - 286ms (unwarmed Interactive State network latency) | 300ms explicit delay (`sleep 0.3` / `setTimeout`) before initiating background health probes on billing routers, which can take ~2.8s total to resolve. | Noticeable (Data load) / Slow (Probes) |
| `/vitals` | ~2.0s - 6.8s (First load/cache miss) | 5s server-side cache TTL (`CACHE_TTL_MS`), coalesced in-flight requests, 10s client polling (`usePollWhileVisible`). Processes span up to 8000ms timeouts (`hermes status`). | Slow |

## Comparison: `/builders` & `/routers` vs. Other Pages

### `/builders`
- **Backend**: Extremely fast API response (~9ms).
- **Frontend**: Defers expensive operations to background hydration. Models are fetched sequentially (`hydrateSequentially`) per profile using a local ref `fetchingModels` to avoid `useEffect` cleanup loops. Probes (`probe(b, signal)`) run independently.
- **Verdict**: Perceived as **Instant** for initial load, though background operations continue.

### `/routers`
- **Backend**: API response itself is relatively fast (~9ms), but actual network transition latency is higher (~286ms Interactive State).
- **Frontend**: Contains an explicit 300ms delay (`setTimeout` / `sleep 0.3` equivalent in bash test) before initiating background health probes on billing routers (`probeAllBilling()`). These probes run asynchronously via `setInterval` every 5 minutes and post-load, but the overall time until all background probes finish can be significant (~2.8s).
- **Verdict**: Perceived as **Noticeable** initially, trailing to **Slow** until probes complete.

### Other Pages
- Pages like `/agents` and `/overview/fleet-board` show fast backend responses (~38-42ms).
- `/sen/metrics` is slightly slower (~77ms) due to ledger processing (`RunLedger`) and metric computation, plus `shadowCompare` overhead.
- `/vitals` is uniquely constrained by heavy CLI subprocess spawning (`claude`, `openclaw`, `hermes`, `antigravity`) taking up to 6.8s on cache miss, heavily mitigated by a 5s process-wide cache and 10s frontend polling interval.
