package reconcile

import "testing"

func TestCurrentObservationContract(t *testing.T) {
	c := CurrentObservationContract()
	if c.Version != 1 {
		t.Fatalf("version=%d want 1", c.Version)
	}
	if c.Version != ObservationContractVersion {
		t.Fatalf("version=%d want ObservationContractVersion=%d", c.Version, ObservationContractVersion)
	}
	if len(c.Phases) != 5 {
		t.Fatalf("phases=%v", c.Phases)
	}
	for _, p := range c.Phases {
		if !ValidPhase(p) {
			t.Fatalf("invalid phase %q", p)
		}
	}
	if ValidPhase(Phase("nope")) {
		t.Fatal("expected invalid phase")
	}
}

func TestValidateObservationContractMutating(t *testing.T) {
	if err := ValidateObservation(Observation{
		RunID: "run_1", TaskID: "task_1", DispatchID: "ctx_a",
		TerminalHandle: "term_1", CapabilityHash: "aabbccdd11223344",
	}); err != nil {
		t.Fatal(err)
	}
}
