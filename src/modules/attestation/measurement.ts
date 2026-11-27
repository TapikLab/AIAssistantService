declare const measurementHexBrand: unique symbol;

export type MeasurementHex = string & {
  readonly [measurementHexBrand]: true;
};

const MEASUREMENT_HEX_LENGTH = 96;
const NON_HEX_CHARACTER = /[^0-9a-fA-F]/;

export function parseMeasurementHex(value: unknown): MeasurementHex | null {
  if (
    typeof value !== 'string' ||
    value.length !== MEASUREMENT_HEX_LENGTH ||
    NON_HEX_CHARACTER.test(value)
  )
    return null;

  return value.toLowerCase() as MeasurementHex;
}
