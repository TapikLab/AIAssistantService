import { parseMeasurementHex, type MeasurementHex } from './measurement';
import type { TeeMeasurements } from './measurement-registry';

function requireMeasurement(raw: string | undefined): MeasurementHex {
  const value = parseMeasurementHex(raw);
  if (value === null) {
    throw new Error('EXPECTED_96_HEX_CHARACTERS_PER_MEASUREMENT');
  }

  return value;
}

export function parseProfile(
  platform: string | undefined,
  fields: readonly string[],
): TeeMeasurements {
  if (platform === 'amd-sev-snp' && fields.length === 1)
    return { platform, measurement: requireMeasurement(fields[0]) };

  if (platform === 'intel-tdx' && fields.length === 5) {
    return {
      platform,
      mrtd: requireMeasurement(fields[0]),
      rtmr0: requireMeasurement(fields[1]),
      rtmr1: requireMeasurement(fields[2]),
      rtmr2: requireMeasurement(fields[3]),
      rtmr3: requireMeasurement(fields[4]),
    };
  }

  throw new Error('EXPECTED_AMD_WITH_ONE_FIELD_OR_INTEL_WITH_FIVE_FIELDS');
}
