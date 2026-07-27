const express = require("express");
const { ObjectId } = require("mongodb");
const { collections } = require("../config/db");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.post("/forums", verifyToken, async (req, res) => {
  const email = req.query.email;
  if (email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  const user = await collections.users.findOne({
    email: { $regex: new RegExp(`^${email}$`, "i") },
  });
  if (user.role !== "admin" && user.role !== "trainer") {
    return res.status(403).send({ message: "forbidden access" });
  }
  const newForum = req.body;
  const result = await collections.forums.insertOne(newForum);
  res.send(result);
});

router.get("/forums", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const skip = (page - 1) * limit;
    const email = req.query.email;
    const posts = await collections.forums
      .find()
      .sort({ postedDate: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    if (email) {
      const user = await collections.users.findOne({
        email: { $regex: new RegExp(`^${email}$`, "i") },
      });

      posts.forEach((post) => {
        post.liked =
          user?.likedPosts?.length > 0
            ? user.likedPosts.some(
                (item) => item.toString() === post._id.toString()
              )
            : false;

        post.disliked =
          user?.dislikedPosts?.length > 0
            ? user.dislikedPosts.some(
                (item) => item.toString() === post._id.toString()
              )
            : false;
      });
    } else {
      posts.forEach((post) => {
        post.liked = false;
        post.disliked = false;
      });
    }

    const totalPosts = await collections.forums.countDocuments();

    return res.json({
      posts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
    });
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/voteForums", verifyToken, async (req, res) => {
  try {
    const { forumId, vote } = req.body;
    const email = req.query.email;

    if (email !== req.decoded.email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const post = await collections.forums.findOne({
      _id: new ObjectId(forumId),
    });

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const { totalUpVote, totalDownVote } = post;
    const user = await collections.users.findOne({
      email: { $regex: new RegExp(`^${email}$`, "i") },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    let exists = 0;
    if (vote === "up") {
      if (!user.likedPosts.includes(forumId)) {
        await collections.users.updateOne(
          { email: { $regex: new RegExp(`^${email}$`, "i") } },
          { $push: { likedPosts: forumId } }
        );

        if (user.dislikedPosts.includes(forumId)) {
          exists = 1;
          await collections.users.updateOne(
            { email: { $regex: new RegExp(`^${email}$`, "i") } },
            { $pull: { dislikedPosts: forumId } }
          );
        }

        await collections.forums.updateOne(
          { _id: new ObjectId(forumId) },
          {
            $set: {
              totalUpVote: totalUpVote + 1,
              totalDownVote: totalDownVote - exists,
            },
          }
        );
      } else {
        await collections.users.updateOne(
          { email: { $regex: new RegExp(`^${email}$`, "i") } },
          { $pull: { likedPosts: forumId } }
        );
        await collections.forums.updateOne(
          { _id: new ObjectId(forumId) },
          {
            $set: {
              totalUpVote: totalUpVote - 1,
            },
          }
        );
      }
    }

    if (vote === "down") {
      if (!user.dislikedPosts.includes(forumId)) {
        await collections.users.updateOne(
          { email: { $regex: new RegExp(`^${email}$`, "i") } },
          { $push: { dislikedPosts: forumId } }
        );

        if (user.likedPosts.includes(forumId)) {
          exists = 1;
          await collections.users.updateOne(
            { email: { $regex: new RegExp(`^${email}$`, "i") } },
            { $pull: { likedPosts: forumId } }
          );
        }

        await collections.forums.updateOne(
          { _id: new ObjectId(forumId) },
          {
            $set: {
              totalUpVote: totalUpVote - exists,
              totalDownVote: totalDownVote + 1,
            },
          }
        );
      } else {
        await collections.users.updateOne(
          { email: { $regex: new RegExp(`^${email}$`, "i") } },
          { $pull: { dislikedPosts: forumId } }
        );
        await collections.forums.updateOne(
          { _id: new ObjectId(forumId) },
          {
            $set: {
              totalDownVote: totalDownVote - 1,
            },
          }
        );
      }
    }

    res.send({ message: "Vote updated successfully" });
  } catch (error) {
    // Swallowing this made server-side failures invisible in the logs.
    console.error(`${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
