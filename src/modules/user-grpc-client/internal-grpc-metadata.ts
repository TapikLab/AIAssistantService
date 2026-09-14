import { Metadata } from '@grpc/grpc-js';

export function buildInternalGrpcMetadata(intnalApiKey: string): Metadata {
  const metadata = new Metadata();
  metadata.set('x-internal-key', intnalApiKey);
  return metadata;
}
