const { ObjectId } = require("mongodb");
const { collections } = require("../config/db");
const { getPackagePriceCents } = require("../config/pricing");
const { bookSlotAtomically } = require("./booking");

/**
 * Records a payment and books the slot it paid for.
 *
 * Called ONLY from the verified Stripe webhook — never from a client request —
 * so the booking exists if and only if Stripe confirms money actually moved.
 *
 * Idempotent: the unique index on Payments.transactionId is the gate. Stripe
 * retries a webhook until it gets a 2xx and can deliver the same event more than
 * once, so the insert is attempted first and a duplicate-key error means this
 * event was already fulfilled — we return instead of double-booking the slot.
 */
async function fulfillBooking({ transactionId, metadata }) {
  const { trainerId, slotId, email, packageName } = metadata || {};
  if (!trainerId || !slotId || !email || !packageName) {
    throw new Error(`payment intent ${transactionId} is missing booking metadata`);
  }
  const priceCents = getPackagePriceCents(packageName);
  if (priceCents === null) {
    throw new Error(
      `payment intent ${transactionId} has unknown package ${packageName}`
    );
  }
  if (!ObjectId.isValid(trainerId) || !ObjectId.isValid(slotId)) {
    throw new Error(
      `payment intent ${transactionId} has malformed trainerId/slotId`
    );
  }

  const trainerDoc = await collections.trainers.findOne(
    { _id: new ObjectId(trainerId), "slots._id": new ObjectId(slotId) },
    { projection: { "slots.$": 1 } }
  );
  const selectedClass = trainerDoc ? trainerDoc.slots[0].selectedClass : null;

  try {
    await collections.payments.insertOne({
      email,
      // Recomputed from packageName, never taken from a client.
      price: priceCents / 100,
      transactionId,
      date: new Date().toISOString(),
      packageName,
      trainerId,
      slotId,
      classId: selectedClass,
    });
  } catch (err) {
    // A duplicate key here is the EXPECTED path for a webhook redelivery, not a
    // failure, so it is not logged as one. Anything else propagates to the
    // webhook handler, which logs it and returns 5xx so Stripe retries.
    if (err?.code === 11000) return { duplicate: true };
    throw err;
  }

  const booked = await bookSlotAtomically(collections.trainers, {
    trainerId,
    slotId,
    email,
    transactionId,
  });
  if (!booked) {
    // Paid but unbookable (slot filled up, or this email already holds it).
    // The payment row stays — it is a real charge — and is flagged so it can be
    // reconciled or refunded rather than silently disappearing.
    await collections.payments.updateOne(
      { transactionId },
      { $set: { fulfillmentStatus: "slot_unavailable" } }
    );
    return { duplicate: false, booked: false };
  }

  if (selectedClass) {
    await collections.classes.updateOne(
      { _id: new ObjectId(selectedClass) },
      { $inc: { booked: 1 } }
    );
  }
  return { duplicate: false, booked: true };
}

module.exports = { fulfillBooking };
