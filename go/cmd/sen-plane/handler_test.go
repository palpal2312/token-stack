package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRuntimeSlotsHandler(t *testing.T) {
	ts := httptest.NewServer(NewHandler(memorySlotSource{}))
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/v1/runtime/slots")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var dto RuntimeSlotsDTO
	if err := json.NewDecoder(res.Body).Decode(&dto); err != nil {
		t.Fatal(err)
	}
	if dto.DTOVersion != slotDTOVersion {
		t.Errorf("dto_version = %d", dto.DTOVersion)
	}
	if !dto.LabEnabled {
		t.Error("lab_enabled = false")
	}
	if len(dto.Slots) != 1 || dto.Slots[0].State != "free" || dto.Slots[0].Capacity != 1 {
		t.Errorf("unexpected slots: %+v", dto.Slots)
	}
	raw, _ := json.Marshal(dto.Slots)
	for _, key := range []string{"token", "secret", "password", "command", "private"} {
		if bytes.Contains(raw, []byte(key)) {
			t.Errorf("slot payload leaked key substring %q", key)
		}
	}
}

func TestHealthz(t *testing.T) {
	ts := httptest.NewServer(NewHandler(memorySlotSource{}))
	defer ts.Close()
	res, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
}