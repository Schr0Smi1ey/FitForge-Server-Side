/**
 * Measures what the Phase 4 indexes actually buy.
 *
 * Runs against a THROWAWAY database seeded with synthetic payments, never
 * production: measuring index impact requires running the query without the
 * index first, which would mean dropping an index the live app depends on.
 *
 * Each query is timed with and without the index, on identical data, so the
 * numbers are a real before/after rather than an estimate.
 *
 *   node scripts/benchmark.js               # 50k docs, in-memory MongoDB
 *   node scripts/benchmark.js --docs 200000
 *   node scripts/benchmark.js --uri "mongodb://..."   # against a real cluster
 */
const { MongoClient } = require("mongodb");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const DOCS = parseInt(arg("--docs", "50000"), 10);
const RUNS = parseInt(arg("--runs", "7"), 10);
const EXPLICIT_URI = arg("--uri", null);
const DB_NAME = "FitForgeBenchmark";
const TIERS = [
  { packageName: "Basic", price: 10 },
  { packageName: "Standard", price: 50 },
  { packageName: "Premium", price: 100 },
];

/** Runs fn RUNS times and returns the median, which ignores one-off stalls. */
async function median(fn) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const pct = (before, after) =>
  before === 0 ? "n/a" : `${(((before - after) / before) * 100).toFixed(1)}% faster`;

(async () => {
  let uri = EXPLICIT_URI;
  let memory;
  if (!uri) {
    const { MongoMemoryReplSet } = require("mongodb-memory-server");
    console.log("starting in-memory MongoDB…");
    memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = memory.getUri();
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);
  const payments = db.collection("Payments");
  await payments.drop().catch(() => {}); // fine if it doesn't exist yet

  console.log(`seeding ${DOCS.toLocaleString()} payments…`);
  const BATCH = 10000;
  for (let i = 0; i < DOCS; i += BATCH) {
    const batch = [];
    for (let j = 0; j < Math.min(BATCH, DOCS - i); j++) {
      const n = i + j;
      const tier = TIERS[n % TIERS.length];
      batch.push({
        email: `user${n % 5000}@example.com`,
        price: tier.price,
        packageName: tier.packageName,
        transactionId: `pi_bench_${n}`,
        date: new Date(Date.now() - n * 60000).toISOString(),
      });
    }
    await payments.insertMany(batch, { ordered: false });
  }

  // The query the member dashboard runs: this user's payments, newest first.
  const userHistory = () =>
    payments.find({ email: "user42@example.com" }).sort({ date: -1 }).limit(20).toArray();
  // The admin revenue-by-tier aggregation.
  const revenue = () =>
    payments
      .aggregate([
        { $group: { _id: "$packageName", total: { $sum: "$price" }, count: { $sum: 1 } } },
      ])
      .toArray();
  const byTransaction = () => payments.findOne({ transactionId: `pi_bench_${DOCS - 1}` });

  console.log(`\nmedian of ${RUNS} runs, ${DOCS.toLocaleString()} documents\n`);

  const before = {
    userHistory: await median(userHistory),
    revenue: await median(revenue),
    byTransaction: await median(byTransaction),
  };

  console.log("creating indexes…");
  await payments.createIndex({ email: 1, date: -1 }, { name: "idx_email_date" });
  await payments.createIndex({ transactionId: 1 }, { unique: true, name: "uniq_transactionId" });

  const after = {
    userHistory: await median(userHistory),
    revenue: await median(revenue),
    byTransaction: await median(byTransaction),
  };

  const rows = [
    ["query", "no index", "indexed", "change"],
    ["dashboard: user payment history", before.userHistory, after.userHistory],
    ["webhook: lookup by transactionId", before.byTransaction, after.byTransaction],
    ["admin: revenue by tier (aggregate)", before.revenue, after.revenue],
  ];
  console.log("");
  for (const r of rows) {
    if (typeof r[1] === "string") {
      console.log(r[0].padEnd(36) + r[1].padStart(10) + r[2].padStart(10) + "   " + r[3]);
      console.log("-".repeat(76));
    } else {
      console.log(
        r[0].padEnd(36) +
          `${r[1].toFixed(2)}ms`.padStart(10) +
          `${r[2].toFixed(2)}ms`.padStart(10) +
          "   " +
          pct(r[1], r[2])
      );
    }
  }

  // Confirm the planner actually uses the index rather than just being faster by luck.
  const plan = await payments
    .find({ email: "user42@example.com" })
    .sort({ date: -1 })
    .explain("queryPlanner");
  const stage = JSON.stringify(plan.queryPlanner?.winningPlan || {});
  console.log(
    `\nplanner uses index for the dashboard query: ${stage.includes("IXSCAN") ? "yes (IXSCAN)" : "NO (COLLSCAN)"}`
  );
  console.log(
    "note: revenue-by-tier scans every payment by design — a $group over the whole\n" +
      "collection cannot use these indexes, which is why its timing barely moves."
  );

  await payments.drop().catch(() => {});
  await client.close();
  await memory?.stop();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
