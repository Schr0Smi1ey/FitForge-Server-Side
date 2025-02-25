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

async function run() {
  try {
    app.get("/", (req, res) => {
      res.send("Welcome to the FitForge API");
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
    app.get("/user", async (req, res) => {
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${req.query.email}$`, "i") },
      });
      if (!user) {
        res.status(404).send("User not found");
        return;
      }
      const role = req.query?.role;
      if (role) {
        if (role === "trainer") {
          const trainer = await trainersCollection.findOne({
            userId: user._id,
          });
          if (trainer) {
            console.log(trainer);
            return res.send({ user, trainer });
          }
        }
      }

      res.send(user);
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
        if (home) {
          const classes = await classesCollection
            .find()
            .sort({ booked: -1, postedDate: -1 })
            .limit(6)
            .toArray();
          return res.json(classes);
        }
        if (slotForm) {
          const classes = await classesCollection
            .find({}, { projection: { title: 1, _id: 1, duration: 1 } })
            .toArray();
          console.log(classes);
          return res.send(classes);
        }

        const classes = await classesCollection
          .find()
          .sort({ postedDate: -1 })
          .skip(skip)
          .limit(limit)
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
    app.post("/forums", async (req, res) => {
      const newForum = req.body;
      const result = await forumsCollection.insertOne(newForum);
      res.send(result);
    });

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
    // TODO: Not final yet
    app.post("/trainers", async (req, res) => {
      try {
        const trainerData = req.body;
        console.log(trainerData);
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
    // TODO: Not final yet
    app.get("/trainers", async (req, res) => {
      try {
        const trainers = await trainersCollection
          .aggregate([
            {
              $lookup: {
                from: "AppliedTrainers",
                localField: "_id",
                foreignField: "applicationId",
                as: "applications",
              },
            },
            {
              $match: { "applications.status": "accepted" },
            },
            // {
            //   $project: {
            //     _id: 1,
            //     name: 1,
            //     email: 1,
            //     expertise: 1,
            //     applications: 0, // Exclude applications field from response
            //   },
            // },
          ])
          .toArray();
        res.send(trainers);
      } catch (error) {
        console.error("Error fetching trainers:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // TODO: Not final yet
    app.get("/appliedTrainers", async (req, res) => {
      try {
        const applicantEmail = req.query.email;
        if (applicantEmail) {
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
        console.log(response);
        return res.send(response);
      } catch (error) {
        console.error("Error fetching applied trainers:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // TODO: Not final yet
    app.patch("/handleApplication", async (req, res) => {
      try {
        const { status, applicationId, userId, feedback } = req.body;
        console.log(req.body);
        const appId = new ObjectId(applicationId);
        const userObjId = new ObjectId(userId);

        // Update the application status
        const resultAppliedTrainer = await appliedTrainersCollection.updateOne(
          { applicationId: appId },
          {
            $set: {
              status,
              feedback:
                status === "rejected" || status === "cancelled" ? feedback : "",
            },
          }
        );

        console.log(resultAppliedTrainer);

        // Handle rejected/cancelled cases
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

        // Handle accepted case
        if (status === "accepted") {
          const resultUser = await usersCollection.updateOne(
            { _id: userObjId },
            { $set: { role: "trainer" } }
          );

          return res.status(200).send({ resultAppliedTrainer, resultUser });
        }

        // Default response
        return res.status(200).send({ resultAppliedTrainer });
      } catch (error) {
        console.error("Error handling application:", error);
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // TODO: Not final yet
    app.get("/trainer-details/:id", async (req, res) => {
      const trainerId = req.params.id;
      const trainer = await trainersCollection.findOne({
        _id: new ObjectId(trainerId),
      });
      const user = await usersCollection.findOne({ _id: trainer.userId });
      res.send({ trainer, user });
    });

    // TODO: Not final yet
    app.post("/add-slot", async (req, res) => {
      try {
        const { trainerId, slot } = req.body;
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
          return res.status(500).json({ error: "Failed to add slot" });
        }

        res.status(201).json({ success: "Slot added successfully" });
      } catch (error) {
        res.send({ error: "Internal server error" });
      }
    });

    app.get("/slot", async (req, res) => {
      try {
        const email = req.query.email;
        const user = await usersCollection.findOne({
          email: { $regex: new RegExp(`^${email}$`, "i") },
        });

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const trainer = await trainersCollection.findOne({ userId: user._id });

        if (!trainer) {
          return res.status(404).json({ error: "Trainer not found" });
        }
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
        console.log(result);
        res.send(result[0].slots);
      } catch (error) {
        console.error("Error fetching slots:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.delete("/slot", async (req, res) => {
      const { email, slotId } = req.query;
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${email}$`, "i") },
      });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const trainer = await trainersCollection.findOne({ userId: user._id });
      if (!trainer) {
        return res.status(404).json({ error: "Trainer not found" });
      }
      const slot = await trainersCollection.findOne({
        _id: trainer._id,
        "slots._id": new ObjectId(slotId),
      });
      if (!slot) {
        return res.status(404).json({ error: "Slot not found" });
      }
      const updatedTrainer = await trainersCollection.updateOne(
        { _id: trainer._id },
        {
          $pull: { slots: { _id: new ObjectId(slotId) } },
        }
      );
      if (updatedTrainer.modifiedCount === 0) {
        return res.status(500).json({ error: "Failed to delete slot" });
      }
      res.status(200).json({ success: "Slot deleted successfully" });
    });

    // TODO: Not final yet
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
    // TODO: Not final yet
    app.get("/subscribers", async (req, res) => {
      const cursor = subscribersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
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
