import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash, type KeyObject } from 'node:crypto';
import { CompactEncrypt } from 'jose';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { MeasurementHex } from '@modules/attestation/measurement';

interface Row {
  nonce: Uint8Array;
  used: boolean;
  expired: boolean;
  envelope: string | null;
  reportHash: Uint8Array | null;
}

export interface ReleaseRequest {
  readonly id: string;
  readonly key: KeyObject;
  readonly reportHash: Buffer<ArrayBuffer>;
  readonly measurement: MeasurementHex;
}

type State =
  | { readonly kind: 'complete'; readonly envelope: string }
  | { readonly kind: 'pending'; readonly nonce: string };

async function state(
  db: Pick<PrismaClient, '$queryRaw'>,
  request: ReleaseRequest,
  lock: boolean,
): Promise<State> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.id)) {
    throw new Error('EXPECTED_UUID_V4_REQUEST_ID');
  }
  const keyHash = createHash('sha256')
    .update(request.key.export({ type: 'spki', format: 'der' })).digest();
  const [row] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT "nonce", "consumedAt" IS NOT NULL AS used,
      "expiresAt" <= clock_timestamp() AS expired,
      "releaseEnvelope" AS envelope, "releaseReportHash" AS "reportHash"
    FROM "SnpChallenge"
    WHERE "requestId" = ${request.id}::uuid AND "keyHash" = ${keyHash}
    ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `);
  if (!row) throw new Error('CHALLENGE_NOT_AVAILABLE');
  if (row.used) {
    if (!row.envelope || !row.reportHash || !request.reportHash.equals(row.reportHash)) {
      throw new Error('CHALLENGE_ALREADY_USED');
    }
    return { kind: 'complete', envelope: row.envelope };
  }
  if (row.expired) throw new Error('CHALLENGE_EXPIRED');
  return { kind: 'pending', nonce: Buffer.from(row.nonce).toString('hex') };
}

async function encryptLocalKey(request: ReleaseRequest): Promise<string> {
  const path = process.env.SNP_LOCAL_RELEASE_KEY_PATH;
  if (!path) throw new Error('EXPECTED_SNP_LOCAL_RELEASE_KEY_PATH');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0) {
      throw new Error('EXPECTED_PRIVATE_32_BYTE_KEY_FILE');
    }
    const key = await file.readFile();
    try {
      if (key.length !== 32) throw new Error('EXPECTED_PRIVATE_32_BYTE_KEY_FILE');
      return await new CompactEncrypt(key).setProtectedHeader({
        alg: 'ECDH-ES', enc: 'A256GCM', typ: 'tapik-snp-key-release+jwe',
        kid: request.id.toLowerCase(), measurement: request.measurement,
      }).encrypt(request.key);
    } finally {
      key.fill(0);
    }
  } finally {
    await file.close();
  }
}

export async function releaseAfterVerification(
  db: PrismaClient,
  request: ReleaseRequest,
  verify: (nonce: string) => Promise<void>,
): Promise<string> {
  const initial = await state(db, request, false);
  if (initial.kind === 'complete') return initial.envelope;
  await verify(initial.nonce);
  const envelope = await encryptLocalKey(request);

  return db.$transaction(async tx => {
    const current = await state(tx, request, true);
    if (current.kind === 'complete') return current.envelope;
    if (current.nonce !== initial.nonce) throw new Error('CHALLENGE_CHANGED');
    const count = await tx.$executeRaw`
      WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
      UPDATE "SnpChallenge" SET "consumedAt" = instant.now,
        "releaseEnvelope" = ${envelope}, "releaseReportHash" = ${request.reportHash}
      FROM instant WHERE "requestId" = ${request.id}::uuid
        AND "consumedAt" IS NULL AND "expiresAt" > instant.now
    `;
    if (count !== 1) throw new Error('CHALLENGE_EXPIRED_OR_USED');
    return envelope;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
