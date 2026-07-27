const express = require("express");
const { ObjectId } = require("mongodb");
const { collections } = require("../config/db");
const { verifyToken, verifyAdmin } = require("../middleware/auth");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { getPackagePriceCents } = require("../config/pricing");

const router = express.Router();

router.post("/create-payment-intent", verifyToken, async (req, res) => {
  // The amount is derived from the package name, never from the request body.
  // Trusting a client-sent `price` here let anyone charge themselves any amount.
  const { packageName, trainerId, slotId } = req.body;
  const amount = getPackagePriceCents(packageName);
  if (amount === null) {
    return res.status(400).send({ message: "Invalid package name" });
  }
  if (!ObjectId.isValid(trainerId) || !ObjectId.isValid(slotId)) {
    return res.status(400).send({ message: "Invalid trainerId or slotId" });
  }
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      payment_method_types: ["card"],
      // Everything the webhook needs to fulfil this booking travels with the
      // intent itself, so fulfilment never depends on a second call from the
      // client (which could lie, arrive late, or never arrive at all).
      // email comes from the verified JWT, not the body.
      metadata: {
        trainerId,
        slotId,
        email: req.decoded.email,
        packageName,
      },
    });
    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(500).send({ message: "Could not create payment intent" });
  }
});

router.post("/payments", verifyToken, async (req, res) => {
  const email = req.query.email;
  if (email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  const { transactionId } = req.body;
  if (!transactionId) {
    return res.status(400).send({ message: "transactionId is required" });
  }
  const payment = await collections.payments.findOne({ transactionId, email });
  res.send({
    // Webhooks are asynchronous, so "not yet" is a normal answer, not an error.
    fulfilled: Boolean(payment),
    payment: payment || null,
  });
});

router.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const email = req.query.email;
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: "forbidden access" });
    }
    const payments = await collections.payments
      .aggregate([
        {
          $lookup: {
            from: "Trainers",
            let: { trainerId: { $toObjectId: "$trainerId" } },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$trainerId"] } } },
            ],
            as: "trainerDetails",
          },
        },
        { $unwind: "$trainerDetails" },
        {
          $lookup: {
            from: "Classes",
            let: { classId: { $toObjectId: "$classId" } },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$classId"] } } },
            ],
            as: "classDetails",
          },
        },
        { $unwind: "$classDetails" },
        {
          $addFields: {
            slotDetails: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$trainerDetails.slots",
                    as: "slot",
                    cond: {
                      $eq: ["$$slot._id", { $toObjectId: "$slotId" }],
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        {
          $project: {
            trainerId: 0,
            slotId: 0,
            classId: 0,
            "trainerDetails.slots": 0,
          },
        },
      ])
      .sort({ date: -1 })
      .toArray();
    const uniqueMembers = await collections.payments
      .aggregate([
        {
          $group: {
            _id: "$email",
          },
        },
        {
          $count: "uniqueCount",
        },
      ])
      .toArray();
    const totalBalance = payments.reduce(
      (acc, payment) => acc + payment.price,
      0
    );
    const totalPaidMembers =
      uniqueMembers.length > 0 ? uniqueMembers[0].uniqueCount : 0;
    res.send({ totalPaidMembers, payments, totalBalance });
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
