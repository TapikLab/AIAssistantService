import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { MeasurementRegistryService } from './measurement-registry.service';

interface MeasurementProofResponse {
  readonly signature: string;
}

@Controller('attestation/measurements')
export class MeasurementRegistryController {
  constructor(private readonly registry: MeasurementRegistryService) {}

  @Get(':platform/:measurements')
  async getProof(
    @Param('platform') platform: string,
    @Param('measurements') measurements: string,
  ): Promise<MeasurementProofResponse> {
    const result = await this.registry.lookup(platform, measurements);

    switch (result.status) {
      case 'invalid-profile':
        throw new BadRequestException('INVALID_MEASUREMENT_PROFILE');

      case 'not-found':
        throw new NotFoundException('MEASUREMENT_PROOF_NOT_FOUND');

      case 'found':
        return { signature: result.signature };
    }
  }
}
