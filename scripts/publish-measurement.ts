import 'dotenv/config';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaService } from '@common/prisma/prisma.service';
import { publishSignedMeasurement } from '@modules/attestation/signed-measurement-registry';
import { parseProfile } from '@modules/attestation/measurement-profile';

async function main(args: readonly string[]): Promise<void> {
  const [signature, platform, ...fields] = args;
  if (!signature) {
    throw new Error('EXPECTED_MEASUREMENT_SIGNATURE');
  }

  const publicKeyPath = process.env.TEE_REGISTRY_PUBLIC_KEY_PATH;
  if (!publicKeyPath) {
    throw new Error('EXPECTED_TEE_REGISTRY_PUBLIC_KEY_PATH');
  }

  const profile = parseProfile(platform, fields);
  const publicKey = createPublicKey(readFileSync(publicKeyPath));
  const db = new PrismaService();

  try {
    const result = await publishSignedMeasurement(
      db,
      profile,
      signature,
      publicKey,
    );

    process.stdout.write(`${result}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'PUBLICATION_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
