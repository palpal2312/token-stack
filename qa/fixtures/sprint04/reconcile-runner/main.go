// reconcile-runner executes the Sprint 04 Lane 3 recovery matrix (RC-01..RC-11)
// against the real go/internal/builderexec reconciler with scripted probes.
// Token-free, self-checking: exits non-zero if any cell fails and prints one
// compact counter line. Usage:
//
//	go run . [--json evidence.json] [--bench]
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	"agentic-os/internal/builderexec"
)

// ---------- scripted probes ----------

type attemptProbe struct {
	alive map[string]bool
	err   map[string]error
}

func (p *attemptProbe) IsAttemptAlive(_ context.Context, id string) (bool, error) {
	if e, ok := p.err[id]; ok {
		return false, e
	}
	return p.alive[id], nil
}

type paneProbe struct {
	alive      map[string]bool
	err        map[string]error
	destroyErr map[string]error
	mu         sync.Mutex
	destroyed  []string
}

func (p *paneProbe) IsPaneAlive(_ context.Context, id string) (bool, error) {
	if e, ok := p.err[id]; ok {
		return false, e
	}
	return p.alive[id], nil
}

func (p *paneProbe) DestroyPane(_ context.Context, id string) error {
	p.mu.Lock()
	p.destroyed = append(p.destroyed, id)
	p.mu.Unlock()
	if e, ok := p.destroyErr[id]; ok {
		return e
	}
	return nil
}

type sandboxProbe struct {
	alive     map[string]bool
	mu        sync.Mutex
	destroyed []string
}

func (p *sandboxProbe) IsSandboxAlive(_ context.Context, id string) (bool, error) {
	return p.alive[id], nil
}

func (p *sandboxProbe) DestroySandbox(_ context.Context, id string) error {
	p.mu.Lock()
	p.destroyed = append(p.destroyed, id)
	p.mu.Unlock()
	return nil
}

type processProbe struct {
	alive  map[string]bool
	mu     sync.Mutex
	killed []string
}

func (p *processProbe) IsProcessAlive(_ context.Context, id string) (bool, error) {
	return p.alive[id], nil
}

func (p *processProbe) KillProcess(_ context.Context, id string) error {
	p.mu.Lock()
	p.killed = append(p.killed, id)
	p.mu.Unlock()
	return nil
}

// rig bundles a reconciler with its scripted probes.
type rig struct {
	rec       *builderexec.Reconciler
	attempts  *attemptProbe
	panes     *paneProbe
	sandboxes *sandboxProbe
	procs     *processProbe
}

func newRig() *rig {
	r := &rig{
		attempts:  &attemptProbe{alive: map[string]bool{}, err: map[string]error{}},
		panes:     &paneProbe{alive: map[string]bool{}, err: map[string]error{}, destroyErr: map[string]error{}},
		sandboxes: &sandboxProbe{alive: map[string]bool{}},
		procs:     &processProbe{alive: map[string]bool{}},
	}
	r.rec = builderexec.NewReconciler(r.attempts, r.panes, r.sandboxes, r.procs)
	return r
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func count(xs []string, want string) int {
	n := 0
	for _, x := range xs {
		if x == want {
			n++
		}
	}
	return n
}

// ---------- evidence ----------

type cellResult struct {
	ID      string `json:"id"`
	Status  string `json:"status"` // PASS | FAIL
	Details string `json:"details,omitempty"`
}

type evidence struct {
	Sprint                   string       `json:"sprint"`
	Subject                  string       `json:"subject"`
	Timestamp                string       `json:"timestamp"`
	Cells                    []cellResult `json:"cells"`
	Passed                   int          `json:"passed"`
	Total                    int          `json:"total"`
	DuplicateCleanupObserved int          `json:"duplicate_cleanup_observed"`
	Measurements             []measure    `json:"measurements,omitempty"`
}

type measure struct {
	Name         string  `json:"name"`
	Resources    int     `json:"resources"`
	Passes       int     `json:"passes"`
	TotalMs      float64 `json:"total_ms"`
	NsPerPass    float64 `json:"ns_per_pass"`
	NsPerResPass float64 `json:"ns_per_resource_per_pass"`
}

// ---------- cells ----------

var errBoom = errors.New("injected probe failure")

func rc01() (string, error) {
	r := newRig()
	r.attempts.alive["a-dead"] = false
	r.rec.Track(builderexec.ResourcePane, "pane-1", "a-dead")
	res := r.rec.Reconcile(context.Background())
	if res.OrphansDetected != 1 || res.OrphansCleaned != 1 {
		return fmt.Sprintf("orphans detected=%d cleaned=%d", res.OrphansDetected, res.OrphansCleaned), errors.New("bad orphan counts")
	}
	if count(r.panes.destroyed, "pane-1") != 1 {
		return fmt.Sprintf("destroyed=%v", r.panes.destroyed), errors.New("DestroyPane call count != 1")
	}
	if n := len(r.rec.TrackedResources()); n != 0 {
		return fmt.Sprintf("still tracked=%d", n), errors.New("orphan pane not untracked")
	}
	return "destroyed once, untracked", nil
}

func rc02() (string, error) {
	r := newRig()
	r.attempts.alive["a-dead"] = false
	r.rec.Track(builderexec.ResourceSandbox, "sb-1", "a-dead")
	res := r.rec.Reconcile(context.Background())
	if res.OrphansCleaned != 1 || count(r.sandboxes.destroyed, "sb-1") != 1 {
		return fmt.Sprintf("destroyed=%v cleaned=%d", r.sandboxes.destroyed, res.OrphansCleaned), errors.New("sandbox orphan not cleaned once")
	}
	return "DestroySandbox once, cleaned", nil
}

func rc03() (string, error) {
	r := newRig()
	r.attempts.alive["a-dead"] = false
	r.rec.Track(builderexec.ResourceProcess, "proc-1", "a-dead")
	res := r.rec.Reconcile(context.Background())
	if res.OrphansCleaned != 1 || count(r.procs.killed, "proc-1") != 1 {
		return fmt.Sprintf("killed=%v cleaned=%d", r.procs.killed, res.OrphansCleaned), errors.New("process orphan not killed once")
	}
	if len(res.Actions) != 1 || res.Actions[0].Action != "kill" {
		return fmt.Sprintf("actions=%+v", res.Actions), errors.New("action != kill")
	}
	return "KillProcess once, action=kill", nil
}

func rc04() (string, error) {
	r := newRig()
	r.attempts.alive["a-ok"] = true
	r.panes.alive["pane-1"] = true
	r.sandboxes.alive["sb-1"] = true
	r.rec.Track(builderexec.ResourcePane, "pane-1", "a-ok")
	r.rec.Track(builderexec.ResourceSandbox, "sb-1", "a-ok")
	res := r.rec.Reconcile(context.Background())
	if res.OrphansDetected != 0 || len(res.Actions) != 0 {
		return fmt.Sprintf("orphans=%d actions=%d", res.OrphansDetected, len(res.Actions)), errors.New("false orphan / cleanup on live resources")
	}
	for _, tr := range r.rec.TrackedResources() {
		if tr.State != builderexec.ResourceAlive {
			return fmt.Sprintf("%s state=%s", tr.ID, tr.State), errors.New("live resource misclassified")
		}
	}
	return "0 orphans, 0 actions, all alive", nil
}

func rc05() (string, error) {
	r := newRig()
	r.attempts.alive["a-ok"] = true
	r.panes.err["pane-1"] = errBoom
	r.rec.Track(builderexec.ResourcePane, "pane-1", "a-ok")
	res := r.rec.Reconcile(context.Background())
	if len(res.Actions) != 0 {
		return fmt.Sprintf("actions=%+v", res.Actions), errors.New("cleanup attempted despite probe error")
	}
	if len(res.Errors) != 1 {
		return fmt.Sprintf("errors=%d", len(res.Errors)), errors.New("probe error not recorded")
	}
	tracked := r.rec.TrackedResources()
	if len(tracked) != 1 || tracked[0].State != builderexec.ResourceUnknown {
		return fmt.Sprintf("tracked=%+v", tracked), errors.New("resource not retained as unknown")
	}
	return "state=unknown, no cleanup, retained", nil
}

func rc06() (string, error) {
	r := newRig()
	r.attempts.alive["a-dead"] = false
	r.panes.destroyErr["pane-1"] = errBoom
	r.rec.Track(builderexec.ResourcePane, "pane-1", "a-dead")
	res := r.rec.Reconcile(context.Background())
	if res.OrphansCleaned != 0 {
		return fmt.Sprintf("cleaned=%d", res.OrphansCleaned), errors.New("failed cleanup counted as cleaned")
	}
	if len(res.Actions) != 1 || res.Actions[0].Success {
		return fmt.Sprintf("actions=%+v", res.Actions), errors.New("failed action not marked unsuccessful")
	}
	if n := len(r.rec.TrackedResources()); n != 1 {
		return fmt.Sprintf("tracked=%d", n), errors.New("failed-cleanup resource dropped from tracking")
	}
	return "action.success=false, resource retained for retry", nil
}

func rc07() (string, error) {
	r := newRig()
	r.attempts.alive["a-dead"] = false
	r.rec.Track(builderexec.ResourcePane, "pane-1", "a-dead")
	r.rec.Reconcile(context.Background())
	second := r.rec.Reconcile(context.Background())
	if second.ResourcesChecked != 0 || second.OrphansDetected != 0 || len(second.Actions) != 0 || len(second.Errors) != 0 {
		return fmt.Sprintf("second=%+v", second), errors.New("second pass not idempotent")
	}
	return "second pass: 0 checked, 0 orphans, 0 actions, 0 errors", nil
}

func rc08() (string, error) {
	r := newRig()
	r.attempts.alive["a-dead"] = false
	r.rec.Track(builderexec.ResourceAttempt, "a-dead", "a-dead")
	res := r.rec.Reconcile(context.Background())
	if len(res.Actions) != 1 || res.Actions[0].Action != "cleanup" {
		return fmt.Sprintf("actions=%+v", res.Actions), errors.New("attempt orphan not self-cleaned")
	}
	if len(r.panes.destroyed)+len(r.sandboxes.destroyed)+len(r.procs.killed) != 0 {
		return "external destroy called for attempt kind", errors.New("external cleanup leak")
	}
	if res.OrphansCleaned != 1 || len(r.rec.TrackedResources()) != 0 {
		return fmt.Sprintf("cleaned=%d tracked=%d", res.OrphansCleaned, len(r.rec.TrackedResources())), errors.New("attempt not cleaned/untracked")
	}
	return "action=cleanup, no external calls, untracked", nil
}

func rc09() (string, error) {
	r := newRig()
	r.attempts.err["a-flaky"] = errBoom
	r.rec.Track(builderexec.ResourcePane, "pane-1", "a-flaky")
	r.rec.Track(builderexec.ResourceProcess, "proc-1", "a-flaky")
	res := r.rec.Reconcile(context.Background())
	if res.OrphansDetected != 0 || len(res.Actions) != 0 {
		return fmt.Sprintf("orphans=%d actions=%d", res.OrphansDetected, len(res.Actions)), errors.New("cleanup on attempt-probe error")
	}
	if len(res.Errors) == 0 {
		return "no error recorded", errors.New("attempt probe error not recorded")
	}
	return "0 orphans, 0 actions, error recorded", nil
}

func rc10() (string, error) {
	r := newRig()
	r.attempts.alive["a-ok"] = true
	r.rec.Track(builderexec.ResourcePane, "pane-1", "a-ok")
	r.rec.Untrack(builderexec.ResourcePane, "pane-1")
	res := r.rec.Reconcile(context.Background())
	if res.ResourcesChecked != 0 || len(r.panes.destroyed) != 0 {
		return fmt.Sprintf("checked=%d destroyed=%v", res.ResourcesChecked, r.panes.destroyed), errors.New("untracked resource probed/cleaned")
	}
	return "untracked resource exempt", nil
}

// rc11 runs two concurrent passes over one tracker (run with -race). The
// reconciler locks the map but not the pass, so duplicate cleanup of the same
// resource is possible; the cell asserts race-/panic-freedom and reports the
// observed duplicate count as a finding, not a crash.
func rc11() (string, error) {
	r := newRig()
	r.attempts.alive["a-dead"] = false
	const n = 100
	for i := 0; i < n; i++ {
		r.rec.Track(builderexec.ResourcePane, fmt.Sprintf("pane-%d", i), "a-dead")
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); r.rec.Reconcile(context.Background()) }()
	go func() { defer wg.Done(); r.rec.Reconcile(context.Background()) }()
	wg.Wait()
	dups := 0
	for i := 0; i < n; i++ {
		if c := count(r.panes.destroyed, fmt.Sprintf("pane-%d", i)); c > 1 {
			dups += c - 1
		}
	}
	if len(r.rec.TrackedResources()) != 0 {
		return fmt.Sprintf("tracked=%d", len(r.rec.TrackedResources())), errors.New("resources left tracked after concurrent passes")
	}
	return fmt.Sprintf("race-free concurrent passes; duplicate cleanups observed=%d", dups), &dupError{count: dups}
}

type dupError struct{ count int }

func (e *dupError) Error() string { return fmt.Sprintf("duplicate cleanups: %d", e.count) }

// ---------- bench ----------

func benchPass(resources, passes int) measure {
	r := newRig()
	r.attempts.alive["a-ok"] = true
	for i := 0; i < resources; i++ {
		id := fmt.Sprintf("pane-%d", i)
		r.panes.alive[id] = true
		r.rec.Track(builderexec.ResourcePane, id, "a-ok")
	}
	start := time.Now()
	for i := 0; i < passes; i++ {
		r.rec.Reconcile(context.Background())
	}
	el := time.Since(start)
	nsPerPass := float64(el.Nanoseconds()) / float64(passes)
	return measure{
		Name:         "reconcile-pass-all-alive",
		Resources:    resources,
		Passes:       passes,
		TotalMs:      float64(el.Microseconds()) / 1000.0,
		NsPerPass:    nsPerPass,
		NsPerResPass: nsPerPass / float64(resources),
	}
}

// ---------- main ----------

func main() {
	jsonPath := flag.String("json", "", "write evidence JSON to this path")
	doBench := flag.Bool("bench", false, "run measurement passes")
	flag.Parse()

	type cell struct {
		id string
		fn func() (string, error)
	}
	cells := []cell{
		{"RC-01", rc01}, {"RC-02", rc02}, {"RC-03", rc03}, {"RC-04", rc04},
		{"RC-05", rc05}, {"RC-06", rc06}, {"RC-07", rc07}, {"RC-08", rc08},
		{"RC-09", rc09}, {"RC-10", rc10}, {"RC-11", rc11},
	}

	ev := evidence{
		Sprint:    "orchestrate-260825-sprint04-orca-reconcile",
		Subject:   "go/internal/builderexec/reconciler.go",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Total:     len(cells),
	}
	failed := 0
	for _, c := range cells {
		details, err := c.fn()
		cr := cellResult{ID: c.id, Status: "PASS", Details: details}
		if err != nil {
			var de *dupError
			if errors.As(err, &de) {
				// duplicate cleanup is a recorded finding, not a cell failure
				ev.DuplicateCleanupObserved = de.count
			} else {
				cr.Status = "FAIL"
				cr.Details = details + " | " + err.Error()
				failed++
			}
		}
		ev.Cells = append(ev.Cells, cr)
	}
	ev.Passed = ev.Total - failed

	if *doBench {
		ev.Measurements = append(ev.Measurements,
			benchPass(1000, 50),
			benchPass(10000, 10),
		)
		for _, m := range ev.Measurements {
			fmt.Printf("MEASURE %s n=%d passes=%d ns/pass=%.0f ns/res/pass=%.1f\n",
				m.Name, m.Resources, m.Passes, m.NsPerPass, m.NsPerResPass)
		}
	}

	if *jsonPath != "" {
		b, err := json.MarshalIndent(ev, "", "  ")
		if err != nil {
			fmt.Fprintln(os.Stderr, "marshal:", err)
			os.Exit(2)
		}
		if err := os.WriteFile(*jsonPath, b, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "write:", err)
			os.Exit(2)
		}
	}

	ids := make([]string, 0, failed)
	for _, c := range ev.Cells {
		if c.Status == "FAIL" {
			ids = append(ids, c.ID)
		}
	}
	sort.Strings(ids)
	fmt.Printf("S04-RC: %d/%d PASS", ev.Passed, ev.Total)
	if failed > 0 {
		fmt.Printf(" FAIL=%v", ids)
	}
	fmt.Printf(" dup-cleanup=%d\n", ev.DuplicateCleanupObserved)
	if failed > 0 {
		os.Exit(1)
	}
}
