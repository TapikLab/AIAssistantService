BEGIN;

CREATE TABLE "TrustedTeeMeasurement" (
  "platform" VARCHAR(16) NOT NULL,
  "measurements" BYTEA NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrustedTeeMeasurement_pkey"
    PRIMARY KEY ("platform", "measurements"),

  CONSTRAINT "TrustedTeeMeasurement_valid_profile"
    CHECK (
      ("platform" = 'amd-sev-snp' AND octet_length("measurements") = 48)
      OR
      ("platform" = 'intel-tdx' AND octet_length("measurements") = 240)
    )
);

CREATE FUNCTION reject_trusted_tee_measurement_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TrustedTeeMeasurement is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "TrustedTeeMeasurement_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "TrustedTeeMeasurement"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_trusted_tee_measurement_change();

COMMIT;