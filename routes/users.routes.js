const express = require("express");
const { collections } = require("../config/db");
const { verifyToken } = require("../middleware/auth");
const jwt = require("jsonwebtoken");

const router = express.Router();

router.post("/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "5h",
  });
  res.send({ token });
});

router.get("/isAdmin", verifyToken, async (req, res) => {
  const email = req.query.email;
  if (email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  const user = await collections.users.findOne({
    email: { $regex: new RegExp(`^${email}$`, "i") },
  });
  const isAdmin = user?.role === "admin";
  res.send({ isAdmin });
});

router.post("/users", async (req, res) => {
  const newUser = req.body;
  const user = await collections.users.findOne({
    email: { $regex: new RegExp(`^${newUser.email}$`, "i") },
  });
  if (user) {
    res.status(400).send("Email already registered!");
    return;
  }
  const result = await collections.users.insertOne(newUser);
  res.send(result);
});

router.get("/user", verifyToken, async (req, res) => {
  if (req.query.email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  const user = await collections.users.findOne({
    email: { $regex: new RegExp(`^${req.query.email}$`, "i") },
  });
  const role = req.query?.role;
  if (role) {
    if (role === "trainer") {
      const trainer = await collections.trainers.findOne({
        userId: user._id,
      });
      if (trainer) {
        return res.send({ user, trainer });
      }
    }
  }
  res.send({ user });
});

router.get("/posterInfo", async (req, res) => {
  const user = await collections.users.findOne({
    email: { $regex: new RegExp(`^${req.query.postedBy}$`, "i") },
  });
  res.send({ user });
});

module.exports = router;
