const express = require("express");
const { collections } = require("../config/db");
const { verifyToken, verifyAdmin } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = express.Router();

router.post(
  "/classes",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const { name, image, details } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).send({ message: "Class name is required" });
    }
    const result = await collections.classes.insertOne({
      name,
      image,
      details,
      trainers: [],
      booked: 0,
    });
    res.send(result);
  })
);

router.get("/classes", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const skip = (page - 1) * limit;
    const home = req.query?.home;
    const search = req.query.search || "";
    const slotForm = req.query?.slotForm;
    const sortCondition = home
      ? { booked: -1, postedDate: -1 }
      : { postedDate: -1 };

    if (slotForm) {
      const classes = await collections.classes
        .find({}, { projection: { title: 1, _id: 1, duration: 1 } })
        .toArray();
      return res.send(classes);
    }
    let filter = {};
    if (search) {
      filter = { title: { $regex: `^${search}`, $options: "i" } };
    }

    const classes = await collections.classes
      .aggregate([
        { $match: filter },
        { $sort: sortCondition },
        { $skip: skip },
        { $limit: limit },
        {
          $addFields: {
            trainersObjectIds: {
              $map: {
                input: "$trainers",
                as: "trainerId",
                in: { $toObjectId: "$$trainerId" },
              },
            },
          },
        },
        {
          $lookup: {
            from: "Trainers",
            localField: "trainersObjectIds",
            foreignField: "_id",
            as: "trainerDetails",
          },
        },
        {
          $project: {
            trainersObjectIds: 0,
          },
        },
      ])
      .toArray();

    const totalClasses = await collections.classes.countDocuments(filter);
    return res.json({
      classes,
      totalPages: Math.max(Math.ceil(totalClasses / limit), 1),
      currentPage: page,
    });
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
