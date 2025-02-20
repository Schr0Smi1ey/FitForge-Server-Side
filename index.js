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

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@schr0smi1ey.iioky.mongodb.net/?retryWrites=true&w=majority&appName=Schr0Smi1ey`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const database = client.db("FitForge");
const userCollection = database.collection("Users");
const subscriberCollection = database.collection("NewsLetterSubscribers");

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
      const user = await userCollection.findOne(query);
      if (user) {
        res.status(400).send("User already exists");
        return;
      }
      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });
    app.get("/users", async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // Newsletter Subscribers
    app.post("/subscribers", async (req, res) => {
      const newSubscriber = req.body;
      const email = newSubscriber.email;
      const query = { email: email };
      const subscriber = await subscriberCollection.findOne(query);
      if (subscriber) {
        res.status(400).send("Subscriber already exists");
        return;
      }
      const result = await subscriberCollection.insertOne(newSubscriber);
      res.send(result);
    });

    app.get("/subscribers", async (req, res) => {
      const cursor = subscriberCollection.find();
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
