import 'dotenv/config';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseProfile } from '@modules/attestation/measurement-profile';
import { verifyMeasurementSignature } from '@modules/attestation/measurement-signature';

function readSignature(body: unknown): string {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('signature' in body) ||
    typeof body.signature !== 'string'
  ) {
    throw new Error('INVALID_REGISTRY_RESPONSE');
  }

  return body.signature;
}

async function main(args: readonly string[]): Promise<void> {
  const [platform, ...fields] = args;
  const profile = parseProfile(platform, fields);

  const publicKeyPath = process.env.TEE_REGISTRY_PUBLIC_KEY_PATH;
  if (!publicKeyPath) {
    throw new Error('EXPECTED_TEE_REGISTRY_PUBLIC_KEY_PATH');
  }

  const publicKey = createPublicKey(readFileSync(publicKeyPath));
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('EXPECTED_ED25519_PUBLIC_KEY');
  }

  const port = process.env.PORT ?? '3007';
  const measurements = fields.join('.').toLowerCase();
  const url = new URL(
    `/attestation/measurements/${profile.platform}/${measurements}`,
    `http://127.0.0.1:${port}`,
  );

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });

  if (response.status === 404) {
    throw new Error('MEASUREMENT_PROOF_NOT_FOUND');
  }

  if (response.status !== 200) {
    throw new Error(`REGISTRY_HTTP_${response.status}`);
  }

  const body: unknown = await response.json();
  const signature = readSignature(body);

  if (!verifyMeasurementSignature(profile, signature, publicKey)) {
    throw new Error('INVALID_MEASUREMENT_SIGNATURE');
  }

  process.stdout.write('measurement-signature-verified\n');
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'VERIFICATION_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
