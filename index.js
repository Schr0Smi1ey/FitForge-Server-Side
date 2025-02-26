const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);
app.use(express.json());
app.use(cookieParser());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@schr0smi1ey.iioky.mongodb.net/?retryWrites=true&w=majority&appName=Schr0Smi1ey`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const database = client.db("FitForge");
const usersCollection = database.collection("Users");
const subscribersCollection = database.collection("NewsLetterSubscribers");
const classesCollection = database.collection("Classes");
const forumsCollection = database.collection("Forums");
const trainersCollection = database.collection("Trainers");
const appliedTrainersCollection = database.collection("AppliedTrainers");
const paymentsCollection = database.collection("Payments");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  console.log("verifyToken");
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({
    email: { $regex: new RegExp(`^${email}$`, "i") },
  });
  const isAdmin = user?.role === "admin";
  if (!isAdmin) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

const verifyTrainer = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await usersCollection.findOne({
    email: { $regex: new RegExp(`^${email}$`, "i") },
  });
  const isTrainer = user?.role === "trainer";
  if (!isTrainer) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

async function run() {
  try {
    app.get("/", (req, res) => {
      res.send("Welcome to the FitForge API");
    });

    // Auth related APIs
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });
    app.get("/isAdmin", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${email}$`, "i") },
      });
      const isAdmin = user?.role === "admin";
      console.log(isAdmin);
      res.send({ isAdmin });
    });
    // Users
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${newUser.email}$`, "i") },
      });
      if (user) {
        res.status(400).send("Email already registered!");
        return;
      }
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });
    app.get("/user", verifyToken, async (req, res) => {
      if (req.query.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${req.query.email}$`, "i") },
      });
      const role = req.query?.role;
      if (role) {
        if (role === "trainer") {
          const trainer = await trainersCollection.findOne({
            userId: user._id,
          });
          if (trainer) {
            return res.send({ user, trainer });
          }
        }
      }
      res.send({ user });
    });
    app.get("/posterInfo", async (req, res) => {
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${req.query.email}$`, "i") },
      });
      res.send({ user });
    });
    // Classes
    app.post("/classes", async (req, res) => {
      const newClass = req.body;
      console.log(newClass);
      const result = await classesCollection.insertOne(newClass);
      res.send(result);
    });
    app.get("/classes", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;
        const home = req.query?.home;
        const slotForm = req.query?.slotForm;
        const sortCondition = home
          ? { booked: -1, postedDate: -1 }
          : { postedDate: -1 };

        if (slotForm) {
          const classes = await classesCollection
            .find({}, { projection: { title: 1, _id: 1, duration: 1 } })
            .toArray();
          return res.send(classes);
        }

        const classes = await classesCollection
          .aggregate([
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

        const totalClasses = await classesCollection.countDocuments();
        return res.json({
          classes,
          totalPages: Math.ceil(totalClasses / limit),
          currentPage: page,
        });
      } catch (error) {
        console.error("Error fetching classes:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Forums
    //TODO: Not final yet
    app.post("/forums", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${email}$`, "i") },
      });
      if (user.role !== "admin" && user.role !== "trainer") {
        return res.status(403).send({ message: "forbidden access" });
      }
      const newForum = req.body;
      const result = await forumsCollection.insertOne(newForum);
      res.send(result);
    });
    //TODO: Not final yet
    app.get("/forums", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;

        const posts = await forumsCollection
          .find()
          .sort({ postedDate: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const totalPosts = await forumsCollection.countDocuments();

        return res.json({
          posts,
          totalPages: Math.ceil(totalPosts / limit),
          currentPage: page,
        });
      } catch (error) {
        console.error("Error fetching forums:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // TODO: Not final yet
    app.patch("/voteForums", async (req, res) => {
      const { forumId, vote } = req.body;
      console.log(forumId, vote);
      const post = await forumsCollection.findOne({
        _id: new ObjectId(forumId),
      });
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }
      const { totalUpVote, totalDownVote } = post;
      let updatedUpvotes = totalUpVote;
      let updatedDownvotes = totalDownVote;
      if (vote === "up") {
        updatedUpvotes += 1;
      } else if (vote === "down") {
        updatedDownvotes += 1;
      }
      const result = await forumsCollection.updateOne(
        { _id: new ObjectId(forumId) },
        {
          $set: {
            totalUpVote: updatedUpvotes,
            totalDownVote: updatedDownvotes,
          },
        }
      );
      return res.json(result);
    });
    // Trainers
    app.post("/trainers", verifyToken, async (req, res) => {
      try {
        const trainerData = req.body;
        console.log(trainerData);
        if (req.decoded.email !== trainerData.email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const user = await usersCollection.findOne({
          email: { $regex: new RegExp(`^${trainerData.email}$`, "i") },
        });
        console.log(user);
        if (!user) {
          return res.send({ error: "User not found" });
        }
        trainerData.userId = user._id;
        const trainer = await trainersCollection.findOne({ userId: user._id });
        if (trainer) {
          const appliedTrainerDocs = await appliedTrainersCollection
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
        const trainerInsertResult = await trainersCollection.insertOne(
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
          await appliedTrainersCollection.insertOne(appliedTrainer);

        res.status(201).json({
          message: "Trainer application submitted successfully",
          trainerId,
          applicationId: appliedTrainerInsertResult.insertedId,
        });
      } catch (error) {
        console.error("Error while processing trainer application", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    app.get("/trainers", async (req, res) => {
      try {
        const trainers = await trainersCollection
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
        res.status(500).send({ error: "Internal Server Error" });
      }
    });
    app.get("/appliedTrainers", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const appliedTrainers = await appliedTrainersCollection
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
        const users = await usersCollection
          .find({ _id: { $in: userIds } })
          .toArray();

        const trainers = await trainersCollection
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
        console.error("Error fetching applied trainers:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    app.get("/appliedTrainerInfo", verifyToken, async (req, res) => {
      const applicantEmail = req.query.email;
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${applicantEmail}$`, "i") },
      });
      const appliedTrainer = await appliedTrainersCollection
        .find({ userId: user._id })
        .sort({ applyDate: -1 })
        .toArray();
      if (!appliedTrainer.length) {
        return res.send({ error: "No application found" });
      }
      const trainer = await trainersCollection.findOne({
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
    app.patch(
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
            await appliedTrainersCollection.updateOne(
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
            const deleteTrainer = await trainersCollection.deleteOne({
              _id: appId,
            });
            const resultUser = await usersCollection.updateOne(
              { _id: userObjId },
              { $set: { role: "member" } }
            );
            return res
              .status(200)
              .send({ resultAppliedTrainer, deleteTrainer, resultUser });
          }

          if (status === "accepted") {
            const resultUser = await usersCollection.updateOne(
              { _id: userObjId },
              { $set: { role: "trainer" } }
            );

            return res.status(200).send({ resultAppliedTrainer, resultUser });
          }
          return res.status(200).send({ resultAppliedTrainer });
        } catch (error) {
          console.error("Error handling application:", error);
          return res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );
    app.get("/trainer-details/:id", async (req, res) => {
      const trainerId = req.params.id;
      const trainer = await trainersCollection.findOne({
        _id: new ObjectId(trainerId),
      });
      const user = await usersCollection.findOne({ _id: trainer.userId });
      const result = await trainersCollection
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

    app.post("/add-slot", verifyToken, verifyTrainer, async (req, res) => {
      try {
        const { trainerId, slot } = req.body;
        const email = req.query.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const trainer = await trainersCollection.findOne({
          _id: new ObjectId(trainerId),
        });

        if (!trainer) {
          return res.send({ error: "Trainer not found" });
        }

        if (!trainer.classDuration || slot.slotTime > trainer.classDuration) {
          return res.send({
            error: "Slot time cannot be greater than class duration",
          });
        }
        const canTake = await classesCollection.findOne({
          _id: new ObjectId(slot.selectedClass),
        });
        if (canTake.trainers.length >= 5) {
          return res.send({ error: "Already 5 trainers are assigned!" });
        }
        if (!canTake.trainers.includes(trainerId)) {
          const result = await classesCollection.updateOne(
            { _id: new ObjectId(slot.selectedClass) },
            {
              $push: { trainers: trainerId },
            }
          );
          if (result.modifiedCount === 0) {
            console.log("Failed to add trainer to class");
            return res
              .status(500)
              .send({ error: "Failed to add slot in class" });
          }
        }

        const slotId = new ObjectId();
        slot._id = slotId;
        const updatedTrainer = await trainersCollection.updateOne(
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
        console.log("Error adding slot:", error);
        res.send({ error: "Internal server error" });
      }
    });
    app.get("/slot", verifyToken, verifyTrainer, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const user = await usersCollection.findOne({
          email: { $regex: new RegExp(`^${email}$`, "i") },
        });

        const trainer = await trainersCollection.findOne({ userId: user._id });

        const trainerSlots = await trainersCollection.aggregate([
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
        console.error("Error fetching slots:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    app.delete("/slot", verifyToken, verifyTrainer, async (req, res) => {
      const { email, slotId } = req.query;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${email}$`, "i") },
      });
      const trainer = await trainersCollection.findOne({ userId: user._id });
      const slot = await trainersCollection.findOne({
        _id: trainer._id,
        "slots._id": new ObjectId(slotId),
      });
      const slotData = slot.slots[0];
      const updatedTrainer = await trainersCollection.updateOne(
        { _id: trainer._id },
        {
          $pull: { slots: { _id: new ObjectId(slotId) } },
          $set: {
            classDuration:
              trainer.classDuration + parseInt(slot.slots[0].slotTime),
          },
        }
      );
      const updateClass = await classesCollection.updateOne(
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

    // TODO: Had to implement secure Axios in the front end
    app.get("/book-trainer", async (req, res) => {
      try {
        const trainerId = req.query.trainerId;
        const slotId = req.query.slotId;
        const trainer = await trainersCollection.findOne({
          _id: new ObjectId(trainerId),
        });
        const trainerSlots = await trainersCollection.aggregate([
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
        console.error("Error fetching slots:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const email = req.query.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const { slotId, trainerId } = payment;
      const classId = await trainersCollection.findOne(
        {
          _id: new ObjectId(trainerId),
          "slots._id": new ObjectId(slotId),
        },
        { projection: { "slots.$": 1 } }
      );
      const selectedClass = classId ? classId.slots[0].selectedClass : null;
      payment.classId = selectedClass;
      const updateSlot = await trainersCollection.updateOne(
        {
          _id: new ObjectId(trainerId),
          "slots._id": new ObjectId(slotId),
        },
        {
          $push: { "slots.$.bookedMembers": { email: email } },
        }
      );
      const updateClass = await classesCollection.updateOne(
        {
          _id: new ObjectId(selectedClass),
        },
        {
          $inc: { booked: 1 },
        }
      );
      const paymentResult = await paymentsCollection.insertOne(payment);
      res.send(paymentResult);
    });
    app.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const payments = await paymentsCollection
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
          .toArray();
        const uniqueMembers = await paymentsCollection
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
        console.error("Error fetching payments:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    app.get("/booked-trainers", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const payments = await paymentsCollection
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
        console.log("Payments:", payments);
        payments.forEach((payment) => {
          console.log(payment.slotDetails);
        });
        res.send({ payments });
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Newsletter Subscribers
    app.post("/subscribers", async (req, res) => {
      const newSubscriber = req.body;
      const email = newSubscriber.email;
      const query = { email: email };
      const subscriber = await subscribersCollection.findOne(query);
      if (subscriber) {
        res.status(400).send("Subscriber already exists");
        return;
      }
      const result = await subscribersCollection.insertOne(newSubscriber);
      res.send(result);
    });
    app.get("/subscribers", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({
          message: "forbidden access",
        });
      }
      const cursor = subscribersCollection.find();
      const totalSubscribers =
        await subscribersCollection.estimatedDocumentCount();
      const result = await cursor.toArray();
      res.send({ totalSubscribers, result });
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
// start the server
app.listen(port, () => {
  console.log("FitForge API is running on port " + port);
});
