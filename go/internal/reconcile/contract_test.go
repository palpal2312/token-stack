package reconcile

import "testing"

func TestValidateObservationMutatingRequiresIDs(t *testing.T) {
	err := ValidateObservation(Observation{
		OutputCursor: 0,
	})
	if err == nil {
		t.Fatal("expected missing id error")
	}
	err = ValidateObservation(Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", OutputCursor: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidateObservationRejectsNegativeCursor(t *testing.T) {
	err := ValidateObservation(Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", OutputCursor: -1,
	})
	if err == nil {
		t.Fatal("expected cursor error")
	}
}

func TestValidateObservationRejectsBearerCapability(t *testing.T) {
	err := ValidateObservation(Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "dcap_not_a_hash",
	})
	if err == nil {
		t.Fatal("expected bearer refusal")
	}
}

func TestValidateObservationAcceptsHexHash(t *testing.T) {
	err := ValidateObservation(Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "deadbeefcafebabe",
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestClassifyObserveOnly(t *testing.T) {
	d, p, err := Classify(Observation{ObserveOnly: true}, ClassifyInput{})
	if err != nil {
		t.Fatal(err)
	}
	if d != DecisionObserveOnly || p != PhaseObserveOnly {
		t.Fatalf("got %s %s", d, p)
	}
}

func TestClassifyRevokedQuarantine(t *testing.T) {
	d, p, err := Classify(Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityRevoked: true,
	}, ClassifyInput{})
	if err != nil {
		t.Fatal(err)
	}
	if d != DecisionQuarantine || p != PhaseQuarantined {
		t.Fatalf("got %s %s", d, p)
	}
}

func TestClassifyReattachVsClaimVsReconnect(t *testing.T) {
	base := Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1",
	}
	d, p, err := Classify(base, ClassifyInput{Persisted: true})
	if err != nil || d != DecisionReattach || p != PhaseReattaching {
		t.Fatalf("reattach: %s %s %v", d, p, err)
	}
	d, p, err = Classify(base, ClassifyInput{})
	if err != nil || d != DecisionClaim || p != PhaseSteady {
		t.Fatalf("claim: %s %s %v", d, p, err)
	}
	d, p, err = Classify(base, ClassifyInput{KnownDispatch: true, Persisted: false})
	if err != nil || d != DecisionReconnect || p != PhaseReconnecting {
		t.Fatalf("reconnect: %s %s %v", d, p, err)
	}
}
