import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { daysBack, fillDays, trimLeading, googleJwt } from "../metrics.mjs";

test("daily series: every day present, empty days before launch dropped", () => {
  const days = daysBack(5, Date.parse("2026-10-17T12:00:00Z"));
  assert.deepEqual(days, ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
  const rows = fillDays([{ day: "2026-10-15", n: 3 }, { day: "2026-10-17", n: 1 }], days, { n: 0 });
  assert.deepEqual(rows.map((r) => r.n), [0, 0, 3, 0, 1]);
  assert.deepEqual(trimLeading(rows, ["n"], 2).map((r) => r.day), ["2026-10-15", "2026-10-16", "2026-10-17"]);
  assert.equal(trimLeading(rows, ["n"], 4).length, 4, "keeps at least `min` days");
  assert.equal(trimLeading(fillDays([], days, { n: 0 }), ["n"], 3).length, 3);
});

test("Search Console sign-in token is a valid RS256 JWT for the read-only scope", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = googleJwt({ client_email: "sa@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }, 0);
  const [h, c, sig] = jwt.split(".");
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, sig, "base64url"));
  const claim = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claim.scope, "https://www.googleapis.com/auth/webmasters.readonly");
  assert.equal(claim.exp - claim.iat, 3600);
});
