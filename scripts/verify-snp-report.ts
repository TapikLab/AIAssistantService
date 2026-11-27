import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseMeasurementHex } from '@modules/attestation/measurement';

import { PrismaService } from '@common/prisma/prisma.service';
import { releaseAfterVerification } from './snp-key-release';

const run = promisify(execFile);

function minimumTcb(name: string): string {
  const value = process.env[name] ?? '';
  if (!/^0x[0-9a-f]{1,16}$/i.test(value) || BigInt(value) === 0n) {
    throw new Error('MISSING_OR_INVALID_' + name);
  }
  return value;
}

async function main(): Promise<void> {
  const [requestId, reportPath, publicKeyPath] = process.argv.slice(2);
  if (!requestId || !reportPath || !publicKeyPath) {
    throw new Error('EXPECTED_REQUEST_ID_REPORT_AND_GUEST_PUBLIC_KEY');
  }

  const tcb = minimumTcb('SNP_MIN_TCB');
  const launchTcb = minimumTcb('SNP_MIN_LAUNCH_TCB');
  const build = resolve('build/tee');
  const text = await readFile(resolve(build, 'snp.cJHXWyWv/expected-measurement.hex'), 'utf8');
  const measurement = parseMeasurementHex(text.trim());
  if (!measurement) throw new Error('INVALID_EXPECTED_MEASUREMENT');

  const pem = await readFile(publicKeyPath, 'utf8');
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('EXPECTED_PUBLIC_PEM');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'x25519') throw new Error('EXPECTED_X25519_KEY');
  const report = await readFile(reportPath);
  const reportHash = createHash('sha256').update(report).digest();
  const db = new PrismaService();
  try {
    const envelope = await releaseAfterVerification(db, { id: requestId, key, reportHash, measurement }, async nonce => {
      const reportData = createHash('sha512')
        .update('tapik/kms/snp-key-release/v1\0', 'ascii')
        .update(Buffer.from(nonce, 'hex'))
        .update(key.export({ type: 'spki', format: 'der' }))
        .digest('hex');

      await run(resolve('node_modules/.bin/ts-node'), [
        'scripts/verify-published-measurement.ts', 'amd-sev-snp', measurement,
      ], { timeout: 15000 });

      const dir = await mkdtemp(resolve(tmpdir(), 'tapik-report-'));
      try {
        const snapshot = resolve(dir, 'report.bin');
        await writeFile(snapshot, report, { flag: 'wx', mode: 0o600 });
        await run(resolve(build, 'verifier.FPWHFpIu/snp-check'), [
          '-in', snapshot, '-inform', 'bin', '-product', 'Milan',
          '-vmpl', '0', '-guest_policy', '0x30000',
          '-minimum_tcb', tcb, '-minimum_launch_tcb', launchTcb,
          '-check_crl=true', '-provisional=false', '-timeout=20s',
          '-measurement', measurement, '-report_data', reportData,
        ], { timeout: 30000 });

      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
    process.stdout.write(envelope + '\n');
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : 'VERIFICATION_FAILED') + '\n');
  process.exitCode = 1;
});
