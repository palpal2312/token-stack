package runlearning

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"
)

func fixtureRun() TerminalRun {
	start := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	return TerminalRun{RunID: "opaque-run-01", TerminalState: "succeeded", StartedAt: start, FinishedAt: start.Add(10 * time.Minute), ActiveDurationMS: 500000, BlockedDurationMS: 100000, RetryCount: 1, ReworkCount: 2, ReviewOutcome: "accepted", EstimateRevision: "estimate-v2", ActualRevision: "actual-v1", EstimatedElapsedMS: 540000, EstimatedSequentialWorkMS: 700000, ActualSequentialWorkMS: 720000, ForecastResultID: "opaque-forecast-01", EstimatorRevision: "estimator-v3", PolicyRevision: "privacy-v1", EstimatedLaneUtilization: .7, ActualLaneUtilization: .65, PredictedAcceptance: .8, ActualAcceptance: 1, IntervalLowerMS: 480000, IntervalUpperMS: 660000}
}

func TestOneImmutableRecordPerTerminalRunAndReplay(t *testing.T) {
	s := NewStore()
	in := fixtureRun()
	first, err := s.RecordTerminalRun(in)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.RecordTerminalRun(in)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("replay did not return original record")
	}
	in.ActualRevision = "actual-v2"
	_, err = s.RecordTerminalRun(in)
	var safeErr *SafeError
	if !errors.As(err, &safeErr) || safeErr.ErrorCode != "IDEMPOTENCY_CONFLICT" {
		t.Fatalf("expected safe immutable conflict, got %v", err)
	}
	if safeErr.Error() == in.RunID {
		t.Fatal("error echoed private value")
	}
}

func TestFeatureCandidateAndCalibrationAreDeterministic(t *testing.T) {
	s := NewStore()
	r, _ := s.RecordTerminalRun(fixtureRun())
	fi := FeatureInput{TaskCohort: "backend", ConfigurationCohort: "two-lane", SequentialWorkMS: 720000, CriticalPathMS: 480000, UsefulLaneRange: UsefulLaneRange{1, 2}, ReviewRetryAllowance: 2, ResourceClass: "standard", CostMicros: 250000, SampleSize: 12, Uncertainty: .2, DistributionStatus: "in-distribution", FeatureSetVersion: "features-v1"}
	f1, err := s.DeriveFeature(r, fi)
	if err != nil {
		t.Fatal(err)
	}
	f2, _ := s.DeriveFeature(r, fi)
	if !reflect.DeepEqual(f1, f2) {
		t.Fatal("feature derivation is not deterministic")
	}
	ci := CandidateInput{CandidateVersion: "candidate-v1", AllowlistRevision: "allowlist-v1", Cohort: "backend/two-lane", TimeWindow: "30d", SelectionBiasLimit: "local-observed-only", Metrics: map[string]float64{"retryCount": 1, "elapsedTimeMs": 600000}}
	c1, err := s.DeriveCandidate(f1, ci)
	if err != nil {
		t.Fatal(err)
	}
	c2, _ := s.DeriveCandidate(f1, ci)
	if !reflect.DeepEqual(c1, c2) || c1.ConsentState != "local-only" {
		t.Fatal("candidate not idempotent and local-only")
	}
	cal1, err := s.RecordCalibration(r, .65, .1, .05, .2)
	if err != nil {
		t.Fatal(err)
	}
	cal2, _ := s.RecordCalibration(r, .65, .1, .05, .2)
	if !reflect.DeepEqual(cal1, cal2) || !cal1.IntervalCovered || cal1.ElapsedTimeError != 60000 {
		t.Fatalf("bad calibration facts: %+v", cal1)
	}
	b1, _ := json.Marshal(struct {
		F ForecastFeatureRecord
		C ContributionCandidate
		E CalibrationError
	}{f1, c1, cal1})
	rebuilt, err := Rebuild(s.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	snap := rebuilt.Snapshot()
	b2, _ := json.Marshal(struct {
		F ForecastFeatureRecord
		C ContributionCandidate
		E CalibrationError
	}{snap.Features[0], snap.Candidates[0], snap.Calibrations[0]})
	if string(b1) != string(b2) {
		t.Fatal("rebuild changed derived facts")
	}
}

func TestDurableStoreRebuildsAfterRestart(t *testing.T) {
	path := t.TempDir() + "/run-learning.journal"
	s, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	in := fixtureRun()
	r, err := s.RecordTerminalRun(in)
	if err != nil {
		t.Fatal(err)
	}
	f, err := s.DeriveFeature(r, FeatureInput{TaskCohort: "backend", ConfigurationCohort: "two-lane", FeatureSetVersion: "features-v1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeriveCandidate(f, CandidateInput{CandidateVersion: "candidate-v1", AllowlistRevision: "allowlist-v1", Cohort: "backend/two-lane", TimeWindow: "30d", SelectionBiasLimit: "observed-only", Metrics: map[string]float64{"retryCount": 1}}); err != nil {
		t.Fatal(err)
	}
	want := s.Snapshot()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if got := restarted.Snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("restart rebuild mismatch: got %+v want %+v", got, want)
	}
	replayed, err := restarted.RecordTerminalRun(in)
	if err != nil || !reflect.DeepEqual(replayed, r) {
		t.Fatalf("durable replay did not return original: %v", err)
	}
	in.ActualRevision = "changed"
	if _, err := restarted.RecordTerminalRun(in); err == nil {
		t.Fatal("durable store accepted immutable rewrite after restart")
	}
}

func TestCandidateRejectsPrivateContentInAllowlistedValues(t *testing.T) {
	s := NewStore()
	r, _ := s.RecordTerminalRun(fixtureRun())
	f, _ := s.DeriveFeature(r, FeatureInput{FeatureSetVersion: "v1"})
	cases := []CandidateInput{
		{Cohort: "repository-private-repo", TimeWindow: "30d", SelectionBiasLimit: "observed-only"},
		{Cohort: "backend", TimeWindow: "30d", SelectionBiasLimit: "prompt-content"},
		{Cohort: "backend", TimeWindow: "C:/private/project", SelectionBiasLimit: "observed-only"},
		{Cohort: "person@example.invalid", TimeWindow: "30d", SelectionBiasLimit: "observed-only"},
	}
	for _, tc := range cases {
		_, err := s.DeriveCandidate(f, tc)
		var safeErr *SafeError
		if !errors.As(err, &safeErr) || safeErr.ErrorCode != "FORBIDDEN_FIELD" {
			t.Fatalf("expected content-free rejection, got %v", err)
		}
	}
}

func TestRecursiveForbiddenFieldAliasesAreRejectedWithoutEcho(t *testing.T) {
	cases := []map[string]any{
		{"nested": map[string]any{"Prompt_Content": "sensitive marker"}},
		{"items": []any{map[string]any{"repository-path": "sensitive marker"}}},
		{"meta": map[string]any{"API_KEY": "sensitive marker"}},
		{"meta": map[string]any{"conversation-id": "sensitive marker"}},
	}
	for _, tc := range cases {
		err := ValidatePrivacy(tc, "privacy-v1")
		var safeErr *SafeError
		if !errors.As(err, &safeErr) || safeErr.ErrorCode != "FORBIDDEN_FIELD" {
			t.Fatalf("expected forbidden rejection: %v", err)
		}
		if safeErr.Error() == "sensitive marker" {
			t.Fatal("error leaked rejected value")
		}
	}
}

func TestCandidateStrictMetricAllowlist(t *testing.T) {
	s := NewStore()
	r, _ := s.RecordTerminalRun(fixtureRun())
	f, _ := s.DeriveFeature(r, FeatureInput{FeatureSetVersion: "v1"})
	_, err := s.DeriveCandidate(f, CandidateInput{Metrics: map[string]float64{"customMetric": 1}})
	var safeErr *SafeError
	if !errors.As(err, &safeErr) || safeErr.RuleClass != "unknown-field" {
		t.Fatalf("expected allowlist rejection, got %v", err)
	}
}

func TestRejectsNonTerminalRun(t *testing.T) {
	s := NewStore()
	in := fixtureRun()
	in.TerminalState = "running"
	if _, err := s.RecordTerminalRun(in); err == nil {
		t.Fatal("accepted non-terminal run")
	}
}
