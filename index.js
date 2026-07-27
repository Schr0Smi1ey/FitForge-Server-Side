require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { ensureIndexes } = require("./config/db");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://fitforge-44b27.web.app",
      "https://fitforge-44b27.firebaseapp.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);

// ---------------------------------------------------------------------------
// Order below this line is load-bearing.
//
// The Stripe webhook must be mounted BEFORE express.json(). Signature
// verification needs the raw, unparsed body, and Express applies middleware in
// registration order — a global JSON parser mounted above the webhook would
// consume the body and make every signature check fail. Moving these two lines
// past each other breaks payments in a way no test of a single route will show.
// ---------------------------------------------------------------------------
app.use("/", require("./routes/webhook.routes"));

app.use(express.json());

// Routers keep their full original paths, so each mounts at the root.
app.use("/", require("./routes/root.routes"));
app.use("/", require("./routes/users.routes"));
app.use("/", require("./routes/classes.routes"));
app.use("/", require("./routes/forums.routes"));
app.use("/", require("./routes/trainers.routes"));
app.use("/", require("./routes/reviews.routes"));
app.use("/", require("./routes/payments.routes"));
app.use("/", require("./routes/newsletter.routes"));

// Both must come after every route: Express matches middleware in order, so
// mounted earlier these would shadow the routes above.
app.use(notFound);
app.use(errorHandler);

// Exposed so the test suite can await index creation before driving the app.
const ready = ensureIndexes();

// The Mongo client is deliberately never closed. This process is long-lived (and
// on Vercel the container is reused between invocations), so the driver's
// connection pool is meant to stay open for the lifetime of the process. Closing
// it would tear down the pool and force every later query to reconnect.

// Only listen when run directly, so tests can import `app` without binding a port.
if (require.main === module) {
  app.listen(port, () => {
    console.log("FitForge API is running on port " + port);
  });
}

module.exports = { app, ready };
