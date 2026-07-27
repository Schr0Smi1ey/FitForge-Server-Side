const { ObjectId } = require("mongodb");

/**
 * Books one seat in a slot without a read-then-write race window.
 *
 * The capacity check lives in the update's FILTER, so MongoDB evaluates it while
 * holding the document lock. Of N concurrent callers competing for the last seat,
 * exactly one filter matches and the rest modify nothing.
 *
 * Implementation note — why this doesn't use $expr:
 *   The obvious formulation is
 *     $elemMatch: { $expr: { $lt: [ { $size: "$bookedMembers" }, "$capacity" ] } }
 *   but MongoDB rejects it with "$expr can only be applied to the top-level
 *   document"; $expr is not allowed inside $elemMatch.
 *   Instead we exploit the fact that the array path `bookedMembers.N` exists if
 *   and only if the array has more than N entries. Requiring
 *   `bookedMembers.<capacity-1>` to be ABSENT is therefore exactly "the array is
 *   shorter than capacity", expressed with a plain query operator the filter can
 *   evaluate atomically.
 *
 * `capacity` is read first only to build that path. It is also matched in the
 * filter, making the update a compare-and-swap: if the trainer changed the
 * capacity in between, nothing matches and we report failure rather than booking
 * against a stale limit.
 *
 * @returns {Promise<boolean>} true if a seat was taken; false if the slot is
 *   full, missing, has no valid capacity, or this email already holds a seat.
 */
async function bookSlotAtomically(
  trainersCollection,
  { trainerId, slotId, email, transactionId }
) {
  if (!ObjectId.isValid(trainerId) || !ObjectId.isValid(slotId)) return false;
  const trainerObjId = new ObjectId(trainerId);
  const slotObjId = new ObjectId(slotId);

  const doc = await trainersCollection.findOne(
    { _id: trainerObjId, "slots._id": slotObjId },
    { projection: { "slots.$": 1 } }
  );
  const capacity = doc?.slots?.[0]?.capacity;
  // Slots predating the capacity field are unbookable until the backfill
  // migration runs (scripts/backfill-slot-capacity.js).
  if (!Number.isInteger(capacity) || capacity <= 0) return false;

  const result = await trainersCollection.updateOne(
    {
      _id: trainerObjId,
      slots: {
        $elemMatch: {
          _id: slotObjId,
          capacity,
          "bookedMembers.email": { $ne: email },
          
        },
      },
    },
    {
      $push: {
        "slots.$[slot].bookedMembers": {
          email,
          transactionId,
          bookedAt: new Date(),
        },
      },
    },
    { arrayFilters: [{ "slot._id": slotObjId }] }
  );
  return result.modifiedCount === 1;
}

module.exports = { bookSlotAtomically };
