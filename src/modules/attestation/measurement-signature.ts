import { verify, type KeyObject } from 'node:crypto';
import {
  encodeMeasurements,
  type TeeMeasurements,
} from './measurement-registry';

const SIGNATURE_DOMAIN = 'tapik/tee/measurement-registry/v1';
const ED25519_SIGNATURE_BYTES = 64;
const ED25519_BASE64URL_LENGTH = 86;
const NON_BASE64URL_CHARACTER = /[^A-Za-z0-9_-]/;

export function measurementSigningPayload(input: TeeMeasurements): Buffer {
  const header = Buffer.from(
    `${SIGNATURE_DOMAIN}\0${input.platform}\0`,
    'ascii',
  );

  return Buffer.concat([header, encodeMeasurements(input)]);
}

export function verifyMeasurementSignature(
  input: TeeMeasurements,
  signature: unknown,
  trustedPublicKey: KeyObject,
): boolean {
  if (
    trustedPublicKey.type !== 'public' ||
    trustedPublicKey.asymmetricKeyType !== 'ed25519'
  ) {
    throw new TypeError('EXPECTED_ED25519_PUBLIC_KEY');
  }

  if (
    typeof signature !== 'string' ||
    signature.length !== ED25519_BASE64URL_LENGTH ||
    NON_BASE64URL_CHARACTER.test(signature)
  )
    return false;

  const bytes = Buffer.from(signature, 'base64url');
  if (
    bytes.length !== ED25519_SIGNATURE_BYTES ||
    bytes.toString('base64url') !== signature
  )
    return false;

  return verify(
    null,
    measurementSigningPayload(input),
    trustedPublicKey,
    bytes,
  );
}
