/**
 * Covers the JWT guard's decision logic. Written against jsonwebtoken directly so
 * the assertions are about the security property (who is let through) rather than
 * about Express plumbing.
 */
const jwt = require("jsonwebtoken");

const SECRET = "test_access_token_secret";

// Mirrors verifyToken in index.js.
function verifyToken(req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: "unauthorized access" });
    req.decoded = decoded;
    next();
  });
}

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const run = (headers) =>
  new Promise((resolve) => {
    const req = { headers };
    const res = mockRes();
    const next = jest.fn(() => resolve({ req, res, next, passed: true }));
    verifyToken(req, res, () => next());
    // jwt.verify's callback is async; give it a tick before declaring failure.
    setImmediate(() => {
      if (!next.mock.calls.length) resolve({ req, res, next, passed: false });
    });
  });

describe("verifyToken", () => {
  it("admits a request carrying a validly signed token", async () => {
    const token = jwt.sign({ email: "user@x.com" }, SECRET, { expiresIn: "1h" });
    const { passed, req } = await run({ authorization: `Bearer ${token}` });
    expect(passed).toBe(true);
    expect(req.decoded.email).toBe("user@x.com");
  });

  it("rejects a request with no Authorization header", async () => {
    const { passed, res } = await run({});
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = jwt.sign({ email: "mallory@x.com" }, "not_the_secret");
    const { passed, res } = await run({ authorization: `Bearer ${token}` });
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects an expired token", async () => {
    const token = jwt.sign({ email: "old@x.com" }, SECRET, { expiresIn: -10 });
    const { passed, res } = await run({ authorization: `Bearer ${token}` });
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a structurally invalid token", async () => {
    const { passed, res } = await run({ authorization: "Bearer not.a.jwt" });
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // An attacker re-signing a token as {"alg":"none"} must not be trusted.
  it("rejects an unsigned 'alg: none' token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ email: "admin@x.com" })).toString("base64url");
    const { passed, res } = await run({ authorization: `Bearer ${header}.${body}.` });
    expect(passed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("ownership checks", () => {
  // The pattern used by /payments, /booked-trainers and /add-slot: a valid token
  // is not enough, the row must also belong to the caller.
  const ownsResource = (decodedEmail, queryEmail) => decodedEmail === queryEmail;

  it("allows a user to read their own data", () => {
    expect(ownsResource("me@x.com", "me@x.com")).toBe(true);
  });

  it("blocks reading someone else's data with a valid token", () => {
    expect(ownsResource("me@x.com", "victim@x.com")).toBe(false);
  });

  it("is case-sensitive, so a case-variant email is not treated as the owner", () => {
    expect(ownsResource("me@x.com", "ME@x.com")).toBe(false);
  });
});
