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
      const email = newUser.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        res.status(400).send("User already exists");
        return;
      }
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });
    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // Classes
    app.post("/classes", async (req, res) => {
      const newClass = req.body;
      const result = await classesCollection.insertOne(newClass);
      res.send(result);
    });

    app.get("/classes", async (req, res) => {
      const cursor = classesCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // Forums
    app.post("/forums", async (req, res) => {
      const newForum = req.body;
      const result = await forumsCollection.insertOne(newForum);
      res.send(result);
    });

    app.get("/forums", async (req, res) => {
      const cursor = forumsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // Trainers
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
          const acceptedApplication = appliedTrainerDocs.find(
            (app) => app.status === "accepted"
          );
          if (acceptedApplication) {
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
    const { ObjectId } = require("mongodb");

    app.delete("/trainers", async (req, res) => {
      try {
        const trainerId = req.body.trainerId;
        const userId = req.body.userId;
        const result = await trainersCollection.deleteOne({
          _id: new ObjectId(trainerId),
        });
        const resUser = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: "member" } }
        );
        const resAppliedTrainers = await appliedTrainersCollection.updateOne(
          { applicationId: new ObjectId(trainerId) },
          { $set: { status: "cancelled" } }
        );

        res.send({ result, resUser, resAppliedTrainers });
      } catch (error) {
        console.error("Error deleting trainer:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/appliedTrainers", async (req, res) => {
      try {
        const applicantEmail = req.query.email;
        if (applicantEmail) {
          const user = await usersCollection.findOne({
            email: { $regex: new RegExp(`^${applicantEmail}$`, "i") },
          });
          const appliedTrainer = await appliedTrainersCollection
            .find({ userId: user._id })
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
    app.patch("/handleApplication", async (req, res) => {
      try {
        const handleData = req.body;
        console.log(handleData);
        const status = handleData.status;
        const applicationId = handleData.applicationId;
        const userId = handleData.userId;
        let feedback = "";
        if (status === "rejected") {
          feedback = handleData.feedback;
        }
        const resultAppliedTrainer = await appliedTrainersCollection.updateOne(
          { applicationId: new ObjectId(applicationId) },
          { $set: { status, feedback } }
        );
        console.log(resultAppliedTrainer);
        if (status === "rejected") {
          const res = await trainersCollection.deleteOne({
            _id: new ObjectId(applicationId),
          });
        }
        if (status === "accepted") {
          const resultUser = await usersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { role: "trainer" } }
          );
          return res.status(200).send({ resultAppliedTrainer, resultUser });
        }
        return res.status(200).send({ resultAppliedTrainer });
      } catch (error) {
        console.error("Error handling application:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    app.get("/applicant-details/:id", async (req, res) => {
      const trainerId = req.params.id;
      const trainer = await trainersCollection.findOne({
        _id: new ObjectId(trainerId),
      });
      const user = await usersCollection.findOne({ _id: trainer.userId });
      res.send({ trainer, user });
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
