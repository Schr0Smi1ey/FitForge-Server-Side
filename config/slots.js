// Seats per slot when a trainer doesn't specify one. Also the value
// scripts/backfill-slot-capacity.js writes onto slots created before the
// capacity field existed.
//
// This is not cosmetic: the atomic booking filter compares the booked count
// against `capacity`, and a slot without a numeric capacity can never match, so
// it would be permanently unbookable.
const DEFAULT_SLOT_CAPACITY = 10;

module.exports = { DEFAULT_SLOT_CAPACITY };
