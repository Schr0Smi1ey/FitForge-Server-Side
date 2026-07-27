const { getPackagePriceCents, PACKAGE_PRICES_CENTS } = require("../config/pricing");

describe("canonical pricing", () => {
  it("returns the fixed price for each known package", () => {
    expect(getPackagePriceCents("Basic")).toBe(1000);
    expect(getPackagePriceCents("Standard")).toBe(5000);
    expect(getPackagePriceCents("Premium")).toBe(10000);
  });

  it("rejects unknown packages rather than defaulting to a price", () => {
    expect(getPackagePriceCents("Free")).toBeNull();
    expect(getPackagePriceCents("")).toBeNull();
  });

  it("is case-sensitive, so a near-miss never silently resolves", () => {
    expect(getPackagePriceCents("premium")).toBeNull();
    expect(getPackagePriceCents("PREMIUM")).toBeNull();
  });

  it("rejects non-string input instead of coercing it", () => {
    expect(getPackagePriceCents(undefined)).toBeNull();
    expect(getPackagePriceCents(null)).toBeNull();
    expect(getPackagePriceCents(1000)).toBeNull();
    expect(getPackagePriceCents({})).toBeNull();
  });

  // A plain `PRICES[name]` lookup returns a function for these, which is truthy
  // and would sail past a null check straight into stripe.paymentIntents.create.
  it("does not resolve inherited Object.prototype keys", () => {
    expect(getPackagePriceCents("toString")).toBeNull();
    expect(getPackagePriceCents("constructor")).toBeNull();
    expect(getPackagePriceCents("hasOwnProperty")).toBeNull();
    expect(getPackagePriceCents("__proto__")).toBeNull();
  });

  it("stores whole cents, so no float rounding can reach Stripe", () => {
    for (const cents of Object.values(PACKAGE_PRICES_CENTS)) {
      expect(Number.isInteger(cents)).toBe(true);
    }
  });

  it("cannot be mutated at runtime", () => {
    expect(() => {
      "use strict";
      PACKAGE_PRICES_CENTS.Premium = 1;
    }).toThrow();
    expect(getPackagePriceCents("Premium")).toBe(10000);
  });
});
