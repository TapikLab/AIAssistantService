import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { parseProfile } from './measurement-profile';
import type { TeeMeasurements } from './measurement-registry';
import { readMeasurementSignature } from './signed-measurement-registry';

type MeasurementLookupResult =
  | { readonly status: 'invalid-profile' }
  | { readonly status: 'not-found' }
  | { readonly status: 'found'; readonly signature: string };

const MAX_PROFILE_LENGTH = 5 * 96 + 4;

@Injectable()
export class MeasurementRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(
    platform: string,
    measurements: string,
  ): Promise<MeasurementLookupResult> {
    if (measurements.length > MAX_PROFILE_LENGTH) {
      return { status: 'invalid-profile' };
    }

    let profile: TeeMeasurements;

    try {
      profile = parseProfile(platform, measurements.split('.'));
    } catch {
      return { status: 'invalid-profile' };
    }

    const signature = await readMeasurementSignature(this.prisma, profile);

    if (signature === null) {
      return { status: 'not-found' };
    }

    return { status: 'found', signature };
  }
}
