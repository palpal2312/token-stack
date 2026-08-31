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

