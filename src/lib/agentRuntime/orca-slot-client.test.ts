import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRuntimeSlots, ORCA_SLOT_DTO_VERSION } from "./orca-slot-client";

test("parseRuntimeSlots accepts a valid payload (safe fields only)", () => {
  const dto = parseRuntimeSlots({
    dto_version: ORCA_SLOT_DTO_VERSION,
    lab_enabled: true,
    slots: [
      {
        slot_id: "s1", state: "free", capacity: 1, in_flight: 0,
        builder_label: "b", attempt_ref: null, last_observed_at: "2026-09-01T00:00:00Z", reason: null,
      },
    ],
  });
  assert.ok(dto);
  assert.equal(dto?.slots.length, 1);
  assert.equal(dto?.slots[0].slot_id, "s1");
});

test("parseRuntimeSlots rejects a slot missing required in_flight", () => {
  const dto = parseRuntimeSlots({
    dto_version: ORCA_SLOT_DTO_VERSION,
    lab_enabled: true,
    slots: [{ slot_id: "s1", state: "free", capacity: 1 }],
  });
  assert.equal(dto, null);
});

test("parseRuntimeSlots accepts an empty slots list", () => {
  const dto = parseRuntimeSlots({ dto_version: ORCA_SLOT_DTO_VERSION, lab_enabled: true, slots: [] });
  assert.ok(dto);
  assert.equal(dto?.slots.length, 0);
});
