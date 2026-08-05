/**
 * The error shape every endpoint answers with.
 *
 * The default is deliberately flat — {statusCode, message, timestamp} — so an
 * error path cannot leak internals. These tests pin BOTH halves of that: the
 * flat default for everything that already existed, and the narrow opt-in that
 * lets a refusal carry the detail the UI needs to act on it.
 */
import { BadRequestException, ConflictException, HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host: any = {
    switchToHttp: () => ({ getResponse: () => ({ headersSent: false, status }) }),
  };
  new HttpExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('HttpExceptionFilter', () => {
  it('keeps the flat shape for a plain message throw', () => {
    const { status, body } = run(new BadRequestException('Please upload a JPG.'));
    expect(status).toBe(400);
    expect(Object.keys(body).sort()).toEqual(['message', 'statusCode', 'timestamp']);
    expect(body.message).toBe('Please upload a JPG.');
  });

  it('flattens a validation array to its first message, and adds nothing', () => {
    const { body } = run(new BadRequestException({ message: ['a must be a string', 'b is required'] }));
    expect(body.message).toBe('a must be a string');
    expect(Object.keys(body).sort()).toEqual(['message', 'statusCode', 'timestamp']);
  });

  it('preserves a `details` object on a 4xx that opts in', () => {
    const { status, body } = run(new ConflictException({
      message: '1 student has already chosen this programme.',
      details: {
        code: 'CONFIRMATION_REQUIRED',
        affected: [{ studentName: 'A Student', caseReference: 'INZ-1' }],
        retryWith: { active: false, confirm: true },
      },
    }));
    expect(status).toBe(409);
    expect(body.details.code).toBe('CONFIRMATION_REQUIRED');
    expect(body.details.affected).toHaveLength(1);
    expect(body.details.retryWith).toEqual({ active: false, confirm: true });
    expect(body.message).toBe('1 student has already chosen this programme.');
  });

  // Nest sets `error: 'Bad Request'` on its own exceptions, so the opt-in must
  // NOT key on that — otherwise nearly every endpoint's error body changes.
  it('does not widen a standard Nest exception that carries its own `error`', () => {
    const { body } = run(new BadRequestException('nope'));
    expect(body.error).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(['message', 'statusCode', 'timestamp']);
  });

  it('does NOT preserve details on a 5xx', () => {
    // A server fault must never widen what reaches the client.
    const { body } = run(new InternalServerErrorException({ message: 'boom', details: { dsn: 'secret' } }));
    expect(body.details).toBeUndefined();
    expect(body.message).toBe('boom');
  });

  it('does not preserve arbitrary keys — only `details`', () => {
    const { body } = run(new HttpException({ message: 'nope', internalHint: 'do not leak' }, HttpStatus.FORBIDDEN));
    expect(body.internalHint).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(['message', 'statusCode', 'timestamp']);
  });

  it('an unknown (non-HTTP) exception stays a generic 500', () => {
    const { status, body } = run(new Error('kaboom'));
    expect(status).toBe(500);
    expect(body.message).toBe('An unexpected error occurred. Please try again.');
    expect(body.message).not.toMatch(/kaboom/);
  });

  it('does not write again when the response was already sent', () => {
    const json = jest.fn();
    const host: any = { switchToHttp: () => ({ getResponse: () => ({ headersSent: true, status: () => ({ json }) }) }) };
    new HttpExceptionFilter().catch(new BadRequestException('x'), host);
    expect(json).not.toHaveBeenCalled();
  });
});
