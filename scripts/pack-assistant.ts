import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

function header(name: string, size: number, trailer = false): Buffer {
  const filename = Buffer.from(name + '\0', 'ascii');
  const fields = [
    trailer ? 0 : 1,
    trailer ? 0 : 0o100444,
    0,
    0,
    1,
    0,
    size,
    0,
    0,
    0,
    0,
    filename.length,
    0,
  ];
  const hex = fields
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
  const raw = Buffer.concat([Buffer.from('070701' + hex, 'ascii'), filename]);
  return Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4)]);
}

async function* archive(
  path: string,
  expected: string,
): AsyncGenerator<Buffer> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 0xffffffff) {
      throw new Error('INVALID_OCI_ARCHIVE_SIZE');
    }
    yield header('assistant.oci.tar', stat.size);
    const hash = createHash('sha256');
    let count = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      if (!Buffer.isBuffer(chunk)) throw new Error('EXPECTED_BINARY_DATA');
      count += chunk.length;
      hash.update(chunk);
      yield chunk;
    }
    if (count !== stat.size || hash.digest('hex') !== expected) {
      throw new Error('OCI_ARCHIVE_MISMATCH');
    }
    yield Buffer.alloc((4 - (count % 4)) % 4);
    yield header('TRAILER!!!', 0, true);
  } finally {
    await file.close();
  }
}

async function main(): Promise<void> {
  const [path, expected] = process.argv.slice(2);
  if (!path || !expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error('EXPECTED_ARCHIVE_PATH_AND_SHA256');
  }
  await pipeline(Readable.from(archive(path, expected)), process.stdout);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'PACK_FAILED');
  process.exitCode = 1;
});
