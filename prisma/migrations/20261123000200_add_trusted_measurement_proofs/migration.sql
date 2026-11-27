BEGIN;

CREATE TABLE "TrustedMeasurementProof" (
  "platform" VARCHAR(16) NOT NULL,
  "measurements" BYTEA NOT NULL,
  "signature" BYTEA NOT NULL,

  CONSTRAINT "TrustedMeasurementProof_pkey"
    PRIMARY KEY ("platform", "measurements"),

  CONSTRAINT "TrustedMeasurementProof_signature_length"
    CHECK (octet_length("signature") = 64),

  CONSTRAINT "TrustedMeasurementProof_platform_measurements_fkey"
    FOREIGN KEY ("platform", "measurements")
    REFERENCES "TrustedTeeMeasurement" ("platform", "measurements")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE TRIGGER "TrustedMeasurementProof_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "TrustedMeasurementProof"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_trusted_tee_measurement_change();

COMMIT;