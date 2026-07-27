/**
 * Wraps an async route so a rejected promise reaches Express's error handler.
 *
 * Express 4 does not await route handlers, so a throw inside one becomes an
 * unhandled rejection and the request hangs until the client times out — it does
 * not produce a 500. Every async route needs either this or its own try/catch.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Mounted after every route, since Express matches middleware in order. */
const notFound = (req, res) => {
  res.status(404).send({ message: "Not found" });
};

/**
 * Single error handler for the whole app. Express identifies it by its four
 * arguments, so `next` must stay even though it is unused.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  const status = err.status || 500;
  // Never leak a stack trace or driver message to the client.
  res.status(status).send({
    message: status === 500 ? "Internal server error" : err.message,
  });
};

module.exports = { asyncHandler, notFound, errorHandler };
