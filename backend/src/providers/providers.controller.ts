import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProvidersService } from './providers.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { CreateProgrammeDto } from './dto/create-programme.dto';
import { ProgrammeListQueryDto } from './dto/programme-filter.dto';
import { ProviderListQueryDto } from './dto/provider-list-filter.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';

@Controller('providers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() dto: CreateProviderDto, @Req() req: any) {
    return this.providersService.createProvider(dto, req.user?.id ?? null);
  }

  @Get()
  findAll(@Query() query: ProviderListQueryDto) {
    return this.providersService.findAll(query);
  }

  @Get(':id/faculties')
  findFaculties(@Param('id') providerId: string) {
    return this.providersService.findFaculties(providerId);
  }

  @Post(':id/faculties')
  addFaculty(@Param('id') providerId: string, @Body() dto: CreateFacultyDto) {
    return this.providersService.addFaculty(providerId, dto);
  }

  @Get(':id/programmes')
  findProgrammes(
    @Param('id') providerId: string,
    @Query() query: ProgrammeListQueryDto,
  ) {
    return this.providersService.findProgrammes(providerId, query);
  }

  @Post(':id/programmes')
  addProgramme(
    @Param('id') providerId: string,
    @Body() dto: CreateProgrammeDto,
  ) {
    return this.providersService.addProgramme(providerId, dto);
  }

  @Get(':id')
  findOne(@Param('id') providerId: string) {
    return this.providersService.findOne(providerId);
  }

  @Patch(':id')
  update(
    @Param('id') providerId: string,
    @Body() dto: UpdateProviderDto,
  ) {
    return this.providersService.updateProvider(providerId, dto);
  }

  @Patch(':id/agreement')
  updateAgreement(
    @Param('id') providerId: string,
    @Body() dto: UpdateAgreementDto,
  ) {
    return this.providersService.updateAgreement(providerId, dto);
  }

  @Patch('programmes/:programmeId/approve')
  @Roles('ADMIN', 'SUPER_ADMIN')
  approveProgramme(
    @Param('programmeId') programmeId: string,
    @Req() req: any,
  ) {
    return this.providersService.approveProgramme(
      programmeId,
      req.user?.id ?? null,
    );
  }

  @Patch('programmes/:programmeId/reject')
  @Roles('ADMIN', 'SUPER_ADMIN')
  rejectProgramme(
    @Param('programmeId') programmeId: string,
    @Req() req: any,
  ) {
    return this.providersService.rejectProgramme(
      programmeId,
      req.user?.id ?? null,
    );
  }

  @Post('programmes/:programmeId/requirements')
  addRequirement(
    @Param('programmeId') programmeId: string,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.providersService.addRequirement(programmeId, dto);
  }

  @Get('programmes/:programmeId/requirements')
  findRequirement(@Param('programmeId') programmeId: string) {
    return this.providersService.findRequirement(programmeId);
  }
}
