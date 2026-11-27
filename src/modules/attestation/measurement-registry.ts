import type { MeasurementHex } from './measurement';

export type TeeMeasurements =
  | {
      readonly platform: 'amd-sev-snp';
      readonly measurement: MeasurementHex;
    }
  | {
      readonly platform: 'intel-tdx';
      readonly mrtd: MeasurementHex;
      readonly rtmr0: MeasurementHex;
      readonly rtmr1: MeasurementHex;
      readonly rtmr2: MeasurementHex;
      readonly rtmr3: MeasurementHex;
    };

export function encodeMeasurements(
  input: TeeMeasurements,
): Buffer<ArrayBuffer> {
  const hex =
    input.platform === 'amd-sev-snp'
      ? input.measurement
      : input.mrtd + input.rtmr0 + input.rtmr1 + input.rtmr2 + input.rtmr3;

  return Buffer.from(hex, 'hex');
}
