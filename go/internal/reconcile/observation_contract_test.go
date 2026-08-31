package reconcile

import "testing"

func TestValidateObservationContractMutating(t *testing.T) {
	if err := ValidateObservation(Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "aabbccdd11223344",
	}); err != nil {
		t.Fatal(err)
	}
}
