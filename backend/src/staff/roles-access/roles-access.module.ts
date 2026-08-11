import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RolesAccessController } from './roles-access.controller';
import { RolesAccessService } from './roles-access.service';

// DiscoveryModule provides DiscoveryService + MetadataScanner, which is how the
// report reads the role metadata off the controllers Nest actually registered
// rather than off a list someone has to remember to update.
@Module({
  imports: [DiscoveryModule],
  controllers: [RolesAccessController],
  providers: [RolesAccessService],
})
export class RolesAccessModule {}
