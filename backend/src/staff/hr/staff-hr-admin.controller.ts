import {
  Body, Controller, Delete, Get, Param, Post, Put, Req,
  UnsupportedMediaTypeException, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StaffRolesGuard } from '../roles/staff-roles.guard';
import { AdminTier } from '../roles/staff-roles.decorator';
import { MulterExceptionFilter } from '../../students/admission/multer-exception.filter';
import { StaffHrService } from './staff-hr.service';
import { SetJobDescriptionDto } from './dto/staff-hr.dto';

// PR-STAFF-HR (Phase 3) — ADMIN HR management (contract + job description for
// a staff member). Mounted on the staff-users base path; every route is
// @AdminTier (OWNER/SUPER_ADMIN/ADMIN). The surface lives in the existing
// StaffDetailOverlay. Staff read their OWN data via /staff/me/* (separate).

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const PENDING_DIR = path.join(UPLOAD_DIR, 'pending');

// Contracts are PDF-only (tighter than the student uploaders' allow-list).
const multerOptions = {
  storage: diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      fs.mkdirSync(PENDING_DIR, { recursive: true });
      cb(null, PENDING_DIR);
    },
    filename: (_req: any, file: any, cb: any) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req: any, file: any, cb: any) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      req.fileTypeRejected = true;
      cb(null, false);
    }
  },
};

@Controller('api/staff/users')
@UseGuards(JwtAuthGuard, StaffRolesGuard)
export class StaffHrAdminController {
  constructor(private readonly service: StaffHrService) {}

  // GET /api/staff/users/:id/contract — contract metadata (for the overlay).
  @Get(':id/contract')
  @AdminTier()
  getContract(@Param('id') id: string) {
    return this.service.adminGetContract(id);
  }

  // GET /api/staff/users/:id/contract/download — signed URL to view it.
  @Get(':id/contract/download')
  @AdminTier()
  downloadContract(@Param('id') id: string) {
    return this.service.adminContractDownloadUrl(id);
  }

  // POST /api/staff/users/:id/contract — upload/replace the contract PDF.
  @Post(':id/contract')
  @AdminTier()
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  uploadContract(@Param('id') id: string, @Req() req: any) {
    if (req.fileTypeRejected) {
      throw new UnsupportedMediaTypeException('Only PDF files are accepted.');
    }
    if (!req.file) {
      throw new UnsupportedMediaTypeException('No file provided.');
    }
    return this.service.adminUploadContract(id, req.file, req.user.userId);
  }

  // DELETE /api/staff/users/:id/contract — remove the contract.
  @Delete(':id/contract')
  @AdminTier()
  deleteContract(@Param('id') id: string) {
    return this.service.adminDeleteContract(id);
  }

  // GET /api/staff/users/:id/job-description — current text (for the overlay).
  @Get(':id/job-description')
  @AdminTier()
  getJobDescription(@Param('id') id: string) {
    return this.service.adminGetJobDescription(id);
  }

  // PUT /api/staff/users/:id/job-description — set/clear the text.
  @Put(':id/job-description')
  @AdminTier()
  setJobDescription(@Param('id') id: string, @Body() dto: SetJobDescriptionDto, @Req() req: any) {
    return this.service.adminSetJobDescription(id, dto.text, req.user.userId);
  }
}
