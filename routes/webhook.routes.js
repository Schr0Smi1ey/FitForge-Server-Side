const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { fulfillBooking } = require("../lib/fulfillment");

const router = express.Router();

/**
 * IMPORTANT: this router must be mounted BEFORE express.json() in index.js.
 *
 * Stripe signature verification needs the raw, unparsed body, and Express applies
 * middleware in registration order — a global JSON parser mounted above this
 * would consume the body and make every signature check fail. That is the classic
 * way this integration breaks, and it fails silently in the sense that the
 * endpoint still responds, just always with a signature error.
 */
// Carries its full path and mounts at the root, matching every other router here.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      // Fail loudly rather than accepting unverified events.
      console.error(
        "STRIPE_WEBHOOK_SECRET is not set — refusing to process webhooks"
      );
      return res.status(500).send({ message: "Webhook not configured" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        secret
      );
    } catch (err) {
      // Bad or absent signature: this did not come from Stripe. Touch nothing.
      // Worth logging — a burst here means either a misconfigured secret or
      // someone probing the endpoint.
      console.error("webhook: signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      try {
        const { duplicate } = await fulfillBooking({
          transactionId: intent.id,
          metadata: intent.metadata,
        });
        console.log(
          duplicate
            ? `webhook: ${intent.id} already fulfilled, ignoring redelivery`
            : `webhook: booked ${intent.id}`
        );
      } catch (err) {
        console.error(
          `webhook: fulfillment failed for ${intent.id}:`,
          err.message
        );
        // 5xx tells Stripe to retry, so a transient DB failure isn't a lost booking.
        return res.status(500).send({ message: "Fulfillment failed" });
      }
    }

    // 200 for every other event type too, otherwise Stripe retries them forever.
    res.status(200).send({ received: true });
  }
);

module.exports = router;
