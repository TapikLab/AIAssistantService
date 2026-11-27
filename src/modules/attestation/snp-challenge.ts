import { createHash, randomBytes, type KeyObject } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

const TTL_SECONDS = 120;

interface ChallengeRow {
  nonceHex: string;
  keyMatches: boolean;
  expiresAt: Date;
  used: boolean;
  expired: boolean;
}

export interface SnpChallenge {
  readonly requestId: string;
  readonly nonceHex: string;
  readonly expiresAt: Date;
}

function binding(requestId: string, publicKey: KeyObject): Buffer<ArrayBuffer> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('EXPECTED_UUID_V4_REQUEST_ID');
  }
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'x25519') {
    throw new Error('EXPECTED_X25519_PUBLIC_KEY');
  }
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest();
}

async function readActive(
  db: Pick<PrismaClient, '$queryRaw'>,
  requestId: string,
  keyHash: Buffer<ArrayBuffer>,
): Promise<SnpChallenge> {
  const [row] = await db.$queryRaw<ChallengeRow[]>`
    SELECT encode("nonce", 'hex') AS "nonceHex",
           "keyHash" = ${keyHash} AS "keyMatches",
           "expiresAt", "consumedAt" IS NOT NULL AS "used",
           "expiresAt" <= clock_timestamp() AS "expired"
    FROM "SnpChallenge" WHERE "requestId" = ${requestId}::uuid
  `;
  if (!row || !row.keyMatches) throw new Error('CHALLENGE_NOT_AVAILABLE');
  if (row.used) throw new Error('CHALLENGE_ALREADY_USED');
  if (row.expired) throw new Error('CHALLENGE_EXPIRED');
  return { requestId, nonceHex: row.nonceHex, expiresAt: row.expiresAt };
}

export async function issueChallenge(
  db: PrismaClient,
  requestId: string,
  publicKey: KeyObject,
): Promise<SnpChallenge> {
  const keyHash = binding(requestId, publicKey);
  const nonce = randomBytes(32);
  return db.$transaction(async tx => {
    await tx.$executeRaw`
      INSERT INTO "SnpChallenge" ("requestId", "nonce", "keyHash", "expiresAt")
      VALUES (${requestId}::uuid, ${nonce}, ${keyHash},
              clock_timestamp() + ${TTL_SECONDS}::integer * INTERVAL '1 second')
      ON CONFLICT ("requestId") DO NOTHING
    `;
    return readActive(tx, requestId, keyHash);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export function loadChallenge(
  db: PrismaClient,
  requestId: string,
  publicKey: KeyObject,
): Promise<SnpChallenge> {
  return readActive(db, requestId, binding(requestId, publicKey));
}

export async function consumeVerifiedChallenge(
  tx: Prisma.TransactionClient,
  challenge: SnpChallenge,
  verifiedPublicKey: KeyObject,
): Promise<void> {
  const keyHash = binding(challenge.requestId, verifiedPublicKey);
  const locked = await tx.$queryRaw<Array<{ ok: number }>>`
    SELECT 1 AS ok FROM "SnpChallenge"
    WHERE "requestId" = ${challenge.requestId}::uuid
      AND "nonce" = decode(${challenge.nonceHex}, 'hex')
      AND "keyHash" = ${keyHash}
    FOR UPDATE
  `;
  if (locked.length !== 1) throw new Error('CHALLENGE_NOT_AVAILABLE');
  const changed = await tx.$executeRaw`
    WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
    UPDATE "SnpChallenge" SET "consumedAt" = instant.now
    FROM instant WHERE "requestId" = ${challenge.requestId}::uuid
      AND "consumedAt" IS NULL AND "expiresAt" > instant.now
  `;
  if (changed !== 1) throw new Error('CHALLENGE_EXPIRED_OR_USED');
}
