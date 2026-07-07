import {
  Controller, Get, Param, Post, Req, UseGuards, UseFilters,
  UseInterceptors, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MulterExceptionFilter } from '../students/admission/multer-exception.filter';
import { PortalService } from './portal.service';

// Piece #2 — payment-receipt upload. Local-disk storage under ./uploads/receipts
// with a random filename, mirroring the visa/admission upload pattern
// (visa.controller.ts:40-79). Layer hooks: size cap + type allowlist + random
// filename enforced at the multer boundary so a rejected file never reaches the
// service; MulterExceptionFilter maps LIMIT_FILE_SIZE → 413.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const RECEIPTS_DIR = path.join(UPLOAD_DIR, 'receipts');
const RECEIPT_ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];

const receiptMulterOptions = {
  storage: diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
      cb(null, RECEIPTS_DIR);
    },
    filename: (_req: any, file: any, cb: any) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    if (RECEIPT_ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      req.fileTypeRejected = true;
      cb(null, false);
    }
  },
};

// Client portal step 2 — client-only routes.
//
// Class-level guards:
//   • JwtAuthGuard — every route requires a valid signed-in user.
//   • RolesGuard + @Roles('LEAD', 'STUDENT') — only client roles. The
//     same gate pattern other modules use (e.g. students/* controller).
//     A staff role token (OWNER/ADMIN/SUPER_ADMIN/LIA/CONSULTANT/
//     SUPPORT/FINANCE/SALES/OPERATIONS) is rejected with 403.
//
// Note: no route takes a case id. The case is derived from the JWT's
// userId via the (lead.contact.userId) chain in the service — see
// PortalService for the security reasoning.

@Controller('portal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LEAD', 'STUDENT')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  @Get('me/case')
  getMyCase(@Req() req: any) {
    // Mirrors the actor-id pattern used throughout the codebase
    // (req.user?.userId ?? req.user?.id) — JwtStrategy returns
    // { userId, email, role } so the first branch always wins, but
    // the fallback is kept for parity with neighbours.
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getMyCase(userId);
  }

  // GET /portal/me/stage → { portalStage: 'STAGE_1' | 'STAGE_2' }
  // Stage-gate value for the client portal. STAGE_2 once the client (or their
  // guardian) AND the LIA have signed the contract (director ignored). Derived
  // server-side from the caller's own case — never throws, never 404s.
  @Get('me/stage')
  getPortalStage(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getPortalStage(userId);
  }

  // GET /portal/me/access → { paid, processing, payInvoiceId }
  // Piece #4 — the client's engagement-payment gate state. ALWAYS allowed
  // (never gated) so the shell + gate page can render correctly while locked.
  // Fail-safe to locked (paid:false) on any error.
  @Get('me/access')
  getAccessState(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getAccessState(userId);
  }

  // GET /portal/me/payments → the caller's OWN payment history (read-only).
  @Get('me/payments')
  getMyPayments(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getMyPayments(userId);
  }

  // GET /portal/me/invoices/:invoiceId/pay-options → read-only pay-screen data
  // (base amount, card total incl. server-derived surcharge, currency, client
  // name). Ownership from the JWT; a foreign invoice returns the same 404.
  @Get('me/invoices/:invoiceId/pay-options')
  getInvoicePayOptions(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getInvoicePayOptions(userId, invoiceId);
  }

  // POST /portal/me/invoices/:invoiceId/receipt → upload a payment receipt for
  // the caller's OWN invoice (bank transfer / partner exchange). Moves the
  // invoice into "processing" (receiptUploadedAt set) — NOT paid. Multipart:
  // `file` (pdf/jpeg/png ≤10MB) + `method` ('bank' | 'exchange').
  @Post('me/invoices/:invoiceId/receipt')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', receiptMulterOptions))
  uploadReceipt(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    if (req.fileTypeRejected) {
      throw new UnsupportedMediaTypeException('Only PDF, JPEG, and PNG files are accepted.');
    }
    if (!req.file) {
      throw new UnsupportedMediaTypeException('No file provided.');
    }
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.uploadInvoiceReceipt(userId, invoiceId, req.file, req.body?.method);
  }

  // GET /portal/me/invoices/:invoiceId/receipt/download → signed-token URL for
  // the caller's OWN uploaded receipt (owner-gated mint → /files/signed/:token).
  @Get('me/invoices/:invoiceId/receipt/download')
  getReceiptDownload(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.getInvoiceReceiptDownloadUrl(userId, invoiceId);
  }

  // POST /portal/me/invoices/:invoiceId/pay-link → { url }
  // Generates a Stripe pay link for the caller's OWN unpaid invoice. The
  // amount is read server-side from the Invoice; the client only supplies
  // invoiceId, which the service re-verifies belongs to the caller's own
  // case (never trusting a client-supplied case id).
  @Post('me/invoices/:invoiceId/pay-link')
  payInvoice(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id;
    return this.service.createInvoicePayLink(userId, invoiceId);
  }
}
