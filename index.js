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
        const user = await usersCollection.findOne({
          email: trainerData.email,
        });
        trainerData.userId = user._id;

        const trainerInsertResult = await trainersCollection.insertOne(
          trainerData
        );
        const trainerId = trainerInsertResult.insertedId;
        const appliedTrainer = {
          userId: user._id,
          applicationId: trainerId,
          status: "pending",
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
    app.get("/appliedTrainers", async (req, res) => {
      try {
        const appliedTrainers = await appliedTrainersCollection
          .find()
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

        res.send(response);
      } catch (error) {
        console.error("Error fetching applied trainers:", error);
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
