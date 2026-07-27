/**
 * One-time migration: give every existing slot a `capacity` and a `bookedMembers`
 * array.
 *
 * Why this must run BEFORE (or with) the atomic-booking deploy: the booking
 * filter uses `$expr: { $lt: [{ $size: "$bookedMembers" }, "$capacity"] }`.
 * In MongoDB a missing field reads as null, `$size` of a missing array errors the
 * expression out, and either way the slot never matches — so without this
 * backfill every pre-existing slot silently becomes unbookable.
 *
 * Safe to re-run: it only touches slots that are actually missing the fields.
 *
 *   node scripts/backfill-slot-capacity.js          # report only, no writes
 *   node scripts/backfill-slot-capacity.js --apply  # perform the migration
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const DEFAULT_SLOT_CAPACITY = 10;
const APPLY = process.argv.includes("--apply");

const uri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@schr0smi1ey.iioky.mongodb.net/?retryWrites=true&w=majority&appName=Schr0Smi1ey`;

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const trainers = client.db("FitForge").collection("Trainers");

  const docs = await trainers.find({ slots: { $exists: true } }).toArray();
  let missingCapacity = 0;
  let missingMembers = 0;
  let maxBooked = 0;

  for (const t of docs) {
    for (const s of t.slots || []) {
      if (typeof s.capacity !== "number") missingCapacity++;
      if (!Array.isArray(s.bookedMembers)) missingMembers++;
      else maxBooked = Math.max(maxBooked, s.bookedMembers.length);
    }
  }

  console.log(`trainers with slots      : ${docs.length}`);
  console.log(`slots missing capacity   : ${missingCapacity}`);
  console.log(`slots missing bookedMembers: ${missingMembers}`);
  console.log(`largest existing booking count: ${maxBooked}`);

  // The default must not be below what a slot already holds, or an existing
  // booking would sit in a slot that reports itself as over capacity.
  const capacity = Math.max(DEFAULT_SLOT_CAPACITY, maxBooked);
  console.log(`capacity to apply        : ${capacity}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to migrate.");
    await client.close();
    return;
  }

  // Positional-all ($[]) updates every element of the array in one pass.
  const capRes = await trainers.updateMany(
    { "slots.capacity": { $exists: false } },
    { $set: { "slots.$[s].capacity": capacity } },
    { arrayFilters: [{ "s.capacity": { $exists: false } }] }
  );
  const memRes = await trainers.updateMany(
    { "slots.bookedMembers": { $exists: false } },
    { $set: { "slots.$[s].bookedMembers": [] } },
    { arrayFilters: [{ "s.bookedMembers": { $exists: false } }] }
  );
  console.log(`\ncapacity backfill  : ${capRes.modifiedCount} trainer doc(s) updated`);
  console.log(`bookedMembers init : ${memRes.modifiedCount} trainer doc(s) updated`);

  // Verify: nothing may be left without the fields the booking filter needs.
  const after = await trainers.find({ slots: { $exists: true } }).toArray();
  let stillMissing = 0;
  for (const t of after) {
    for (const s of t.slots || []) {
      if (typeof s.capacity !== "number" || !Array.isArray(s.bookedMembers)) {
        stillMissing++;
      }
    }
  }
  console.log(`slots still missing fields: ${stillMissing} ${stillMissing ? "<- PROBLEM" : "(clean)"}`);
  await client.close();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
