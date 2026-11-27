import type { PrismaClient } from '@prisma/client';
import type { KeyObject } from 'node:crypto';
import {
  encodeMeasurements,
  type TeeMeasurements,
} from './measurement-registry';
import { verifyMeasurementSignature } from './measurement-signature';

type RegistryReader = Pick<PrismaClient, 'trustedMeasurementProof'>;
type RegistryWriter = Pick<PrismaClient, '$transaction'>;

export type PublicationResult = 'published' | 'already-published';

export async function publishSignedMeasurement(
  db: RegistryWriter,
  profile: TeeMeasurements,
  signature: string,
  trustedPublicKey: KeyObject,
): Promise<PublicationResult> {
  if (!verifyMeasurementSignature(profile, signature, trustedPublicKey)) {
    throw new Error('INVALID_MEASUREMENT_SIGNATURE');
  }

  const platform = profile.platform;
  const measurements = encodeMeasurements(profile);
  const signatureBytes = Buffer.from(signature, 'base64url');
  const key = { platform, measurements };

  return db.$transaction(async (tx): Promise<PublicationResult> => {
    await tx.trustedTeeMeasurement.createMany({
      data: [key],
      skipDuplicates: true,
    });

    const inserted = await tx.trustedMeasurementProof.createMany({
      data: [{ ...key, signature: signatureBytes }],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return 'published';

    const existing = await tx.trustedMeasurementProof.findUniqueOrThrow({
      where: { platform_measurements: key },
      select: { signature: true },
    });
    if (!signatureBytes.equals(existing.signature)) {
      throw new Error('MEASUREMENT_SIGNATURE_CONFLICT');
    }

    return 'already-published';
  });
}

export async function readMeasurementSignature(
  db: RegistryReader,
  profile: TeeMeasurements,
): Promise<string | null> {
  const entry = await db.trustedMeasurementProof.findUnique({
    where: {
      platform_measurements: {
        platform: profile.platform,
        measurements: encodeMeasurements(profile),
      },
    },
    select: {
      signature: true,
    },
  });

  return entry === null
    ? null
    : Buffer.from(entry.signature).toString('base64url');
}
