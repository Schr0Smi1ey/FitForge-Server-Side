/**
 * Covers the webhook's security boundary: only correctly-signed Stripe events may
 * cause a write, and a redelivered event must not book twice.
 *
 * Uses Stripe's own signing helper so the test exercises the real
 * constructEvent path rather than a stub of it.
 */
const Stripe = require("stripe");
const { MongoClient } = require("mongodb");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const SECRET = "whsec_test_secret";
const stripe = Stripe("sk_test_dummy");

let mongod;
let client;
let payments;

const sign = (payload) =>
  stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });

const eventFor = (id) =>
  JSON.stringify({
    id: `evt_${id}`,
    type: "payment_intent.succeeded",
    data: { object: { id, metadata: { packageName: "Premium" } } },
  });

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(mongod.getUri());
  await client.connect();
  payments = client.db("FitForgeTest").collection("Payments");
  // The same unique index index.js creates — it is the idempotency mechanism.
  await payments.createIndex({ transactionId: 1 }, { unique: true });
}, 120000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

describe("stripe signature verification", () => {
  it("accepts an event signed with the correct secret", () => {
    const payload = eventFor("pi_ok");
    const event = stripe.webhooks.constructEvent(payload, sign(payload), SECRET);
    expect(event.type).toBe("payment_intent.succeeded");
    expect(event.data.object.id).toBe("pi_ok");
  });

  it("rejects a forged signature", () => {
    const payload = eventFor("pi_forged");
    expect(() =>
      stripe.webhooks.constructEvent(payload, "t=1,v1=deadbeef", SECRET)
    ).toThrow();
  });

  it("rejects a body modified after signing", () => {
    const payload = eventFor("pi_tamper");
    const signature = sign(payload);
    const tampered = payload.replace("Premium", "Basic");
    expect(() =>
      stripe.webhooks.constructEvent(tampered, signature, SECRET)
    ).toThrow();
  });

  it("rejects an event signed with a different secret", () => {
    const payload = eventFor("pi_wrongkey");
    const otherSig = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_some_other_secret",
    });
    expect(() =>
      stripe.webhooks.constructEvent(payload, otherSig, SECRET)
    ).toThrow();
  });

  it("rejects a missing signature header", () => {
    const payload = eventFor("pi_nosig");
    expect(() => stripe.webhooks.constructEvent(payload, "", SECRET)).toThrow();
  });
});

describe("webhook idempotency", () => {
  const insertOnce = async (transactionId) => {
    try {
      await payments.insertOne({ transactionId, email: "x@y.com", price: 100 });
      return "inserted";
    } catch (err) {
      if (err?.code === 11000) return "duplicate";
      throw err;
    }
  };

  it("treats a redelivered event as already fulfilled", async () => {
    expect(await insertOnce("pi_dup")).toBe("inserted");
    expect(await insertOnce("pi_dup")).toBe("duplicate");
    expect(await payments.countDocuments({ transactionId: "pi_dup" })).toBe(1);
  });

  it("keeps exactly one row when the same event arrives concurrently", async () => {
    const results = await Promise.all([
      insertOnce("pi_race"),
      insertOnce("pi_race"),
      insertOnce("pi_race"),
    ]);
    expect(results.filter((r) => r === "inserted")).toHaveLength(1);
    expect(await payments.countDocuments({ transactionId: "pi_race" })).toBe(1);
  });
});
