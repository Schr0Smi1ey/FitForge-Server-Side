/**
 * Proves the atomic-booking guarantee against a real MongoDB (in-memory), because
 * a race condition cannot be demonstrated with mocks — the guarantee lives in how
 * the server applies the update, not in our own code paths.
 */
const { MongoClient, ObjectId } = require("mongodb");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
// The REAL implementation, not a copy — a mirrored version here would happily
// keep passing after index.js drifted away from it.
const { bookSlotAtomically: book } = require("../lib/booking");

let mongod;
let client;
let trainers;

const bookSlotAtomically = (args) => book(trainers, args);

const TRAINER_ID = new ObjectId();
const SLOT_ID = new ObjectId();

async function seedSlot(capacity, bookedMembers = []) {
  await trainers.deleteMany({});
  await trainers.insertOne({
    _id: TRAINER_ID,
    fullName: "Test Trainer",
    slots: [{ _id: SLOT_ID, slotName: "Morning", capacity, bookedMembers }],
  });
}

const seatCount = async () => {
  const doc = await trainers.findOne({ _id: TRAINER_ID });
  return doc.slots[0].bookedMembers.length;
};

beforeAll(async () => {
  // A replica set (not a standalone) so behaviour matches Atlas.
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(mongod.getUri());
  await client.connect();
  trainers = client.db("FitForgeTest").collection("Trainers");
}, 120000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

describe("atomic slot booking", () => {
  it("books a seat when the slot has room", async () => {
    await seedSlot(2);
    await expect(
      bookSlotAtomically({ trainerId: TRAINER_ID, slotId: SLOT_ID, email: "a@x.com", transactionId: "pi_1" })
    ).resolves.toBe(true);
    expect(await seatCount()).toBe(1);
  });

  it("refuses once the slot is full", async () => {
    await seedSlot(1, [{ email: "taken@x.com" }]);
    await expect(
      bookSlotAtomically({ trainerId: TRAINER_ID, slotId: SLOT_ID, email: "b@x.com", transactionId: "pi_2" })
    ).resolves.toBe(false);
    expect(await seatCount()).toBe(1);
  });

  it("refuses a second booking by the same email, even with room left", async () => {
    await seedSlot(5, [{ email: "dup@x.com" }]);
    await expect(
      bookSlotAtomically({ trainerId: TRAINER_ID, slotId: SLOT_ID, email: "dup@x.com", transactionId: "pi_3" })
    ).resolves.toBe(false);
    expect(await seatCount()).toBe(1);
  });

  // The core guarantee. With a read-then-write implementation both callers read
  // "0 of 1 taken", both decide there is room, and both push.
  it("lets exactly ONE of two concurrent bookings win the last seat", async () => {
    await seedSlot(1);
    const results = await Promise.all([
      bookSlotAtomically({ trainerId: TRAINER_ID, slotId: SLOT_ID, email: "r1@x.com", transactionId: "pi_r1" }),
      bookSlotAtomically({ trainerId: TRAINER_ID, slotId: SLOT_ID, email: "r2@x.com", transactionId: "pi_r2" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await seatCount()).toBe(1);
  });

  it("never oversells under heavy concurrency (20 callers, 3 seats)", async () => {
    await seedSlot(3);
    const attempts = Array.from({ length: 20 }, (_, i) =>
      bookSlotAtomically({
        trainerId: TRAINER_ID,
        slotId: SLOT_ID,
        email: `user${i}@x.com`,
        transactionId: `pi_${i}`,
      })
    );
    const results = await Promise.all(attempts);
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await seatCount()).toBe(3);
  });

  // Guards the migration in scripts/backfill-slot-capacity.js: without capacity
  // the $expr compares against null and the slot is silently unbookable forever.
  it("cannot book a slot that has no capacity field (why the backfill exists)", async () => {
    await trainers.deleteMany({});
    await trainers.insertOne({
      _id: TRAINER_ID,
      slots: [{ _id: SLOT_ID, slotName: "Legacy", bookedMembers: [] }],
    });
    await expect(
      bookSlotAtomically({ trainerId: TRAINER_ID, slotId: SLOT_ID, email: "c@x.com", transactionId: "pi_4" })
    ).resolves.toBe(false);
  });

  it("records who booked and against which transaction", async () => {
    await seedSlot(2);
    await bookSlotAtomically({ trainerId: TRAINER_ID, slotId: SLOT_ID, email: "who@x.com", transactionId: "pi_who" });
    const doc = await trainers.findOne({ _id: TRAINER_ID });
    expect(doc.slots[0].bookedMembers[0]).toMatchObject({
      email: "who@x.com",
      transactionId: "pi_who",
    });
    expect(doc.slots[0].bookedMembers[0].bookedAt).toBeInstanceOf(Date);
  });
});
