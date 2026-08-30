package adapter

import "testing"

func TestNegotiateAcceptsRequiredFeatures(t *testing.T) {
	req := DefaultRequired()
	offered := Spec{
		ContractVersion: CurrentContractVersion,
		Features: append(append([]string(nil), RequiredFeatures...), "extra.unused"),
	}
	res := Negotiate(req, offered)
	if !res.Accepted {
		t.Fatalf("expected accept, got reason=%q", res.Reason)
	}
	if res.ContractVersion != CurrentContractVersion {
		t.Fatalf("version=%d", res.ContractVersion)
	}
	if res.CapabilityHash == "" {
		t.Fatal("expected capability hash")
	}
	if len(res.Features) != len(RequiredFeatures) {
		t.Fatalf("features=%v", res.Features)
	}
}

func TestNegotiateRejectsVersionMismatch(t *testing.T) {
	res := Negotiate(
		Spec{ContractVersion: 1, Features: RequiredFeatures},
		Spec{ContractVersion: 2, Features: RequiredFeatures},
	)
	if res.Accepted {
		t.Fatal("expected reject")
	}
	if res.Reason == "" {
		t.Fatal("expected reason")
	}
}

func TestNegotiateRejectsMissingFeature(t *testing.T) {
	res := Negotiate(
		DefaultRequired(),
		Spec{ContractVersion: 1, Features: []string{FeatureSlotsRead}},
	)
	if res.Accepted {
		t.Fatal("expected reject")
	}
}

func TestHashSpecStable(t *testing.T) {
	a, err := HashSpec(Spec{ContractVersion: 1, Features: []string{"b", "a"}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := HashSpec(Spec{ContractVersion: 1, Features: []string{"a", "b", "a"}})
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("hash unstable: %s vs %s", a, b)
	}
}
