const { MongoClient, ServerApiVersion } = require("mongodb");

// MONGODB_URI wins when set, so tests and local runs can point at another cluster
// (or an in-memory server) without editing this file. Falls back to the Atlas SRV
// string built from DB_USER/DB_PASS.
const uri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@schr0smi1ey.iioky.mongodb.net/?retryWrites=true&w=majority&appName=Schr0Smi1ey`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const database = client.db("FitForge");

const collections = {
  users: database.collection("Users"),
  subscribers: database.collection("NewsLetterSubscribers"),
  classes: database.collection("Classes"),
  forums: database.collection("Forums"),
  trainers: database.collection("Trainers"),
  appliedTrainers: database.collection("AppliedTrainers"),
  payments: database.collection("Payments"),
  reviews: database.collection("Reviews"),
};

/**
 * Creates the indexes the app depends on. Deliberately non-fatal: if this is
 * allowed to throw, a momentarily unreachable database at boot stops every route
 * from registering and the whole API 404s. Log loudly and keep serving instead.
 *
 * createIndex is idempotent, so running it on every boot is safe.
 */
async function ensureIndexes() {
  try {
    await Promise.all([
      // Not an optimisation — this unique index IS the Stripe webhook's
      // idempotency mechanism. Without it a redelivered event would insert a
      // second payment and book the slot twice.
      collections.payments.createIndex(
        { transactionId: 1 },
        { unique: true, name: "uniq_transactionId" }
      ),
      // Emails identify users everywhere in this app; the unique constraint is
      // what actually prevents two accounts sharing one.
      // Known gap: this index is case-SENSITIVE, while verifyAdmin/verifyTrainer
      // look users up with a case-insensitive regex. "A@x.com" and "a@x.com" can
      // therefore both exist and would both match those guards. Closing it needs
      // a collation-strength-2 index plus normalising the existing rows, so it is
      // left as a deliberate follow-up.
      collections.users.createIndex(
        { email: 1 },
        { unique: true, name: "uniq_email" }
      ),
      collections.trainers.createIndex({ userId: 1 }, { name: "idx_userId" }),
      // Backs the "my payments, newest first" dashboard query.
      collections.payments.createIndex(
        { email: 1, date: -1 },
        { name: "idx_email_date" }
      ),
    ]);
  } catch (err) {
    console.error(
      "CRITICAL: could not ensure indexes — webhook idempotency and uniqueness " +
        "constraints are NOT guaranteed until this succeeds:",
      err.message
    );
  }
}

module.exports = { client, database, collections, ensureIndexes };
