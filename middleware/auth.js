const jwt = require("jsonwebtoken");
const { collections } = require("../config/db");

const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

/** Builds a guard that admits only users holding the given role. */
const requireRole = (role) => async (req, res, next) => {
  try {
    const email = req.decoded.email;
    const user = await collections.users.findOne({
      email: { $regex: new RegExp(`^${email}$`, "i") },
    });
    if (user?.role !== role) {
      return res.status(403).send({ message: "forbidden access" });
    }
    next();
  } catch (err) {
    next(err);
  }
};

const verifyAdmin = requireRole("admin");
const verifyTrainer = requireRole("trainer");

module.exports = { verifyToken, verifyAdmin, verifyTrainer, requireRole };
