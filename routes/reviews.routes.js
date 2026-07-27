const express = require("express");
const { collections } = require("../config/db");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/reviews", verifyToken, async (req, res) => {
  const email = req.query.email;
  if (email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  const newReview = req.body;
  newReview.email = email;
  const result = await collections.reviews.insertOne(newReview);
  res.send(result);
});

router.get("/reviews", async (req, res) => {
  const reviews = await collections.reviews
    .aggregate([
      {
        $lookup: {
          from: "Users",
          localField: "email",
          foreignField: "email",
          as: "userData",
        },
      },
    ])
    .toArray();
  res.send(reviews);
});

module.exports = router;
