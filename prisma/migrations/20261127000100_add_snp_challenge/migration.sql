BEGIN;
CREATE TABLE "SnpChallenge" (
  "requestId" UUID PRIMARY KEY,
  "nonce" BYTEA NOT NULL CHECK (octet_length("nonce") = 32),
  "keyHash" BYTEA NOT NULL CHECK (octet_length("keyHash") = 32),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  CHECK ("consumedAt" IS NULL OR "consumedAt" < "expiresAt")
);
CREATE INDEX "SnpChallenge_expiresAt_idx" ON "SnpChallenge" ("expiresAt");
COMMIT;
