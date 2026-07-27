/**
 * Verifies the dashboard aggregations against hand-calculated totals.
 *
 * Run on a real in-memory MongoDB rather than mocked, because the thing under
 * test IS the aggregation pipeline — a mock would only assert that we wrote the
 * pipeline we wrote.
 */
const { MongoClient } = require("mongodb");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

let mongod;
let client;
let payments;
let applied;

const revenueByTier = () =>
  payments
    .aggregate([
      { $group: { _id: "$packageName", total: { $sum: "$price" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ])
    .toArray();

const grandTotal = () =>
  payments
    .aggregate([
      { $group: { _id: null, revenue: { $sum: "$price" }, transactions: { $sum: 1 } } },
    ])
    .toArray();

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(mongod.getUri());
  await client.connect();
  payments = client.db("FitForgeTest").collection("Payments");
  applied = client.db("FitForgeTest").collection("AppliedTrainers");
}, 120000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await payments.deleteMany({});
  await applied.deleteMany({});
});

describe("revenue by tier", () => {
  it("sums each tier and matches a manual calculation", async () => {
    // Basic 10 x3 = 30 | Standard 50 x2 = 100 | Premium 100 x4 = 400
    await payments.insertMany([
      ...Array.from({ length: 3 }, (_, i) => ({ packageName: "Basic", price: 10, transactionId: `b${i}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ packageName: "Standard", price: 50, transactionId: `s${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ packageName: "Premium", price: 100, transactionId: `p${i}` })),
    ]);

    const rows = await revenueByTier();
    const byName = Object.fromEntries(rows.map((r) => [r._id, r]));

    expect(byName.Basic).toMatchObject({ total: 30, count: 3 });
    expect(byName.Standard).toMatchObject({ total: 100, count: 2 });
    expect(byName.Premium).toMatchObject({ total: 400, count: 4 });

    const [totals] = await grandTotal();
    expect(totals.revenue).toBe(530); // 30 + 100 + 400, calculated by hand
    expect(totals.transactions).toBe(9);
    // The per-tier figures must reconcile with the grand total, or the dashboard
    // would show a chart that doesn't add up to its own headline number.
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(totals.revenue);
  });

  it("sorts tiers by revenue, highest first", async () => {
    await payments.insertMany([
      { packageName: "Basic", price: 10, transactionId: "x1" },
      { packageName: "Premium", price: 100, transactionId: "x2" },
      { packageName: "Standard", price: 50, transactionId: "x3" },
    ]);
    const rows = await revenueByTier();
    expect(rows.map((r) => r._id)).toEqual(["Premium", "Standard", "Basic"]);
  });

  it("returns an empty list rather than failing when there are no payments", async () => {
    expect(await revenueByTier()).toEqual([]);
    expect(await grandTotal()).toEqual([]);
  });

  it("does not silently drop payments with no packageName", async () => {
    await payments.insertMany([
      { packageName: "Basic", price: 10, transactionId: "y1" },
      { price: 25, transactionId: "y2" }, // legacy row, no tier
    ]);
    const rows = await revenueByTier();
    const [totals] = await grandTotal();
    // The untagged row groups under null but must still count toward revenue,
    // otherwise the chart and the headline total disagree.
    expect(rows.some((r) => r._id === null || r._id === undefined)).toBe(true);
    expect(totals.revenue).toBe(35);
  });
});

describe("pending applications", () => {
  it("counts only applications still awaiting a decision", async () => {
    await applied.insertMany([
      { status: "pending" },
      { status: "pending" },
      { status: "accepted" },
      { status: "cancelled" },
      { status: "rejected" },
    ]);
    expect(await applied.countDocuments({ status: "pending" })).toBe(2);
  });

  it("reports zero when the queue is empty", async () => {
    await applied.insertMany([{ status: "accepted" }]);
    expect(await applied.countDocuments({ status: "pending" })).toBe(0);
  });
});
