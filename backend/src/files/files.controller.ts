import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { verifySignedDownloadToken } from '../common/signed-url.util';

@Controller('files')
export class FilesController {
  @Get('signed/:token')
  async serveSignedFile(@Param('token') token: string, @Res() res: Response) {
    let payload: { fileUrl: string; fileName: string; mimeType: string };
    try {
      payload = verifySignedDownloadToken(token);
    } catch {
      return res
        .status(401)
        .json({ statusCode: 401, message: 'Invalid or expired download link.' });
    }

    const absolutePath = path.resolve(payload.fileUrl);

    try {
      await fs.promises.access(absolutePath, fs.constants.F_OK);
    } catch {
      return res.status(404).json({ statusCode: 404, message: 'File not found.' });
    }

    res.setHeader('Content-Type', payload.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${payload.fileName}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(absolutePath);
  }
}
