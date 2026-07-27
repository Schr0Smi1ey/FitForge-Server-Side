# FitForge — API

[![CI](https://github.com/Schr0Smi1ey/FitForge-Server-Side/actions/workflows/ci.yml/badge.svg?branch=enhanced)](https://github.com/Schr0Smi1ey/FitForge-Server-Side/actions/workflows/ci.yml)

Express + MongoDB API for [FitForge](https://github.com/Schr0Smi1ey/FitForge-Client-Side), a
fitness platform where members book training slots with trainers and pay by card.

The interesting parts of this codebase are the payment and booking paths, so those
are documented in detail below: **payments are only recorded when Stripe confirms
them over a signed webhook**, and **slot booking cannot oversell a slot under
concurrent requests**.

---

## Contents

- [Architecture](#architecture)
- [Payment flow](#payment-flow)
- [Conflict-free slot booking](#conflict-free-slot-booking)
- [Auth model](#auth-model)
- [Endpoints](#endpoints)
- [Indexes](#indexes)
- [Setup](#setup)
- [Tests](#tests)
- [Benchmark](#benchmark)
- [Migrations](#migrations)

---

## Architecture

```
index.js                     bootstrap only: CORS → webhook → JSON parser → routers → error handlers
config/
  db.js                      Mongo client, collection handles, ensureIndexes()
  pricing.js                 canonical package prices (the only source of a charge amount)
  slots.js                   default slot capacity
middleware/
  auth.js                    verifyToken, verifyAdmin, verifyTrainer
  errorHandler.js            asyncHandler, 404, central error handler
lib/
  booking.js                 the atomic slot-booking update
  fulfillment.js             records a payment and books its slot
routes/
  *.routes.js                one router per resource
scripts/
  benchmark.js               measures the impact of the indexes
  backfill-slot-capacity.js  one-time migration
```

`index.js` is ~66 lines. There is deliberately no `controllers/` layer — at this
size it adds indirection without separating anything genuinely entangled.

### One ordering rule that matters

```js
app.use("/", require("./routes/webhook.routes")); // MUST be above express.json()
app.use(express.json());
```

Stripe signature verification needs the **raw, unparsed** body. Express applies
middleware in registration order, so a global JSON parser mounted above the
webhook would consume the body and make every signature check fail. Swapping
these two lines breaks payments while every individual route still looks fine.

---

## Payment flow

The client never tells the server that a payment succeeded — Stripe does.

```
Client                         API                            Stripe
  │                             │                               │
  │ POST /create-payment-intent │                               │
  │  { packageName,             │                               │
  │    trainerId, slotId }      │                               │
  ├────────────────────────────►│                               │
  │                             │ amount looked up from         │
  │                             │ config/pricing.js — NEVER     │
  │                             │ from the request body         │
  │                             │                               │
  │                             │ paymentIntents.create({       │
  │                             │   amount,                     │
  │                             │   metadata: { trainerId,      │
  │                             │     slotId, email,            │
  │                             │     packageName }})           │
  │                             ├──────────────────────────────►│
  │        clientSecret         │                               │
  │◄────────────────────────────┤                               │
  │                             │                               │
  │  confirmCardPayment(clientSecret)                           │
  ├────────────────────────────────────────────────────────────►│
  │                             │                               │
  │                             │   POST /webhook               │
  │                             │   payment_intent.succeeded    │
  │                             │◄──────────────────────────────┤
  │                             │ constructEvent() verifies the │
  │                             │ signature, else 400 and NO    │
  │                             │ database write                │
  │                             │                               │
  │                             │ fulfillBooking(metadata):     │
  │                             │   insert payment (unique      │
  │                             │     transactionId = the       │
  │                             │     idempotency gate)         │
  │                             │   book the slot atomically    │
  │                             │                               │
  │ POST /payments (poll)       │                               │
  ├────────────────────────────►│ read-only: has the webhook    │
  │  { fulfilled: true|false }  │ landed yet?                   │
  │◄────────────────────────────┤                               │
```

Three properties this buys:

1. **The charge amount cannot be tampered with.** `/create-payment-intent` takes a
   `packageName` and looks the price up in `config/pricing.js`. It previously
   computed `parseInt(price * 100)` straight from the request body, so anyone could
   pay $0.01 for a $100 package.
2. **A booking cannot exist without a real payment.** Fulfilment happens only in the
   webhook handler, after `stripe.webhooks.constructEvent` verifies the signature.
3. **Redelivery is safe.** Stripe retries until it gets a 2xx and may deliver the
   same event twice. The unique index on `Payments.transactionId` is the gate: the
   insert is attempted first, and a duplicate-key error means "already fulfilled",
   so the slot is not booked twice.

Prices live in cents because Stripe's API takes an integer minor-unit amount, and
because `10.10 * 100` is `1009.9999…` in floating point — which would silently
undercharge.

---

## Conflict-free slot booking

Two members clicking "book" on the last seat at the same moment must not both
succeed. The capacity check therefore lives in the update's **filter**, which
MongoDB evaluates while holding the document lock, rather than in a read followed
by a write.

```js
await trainers.updateOne(
  {
    _id: trainerObjId,
    slots: {
      $elemMatch: {
        _id: slotObjId,
        capacity,                                       // compare-and-swap
        "bookedMembers.email": { $ne: email },          // no double-booking
        [`bookedMembers.${capacity - 1}`]: { $exists: false }, // still has room
      },
    },
  },
  { $push: { "slots.$[slot].bookedMembers": { email, transactionId, bookedAt: new Date() } } },
  { arrayFilters: [{ "slot._id": slotObjId }] }
);
```

**Why not `$expr` with `$size`?** The obvious formulation is
`$expr: { $lt: [{ $size: "$bookedMembers" }, "$capacity"] }`, but MongoDB rejects it
inside `$elemMatch` with *"$expr can only be applied to the top-level document"*.
This version instead uses the fact that the array path `bookedMembers.N` exists if
and only if the array is longer than `N` — so requiring `bookedMembers.<capacity-1>`
to be **absent** expresses "shorter than capacity" using a plain query operator the
filter can evaluate atomically.

`capacity` is read first only to build that path, and is also matched in the filter,
making the update a compare-and-swap: if a trainer changed the capacity in between,
nothing matches and the booking reports failure rather than booking against a stale
limit.

A slot with no numeric `capacity` can never match, so it would be silently
unbookable — see [Migrations](#migrations).

This is covered by `__tests__/booking.test.js`, which fires 20 concurrent bookings
at a 3-seat slot and asserts exactly 3 succeed, against a real in-memory MongoDB
replica set. A race cannot be demonstrated with mocks.

---

## Auth model

Header-based JWT. There are no cookies — `cookie-parser` was removed because no
route ever read `req.cookies`.

| Guard | Checks |
| --- | --- |
| `verifyToken` | `Authorization: Bearer <jwt>` verifies against `ACCESS_TOKEN_SECRET`; sets `req.decoded` |
| `verifyAdmin` | `verifyToken` first, then the user's `role` is `admin` |
| `verifyTrainer` | `verifyToken` first, then the user's `role` is `trainer` |

Routes that return a specific user's data also check ownership
(`req.query.email === req.decoded.email`), because a valid token proves who you are,
not that the row is yours.

> **Known gap:** the unique index on `Users.email` is case-**sensitive**, while the
> role guards look users up with a case-**insensitive** regex. `A@x.com` and
> `a@x.com` could therefore both exist and both satisfy those guards. Closing it
> needs a collation-strength-2 index plus normalising the existing rows.

---

## Endpoints

30 routes. `T` = requires a valid token, `A` = admin, `Tr` = trainer.

| Method | Path | Guard | Purpose |
| --- | --- | --- | --- |
| GET | `/` | — | Health check |
| POST | `/jwt` | — | Issue a JWT |
| GET | `/isAdmin` | T | Is the caller an admin |
| POST | `/users` | — | Create a user on first sign-in |
| GET | `/user` | T | The caller's own record |
| GET | `/posterInfo` | — | Author details for a forum post |
| GET | `/classes` | — | List classes (paginated, searchable) |
| POST | `/classes` | T + A | Create a class |
| GET | `/forums` | — | List forum posts |
| POST | `/forums` | T | Create a forum post |
| PATCH | `/voteForums` | T | Up/down-vote a post |
| GET | `/trainers` | — | List approved trainers |
| POST | `/trainers` | T | Apply to become a trainer |
| GET | `/trainer-details/:id` | — | One trainer with slots |
| GET | `/appliedTrainers` | T + A | Pending applications |
| GET | `/appliedTrainerInfo` | T | One application |
| PATCH | `/handleApplication` | T + A | Accept / reject an application |
| GET | `/book-trainer` | T | Data for the booking screen |
| GET | `/booked-trainers` | T | The caller's bookings |
| POST | `/add-slot` | T + Tr | Add a slot (sets `capacity`) |
| GET | `/slot` | T + Tr | The trainer's own slots |
| DELETE | `/slot` | T + Tr | Remove a slot |
| GET | `/reviews` | — | List reviews |
| POST | `/reviews` | T | Leave a review |
| POST | `/create-payment-intent` | T | Start a payment (amount from the server) |
| POST | `/payments` | T | **Read-only.** Has the webhook fulfilled this yet |
| GET | `/payments` | T + A | Payment records |
| POST | `/webhook` | Stripe signature | **The only writer of payments/bookings** |
| GET | `/subscribers` | T + A | Newsletter subscribers |
| POST | `/subscribers` | — | Subscribe |
| GET | `/admin-stats` | T + A | Dashboard aggregations |

---

## Indexes

Created on boot by `ensureIndexes()` in `config/db.js`. It is deliberately
non-fatal: if it were allowed to throw, a momentarily unreachable database at boot
would stop every route from registering and the whole API would 404.

| Index | Why |
| --- | --- |
| `Payments.transactionId` (unique) | **Not an optimisation** — this is the webhook's idempotency mechanism |
| `Users.email` (unique) | Prevents two accounts sharing an email |
| `Trainers.userId` | Trainer lookup by owning user |
| `Payments.email + date desc` | Backs "my payments, newest first" |

### `CRITICAL: could not ensure indexes … querySrv ECONNREFUSED`

This is a **local DNS fault, not an Atlas or credentials problem**, and it takes
down every database call — not just index creation.

A `mongodb+srv://` URI requires SRV and TXT lookups, and the driver resolves those
through Node's bundled c-ares resolver rather than the OS resolver used by
`dns.lookup()` and ordinary connections. On some Windows machines c-ares cannot
enumerate the system DNS servers and quietly defaults to `127.0.0.1`; with no
local DNS server listening, every SRV query is refused. The giveaway is that
`nslookup` succeeds while Node fails:

```bash
nslookup -type=SRV _mongodb._tcp.<cluster>.mongodb.net      # works
node -e "require('dns').resolveSrv('_mongodb._tcp.<cluster>.mongodb.net',console.log)"   # ECONNREFUSED
node -e "console.log(require('dns').getServers())"          # [ '127.0.0.1' ]  <-- the bug
```

Fix: set `DNS_SERVERS` in `.env` to a resolver that works (your router's IP, or
`1.1.1.1`). `config/db.js` applies it via `dns.setServers()` at startup.

---

## Setup

```bash
git clone https://github.com/Schr0Smi1ey/FitForge-Server-Side.git
cd FitForge-Server-Side
npm install
cp .env.example .env      # then fill in the values
npm start                 # http://localhost:3000
```

`.env` values — see `.env.example` for the full list:

| Variable | Notes |
| --- | --- |
| `DB_USER`, `DB_PASS` | MongoDB Atlas credentials |
| `MONGODB_URI` | Optional. Overrides the Atlas string; used by tests and local runs |
| `DNS_SERVERS` | Optional, machine-specific. Only for `querySrv ECONNREFUSED` at boot — see below |
| `ACCESS_TOKEN_SECRET` | Signs the JWTs issued by `POST /jwt` |
| `STRIPE_SECRET_KEY` | Use the `sk_test_…` key outside production |
| `STRIPE_WEBHOOK_SECRET` | **Bookings silently stop without this** — see below |

### Stripe webhook (required — bookings do not work without it)

Since `/payments` no longer writes, a missing webhook means Stripe charges the card
and **no booking is ever recorded**. The route returns 500 and logs loudly rather
than accepting unverified events.

Local development:

```bash
stripe listen --forward-to localhost:3000/webhook   # prints a whsec_… for this session
stripe trigger payment_intent.succeeded
```

Production: Stripe Dashboard → Developers → Webhooks → add an endpoint at
`https://<your-deployment>/webhook` subscribed to `payment_intent.succeeded`, then
copy its **signing secret**. This is a different value from the CLI one.

---

## Tests

```bash
npm test
```

36 tests across pricing, booking, webhook signatures, auth and dashboard
aggregations. No database service is needed — `mongodb-memory-server` runs a real
`mongod` in-process, so the booking specs exercise genuine server behaviour rather
than a mock.

The concurrency guarantee is mutation-tested: deleting the capacity predicate from
`lib/booking.js` makes three specs fail, so the test is a real guarantee rather than
one that passes vacuously.

---

## Benchmark

```bash
npm run benchmark              # 50k docs, in-memory
npm run benchmark -- --docs 200000
```

Seeds a throwaway database and times each query with and without the index on
identical data. It seeds its own rather than using production, because measuring
the "before" case means running without an index the live app depends on.

Measured on 50,000 payments, median of 7 runs:

| Query | No index | Indexed | Change |
| --- | --- | --- | --- |
| Dashboard: user payment history | 34.00 ms | 1.57 ms | 95.4% faster |
| Webhook: lookup by `transactionId` | 24.30 ms | 0.62 ms | 97.5% faster |
| Admin: revenue by tier (aggregate) | 24.48 ms | 22.48 ms | 8.2% faster |

The last row barely moves and is reported anyway: a `$group` over the whole
collection is a full scan by design and these indexes cannot help it. The script
also asserts via `explain()` that the planner uses an `IXSCAN`, so the gain is
attributable to the index rather than to a warm cache.

---

## Migrations

```bash
node scripts/backfill-slot-capacity.js           # dry run, no writes
node scripts/backfill-slot-capacity.js --apply
```

Gives every pre-existing slot a `capacity` and a `bookedMembers` array. Required
before the atomic booking filter can work: a slot missing either field never
matches, so it would be permanently unbookable. The default is at least the largest
existing booking count, so no existing booking ends up in an over-capacity slot.

---

## CI

`.github/workflows/ci.yml` runs lint then tests on Node 20 and 22 for every push
and pull request. `npm ci` is used rather than `npm install`, so lockfile drift
fails the build instead of being silently rewritten.
