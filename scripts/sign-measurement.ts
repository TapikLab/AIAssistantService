import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { measurementSigningPayload } from '@modules/attestation/measurement-signature';
import { parseProfile } from '@modules/attestation/measurement-profile';

function main(args: readonly string[]): void {
  const [privateKeyPath, platform, ...fields] = args;
  if (!privateKeyPath) {
    throw new Error('EXPECTED_PRIVATE_KEY_PATH');
  }

  const profile = parseProfile(platform, fields);
  const privateKey = createPrivateKey(readFileSync(privateKeyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('EXPECTED_ED25519_PRIVATE_KEY');
  }

  const signature = sign(null, measurementSigningPayload(profile), privateKey);
  process.stdout.write(`${signature.toString('base64url')}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'SIGNING_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
