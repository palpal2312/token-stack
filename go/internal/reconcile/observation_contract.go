package reconcile

// ObservationContract is the frozen typed ADP-05 observation surface.
// Version bumps require a new ADR under plans/reports/.../lane1/.
type ObservationContract struct {
	Version int
	Phases  []Phase
}

// CurrentObservationContract returns the accepted Lane 1 contract descriptor.
func CurrentObservationContract() ObservationContract {
	return ObservationContract{
		Version: ObservationContractVersion,
		Phases: []Phase{
			PhaseSteady,
			PhaseReconnecting,
			PhaseReattaching,
			PhaseQuarantined,
			PhaseObserveOnly,
		},
	}
}

// ValidPhase reports whether p is in the accepted phase vocabulary.
func ValidPhase(p Phase) bool {
	switch p {
	case PhaseSteady, PhaseReconnecting, PhaseReattaching, PhaseQuarantined, PhaseObserveOnly:
		return true
	default:
		return false
	}
}
