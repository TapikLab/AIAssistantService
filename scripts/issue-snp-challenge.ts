import 'dotenv/config';
import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaService } from '@common/prisma/prisma.service';
import { issueChallenge } from '@modules/attestation/snp-challenge';

async function main(): Promise<void> {
  const [requestId, path] = process.argv.slice(2);
  if (!requestId || !path) throw new Error('EXPECTED_REQUEST_ID_AND_GUEST_PUBLIC_PEM');
  const pem = await readFile(path, 'utf8');
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('EXPECTED_PUBLIC_PEM');
  const key = createPublicKey(pem);
  const db = new PrismaService();
  try {
    const result = await issueChallenge(db, requestId, key);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'CHALLENGE_FAILED');
  process.exitCode = 1;
});
