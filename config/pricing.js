// Canonical package prices. This is the ONLY place a charge amount may come from —
// never from the request body, or a client could pay $0.01 for a Premium package.
//
// Stored in cents because Stripe's API takes an integer minor-unit amount, so the
// value handed to paymentIntents.create needs no float arithmetic (and 10.10 * 100
// is 1009.9999... in floating point, which would silently undercharge).
//
// The client keeps its own copy of these prices for DISPLAY only
// (FitForge-Client-Side/src/utils/packages.js). If you change a price here, change
// it there too — the server value is the one that is actually charged.
const PACKAGE_PRICES_CENTS = Object.freeze({
  Basic: 1000,
  Standard: 5000,
  Premium: 10000,
});

/** @returns {number|null} price in cents, or null if the package name is unrecognised */
function getPackagePriceCents(packageName) {
  if (typeof packageName !== "string") return null;
  return Object.prototype.hasOwnProperty.call(PACKAGE_PRICES_CENTS, packageName)
    ? PACKAGE_PRICES_CENTS[packageName]
    : null;
}

module.exports = { PACKAGE_PRICES_CENTS, getPackagePriceCents };
