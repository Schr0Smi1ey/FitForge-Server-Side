const express = require("express");
const { collections } = require("../config/db");
const { verifyToken, verifyAdmin } = require("../middleware/auth");

const router = express.Router();

router.post("/subscribers", async (req, res) => {
  const newSubscriber = req.body;
  const email = newSubscriber.email;
  const query = { email: email };
  const subscriber = await collections.subscribers.findOne(query);
  if (subscriber) {
    res.status(400).send("Subscriber already exists");
    return;
  }
  const result = await collections.subscribers.insertOne(newSubscriber);
  res.send(result);
});

router.get("/subscribers", verifyToken, verifyAdmin, async (req, res) => {
  const email = req.query.email;
  if (email !== req.decoded.email) {
    return res.status(403).send({
      message: "forbidden access",
    });
  }
  const cursor = collections.subscribers.find();
  const totalSubscribers =
    await collections.subscribers.estimatedDocumentCount();
  const result = await cursor.toArray();
  res.send({ totalSubscribers, result });
});

module.exports = router;
