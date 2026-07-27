const express = require("express");
const { ObjectId } = require("mongodb");
const { collections } = require("../config/db");
const { verifyToken, verifyAdmin, verifyTrainer } = require("../middleware/auth");
const { DEFAULT_SLOT_CAPACITY } = require("../config/slots");

const router = express.Router();

router.post("/trainers", verifyToken, async (req, res) => {
  try {
    const trainerData = req.body;
    if (req.decoded.email !== trainerData.email) {
      return res.status(403).send({ message: "forbidden access" });
    }
    const user = await collections.users.findOne({
      email: { $regex: new RegExp(`^${trainerData.email}$`, "i") },
    });
    if (!user) {
      return res.send({ error: "User not found" });
    }
    trainerData.userId = user._id;
    const trainer = await collections.trainers.findOne({ userId: user._id });
    if (trainer) {
      const appliedTrainerDocs = await collections.appliedTrainers
        .find({ userId: user._id })
        .toArray();
      const pendingApplication = appliedTrainerDocs.find(
        (app) => app.status === "pending"
      );
      if (pendingApplication) {
        return res.send({
          error: "Your application is still in progress!",
        });
      }
      if (user.role === "trainer") {
        return res.send({
          error: "You are already a trainer with FitForge!",
        });
      }
    }
    const trainerInsertResult = await collections.trainers.insertOne(
      trainerData
    );
    const trainerId = trainerInsertResult.insertedId;
    const appliedTrainer = {
      userId: user._id,
      applicationId: trainerId,
      status: "pending",
      applyDate: trainerData.applyDate,
      feedback: "",
    };

    const appliedTrainerInsertResult =
      await collections.appliedTrainers.insertOne(appliedTrainer);

    res.status(201).json({
      message: "Trainer application submitted successfully",
      trainerId,
      applicationId: appliedTrainerInsertResult.insertedId,
    });
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/trainers", async (req, res) => {
  try {
    const trainers = await collections.trainers
      .aggregate([
        {
          $lookup: {
            from: "Users",
            localField: "userId",
            foreignField: "_id",
            as: "users",
          },
        },
        {
          $match: { "users.role": "trainer" },
        },
      ])
      .toArray();
    res.send(trainers);
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

router.get("/appliedTrainers", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const email = req.query.email;
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: "forbidden access" });
    }
    const appliedTrainers = await collections.appliedTrainers
      .find({ status: "pending" })
      .sort({ applyDate: -1 })
      .toArray();
    if (!appliedTrainers.length) {
      return res.send([]);
    }
    const userIds = appliedTrainers.map((trainer) => trainer.userId);
    const applicationIds = appliedTrainers.map(
      (trainer) => trainer.applicationId
    );
    const users = await collections.users
      .find({ _id: { $in: userIds } })
      .toArray();

    const trainers = await collections.trainers
      .find({ _id: { $in: applicationIds } })
      .toArray();
    const userMap = users.reduce((acc, user) => {
      acc[user._id] = user;
      return acc;
    }, {});

    const trainerMap = trainers.reduce((acc, trainer) => {
      acc[trainer._id] = trainer;
      return acc;
    }, {});

    const response = appliedTrainers.map((appliedTrainer) => ({
      user: userMap[appliedTrainer.userId] || null,
      trainer: trainerMap[appliedTrainer.applicationId] || null,
      status: appliedTrainer.status,
      feedback: appliedTrainer.feedback,
    }));
    return res.send(response);
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

router.get("/appliedTrainerInfo", verifyToken, async (req, res) => {
  const applicantEmail = req.query.email;
  const user = await collections.users.findOne({
    email: { $regex: new RegExp(`^${applicantEmail}$`, "i") },
  });
  const appliedTrainer = await collections.appliedTrainers
    .find({ userId: user._id })
    .sort({ applyDate: -1 })
    .toArray();
  if (!appliedTrainer.length) {
    return res.send({ error: "No application found" });
  }
  const trainer = await collections.trainers.findOne({
    _id: appliedTrainer[0].applicationId,
  });
  return res.send([
    {
      user,
      trainer,
      appliedTrainer,
    },
  ]);
});

router.patch(
  "/handleApplication",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { status, applicationId, userId, feedback, email } = req.body;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const appId = new ObjectId(applicationId);
      const userObjId = new ObjectId(userId);
      const resultAppliedTrainer =
        await collections.appliedTrainers.updateOne(
          { applicationId: appId },
          {
            $set: {
              status,
              feedback:
                status === "rejected" || status === "cancelled"
                  ? feedback
                  : "",
            },
          }
        );
      if (status === "rejected" || status === "cancelled") {
        const deleteTrainer = await collections.trainers.deleteOne({
          _id: appId,
        });
        const resultUser = await collections.users.updateOne(
          { _id: userObjId },
          { $set: { role: "member" } }
        );
        return res
          .status(200)
          .send({ resultAppliedTrainer, deleteTrainer, resultUser });
      }

      if (status === "accepted") {
        const resultUser = await collections.users.updateOne(
          { _id: userObjId },
          { $set: { role: "trainer" } }
        );

        return res.status(200).send({ resultAppliedTrainer, resultUser });
      }
      return res.status(200).send({ resultAppliedTrainer });
    } catch (error) {
      // Swallowing this made server-side failures invisible in the logs.
      console.error(`${req.method} ${req.originalUrl} failed:`, error);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  }
);

router.get("/trainer-details/:id", async (req, res) => {
  const trainerId = req.params.id;
  const trainer = await collections.trainers.findOne({
    _id: new ObjectId(trainerId),
  });
  const user = await collections.users.findOne({ _id: trainer.userId });
  const result = await collections.trainers
    .aggregate([
      {
        $match: { _id: new ObjectId(trainerId) },
      },
      {
        $unwind: "$slots",
      },
      {
        $set: {
          "slots.selectedClass": {
            $toObjectId: "$slots.selectedClass",
          },
        },
      },
      {
        $lookup: {
          from: "Classes",
          localField: "slots.selectedClass",
          foreignField: "_id",
          as: "classInfo",
        },
      },
      {
        $unwind: {
          path: "$classInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $set: {
          "slots.selectedClass": "$classInfo.title",
        },
      },
      {
        $group: {
          _id: "$_id",
          slots: { $push: "$slots" },
        },
      },
      {
        $project: {
          _id: 0,
          slots: 1,
        },
      },
    ])
    .toArray();
  trainer.slots = result.length > 0 ? result[0].slots : [];
  res.send({ trainer, user });
});

router.get("/book-trainer", verifyToken, async (req, res) => {
  try {
    const trainerId = req.query.trainerId;
    const slotId = req.query.slotId;
    if (req.query.email && req.query.email !== req.decoded.email) {
      return res.status(403).send({ message: "forbidden access" });
    }
    if (!ObjectId.isValid(trainerId) || !ObjectId.isValid(slotId)) {
      return res.status(400).send({ message: "Invalid trainerId or slotId" });
    }
    const trainer = await collections.trainers.findOne({
      _id: new ObjectId(trainerId),
    });
    const trainerSlots = await collections.trainers.aggregate([
      {
        $match: {
          _id: new ObjectId(trainerId),
        },
      },
      {
        $unwind: "$slots",
      },
      {
        $match: { "slots._id": new ObjectId(slotId) },
      },
      {
        $set: {
          "slots.selectedClass": {
            $toObjectId: "$slots.selectedClass",
          },
        },
      },
      {
        $lookup: {
          from: "Classes",
          localField: "slots.selectedClass",
          foreignField: "_id",
          as: "classInfo",
        },
      },
      {
        $unwind: {
          path: "$classInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $set: {
          "slots.selectedClass": "$classInfo.title",
        },
      },
      {
        $group: {
          _id: "$_id",
          slots: { $push: "$slots" },
        },
      },
      {
        $project: {
          _id: 0,
          slots: 1,
        },
      },
    ]);
    const result = await trainerSlots.toArray();
    trainer.slots = result[0].slots;
    return res.send(trainer);
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/booked-trainers", verifyToken, async (req, res) => {
  try {
    const email = req.query.email;
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: "forbidden access" });
    }
    const payments = await collections.payments
      .aggregate([
        {
          $match: { email: email },
        },
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
      .toArray();
    res.send({ payments });
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/add-slot", verifyToken, verifyTrainer, async (req, res) => {
  try {
    const { trainerId, slot } = req.body;
    const email = req.query.email;
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: "forbidden access" });
    }
    const trainer = await collections.trainers.findOne({
      _id: new ObjectId(trainerId),
    });

    // These all used to reply 200 with an { error } body, so the client saw a
    // success status for a failed request.
    if (!trainer) {
      return res.status(404).send({ message: "Trainer not found" });
    }

    if (!trainer.classDuration || slot.slotTime > trainer.classDuration) {
      return res.status(400).send({
        message: "Slot time cannot be greater than class duration",
      });
    }
    const canTake = await collections.classes.findOne({
      _id: new ObjectId(slot.selectedClass),
    });
    if (!canTake) {
      return res.status(404).send({ message: "Selected class not found" });
    }
    if (canTake.trainers.length >= 5) {
      return res
        .status(409)
        .send({ message: "Already 5 trainers are assigned!" });
    }
    if (!canTake.trainers.includes(trainerId)) {
      const result = await collections.classes.updateOne(
        { _id: new ObjectId(slot.selectedClass) },
        {
          $push: { trainers: trainerId },
        }
      );
      if (result.modifiedCount === 0) {
        return res
          .status(500)
          .send({ error: "Failed to add slot in class" });
      }
    }

    const slotId = new ObjectId();
    slot._id = slotId;
    // Every slot needs a numeric capacity and an initialised bookedMembers
    // array: the atomic booking filter compares $size against $capacity, and
    // a missing field there compares against null and never matches, which
    // would make the slot permanently unbookable.
    const requestedCapacity = parseInt(slot.capacity, 10);
    slot.capacity =
      Number.isInteger(requestedCapacity) && requestedCapacity > 0
        ? requestedCapacity
        : DEFAULT_SLOT_CAPACITY;
    slot.bookedMembers = [];
    const updatedTrainer = await collections.trainers.updateOne(
      { _id: new ObjectId(trainerId) },
      {
        $push: { slots: slot },
        $set: {
          classDuration: trainer.classDuration - parseInt(slot.slotTime),
        },
      }
    );
    if (updatedTrainer.modifiedCount === 0) {
      return res.status(500).send({ error: "Failed to add slot" });
    }
    res.status(201).json({ success: "Slot added successfully" });
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    // Was `res.send(...)`, which returns HTTP 200 on an error path.
    console.error("POST /add-slot failed:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

router.get("/slot", verifyToken, verifyTrainer, async (req, res) => {
  try {
    const email = req.query.email;
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: "forbidden access" });
    }
    const user = await collections.users.findOne({
      email: { $regex: new RegExp(`^${email}$`, "i") },
    });

    const trainer = await collections.trainers.findOne({ userId: user._id });

    const trainerSlots = await collections.trainers.aggregate([
      {
        $match: { _id: trainer._id },
      },
      {
        $unwind: "$slots",
      },
      {
        $set: {
          "slots.selectedClass": {
            $toObjectId: "$slots.selectedClass",
          },
        },
      },
      {
        $lookup: {
          from: "Classes",
          localField: "slots.selectedClass",
          foreignField: "_id",
          as: "classInfo",
        },
      },
      {
        $unwind: {
          path: "$classInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $set: {
          "slots.selectedClass": "$classInfo.title",
        },
      },
      {
        $group: {
          _id: "$_id",
          slots: { $push: "$slots" },
        },
      },
      {
        $project: {
          _id: 0,
          slots: 1,
        },
      },
    ]);
    const result = await trainerSlots.toArray();
    const slots = result.length > 0 ? result[0].slots : [];
    res.send(slots);
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/slot", verifyToken, verifyTrainer, async (req, res) => {
  const { email, slotId } = req.query;
  if (email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  const user = await collections.users.findOne({
    email: { $regex: new RegExp(`^${email}$`, "i") },
  });
  const trainer = await collections.trainers.findOne({ userId: user._id });
  const slot = await collections.trainers.findOne({
    _id: trainer._id,
    "slots._id": new ObjectId(slotId),
  });
  const slotData = slot.slots[0];
  const updatedTrainer = await collections.trainers.updateOne(
    { _id: trainer._id },
    {
      $pull: { slots: { _id: new ObjectId(slotId) } },
      $set: {
        classDuration:
          trainer.classDuration + parseInt(slot.slots[0].slotTime),
      },
    }
  );
  const updateClass = await collections.classes.updateOne(
    { _id: new ObjectId(slotData.selectedClass) },
    {
      $pull: { trainers: trainer._id.toString() },
      $inc: { booked: -slotData.bookedMembers.length },
    }
  );
  if (
    updatedTrainer.modifiedCount === 0 ||
    updateClass.modifiedCount === 0
  ) {
    return res.status(500).json({ error: "Failed to delete slot" });
  }
  res.status(200).json({ success: "Slot deleted successfully" });
});

module.exports = router;
