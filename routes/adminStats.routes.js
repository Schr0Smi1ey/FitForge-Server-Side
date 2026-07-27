const express = require("express");
const { collections } = require("../config/db");
const { verifyToken, verifyAdmin } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = express.Router();

/**
 * Admin dashboard metrics.
 *
 * Every figure is computed by the database rather than by fetching whole
 * collections and reducing them in the browser: the dashboard previously pulled
 * every payment row just to show a total, which grows linearly with revenue.
 * These aggregations return a handful of documents no matter how large the
 * collections get.
 */
router.get(
  "/admin-stats",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (req, res) => {
    const [revenueByTier, paymentTotals, pendingApplications, roleCounts, subscribers] =
      await Promise.all([
        collections.payments
          .aggregate([
            {
              $group: {
                _id: "$packageName",
                total: { $sum: "$price" },
                count: { $sum: 1 },
              },
            },
            { $sort: { total: -1 } },
          ])
          .toArray(),

        collections.payments
          .aggregate([
            {
              $group: {
                _id: null,
                revenue: { $sum: "$price" },
                transactions: { $sum: 1 },
              },
            },
          ])
          .toArray(),

        collections.appliedTrainers.countDocuments({ status: "pending" }),

        collections.users
          .aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }])
          .toArray(),

        collections.subscribers.estimatedDocumentCount(),
      ]);

    const totals = paymentTotals[0] || { revenue: 0, transactions: 0 };
    const roles = Object.fromEntries(roleCounts.map((r) => [r._id || "unknown", r.count]));

    res.send({
      revenueByTier: revenueByTier.map((r) => ({
        packageName: r._id || "unknown",
        total: r.total,
        count: r.count,
      })),
      totalRevenue: totals.revenue,
      totalTransactions: totals.transactions,
      pendingApplications,
      roles,
      totalSubscribers: subscribers,
    });
  })
);

module.exports = router;
