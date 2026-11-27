BEGIN;
ALTER TABLE "SnpChallenge"
  ADD COLUMN "releaseEnvelope" TEXT,
  ADD COLUMN "releaseReportHash" BYTEA,
  ADD CONSTRAINT "SnpChallenge_release_complete" CHECK (
    ("releaseEnvelope" IS NULL AND "releaseReportHash" IS NULL)
    OR ("consumedAt" IS NOT NULL AND "releaseEnvelope" IS NOT NULL
        AND "releaseReportHash" IS NOT NULL AND octet_length("releaseReportHash") = 32)
  );
COMMIT;
