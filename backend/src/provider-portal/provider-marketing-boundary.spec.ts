import { readFileSync } from 'fs';

// PR-PROVIDER-PORTAL — marketing uploads, as source properties.
//
// A file upload is where "same security layers as any other upload" is easy to
// say and easy to half-do. These assert the four that matter: the type is
// checked against the bytes we hold, the size is capped, the key is ours, and
// nothing is ever a public URL.

const read = (p: string) => readFileSync(require.resolve(p), 'utf8');
const svc = read('./provider-marketing.service.ts');
const ctrl = read('./provider-marketing.controller.ts');

describe('the upload is constrained before anything is stored', () => {
  it('whitelists content types rather than blocking a denylist', () => {
    expect(svc).toMatch(/const ALLOWED: Record<string, string\[\]>/);
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/svg\\+xml', 'application/pdf']) {
      expect(svc).toMatch(new RegExp(`'${t}'`));
    }
    // Anything not named is refused by construction.
    expect(svc).toMatch(/if \(!exts\) \{/);
  });

  it('checks the extension AGREES with the declared type', () => {
    // A .pdf announcing itself as image/png is not a file to keep, whichever
    // half is lying.
    expect(svc).toMatch(/if \(!exts\.includes\(ext\)\)/);
  });

  it('caps the size, and does so on the bytes actually held', () => {
    expect(svc).toMatch(/MAX_BYTES = 20 \* 1024 \* 1024/);
    expect(svc).toMatch(/const size = file\.size \?\? file\.buffer\.length;/);
    expect(svc).toMatch(/if \(size > MAX_BYTES\)/);
  });

  it('derives the key server-side, namespaced by institution', () => {
    expect(svc).toMatch(/const key = `provider-marketing\/\$\{actor\.providerId\}\//);
    // Nothing the caller sends may reach the key.
    expect(svc).not.toMatch(/key = .*originalname/);
  });

  it('stores the KEY, never a public URL', () => {
    expect(svc).toMatch(/r2Key: key/);
    expect(svc).not.toMatch(/publicUrl|https:\/\/.*r2\.dev|\.r2\.cloudflarestorage\.com/);
  });

  it('issues short-lived presigned URLs for download', () => {
    expect(svc).toMatch(/getPresignedDownloadUrl\(asset\.r2Key, 60\)/);
  });
});

describe('marketing files stay inside the ownership boundary', () => {
  it('every lookup is scoped by providerId as well as id', () => {
    const scoped = svc.match(/where: \{ id, providerId: actor\.providerId/g) ?? [];
    expect(scoped.length).toBe(2); // downloadUrl + remove
    expect(svc).toMatch(/where: \{ providerId: actor\.providerId, isActive: true \}/); // list
  });

  it('the controller takes the institution only from the guard', () => {
    expect(ctrl).toMatch(/providerId: req\.providerAccess\.providerId/);
    expect(ctrl).not.toMatch(/@Body\('providerId'\)|body\.providerId/);
  });

  it('is guarded by JwtAuthGuard, RolesGuard AND ProviderAccessGuard', () => {
    expect(ctrl).toMatch(/@UseGuards\(JwtAuthGuard,\s*RolesGuard,\s*ProviderAccessGuard\)/);
    expect(ctrl).toMatch(/@Roles\('PROVIDER'\)/);
  });

  it('rate-limits every write', () => {
    const writes = (ctrl.match(/@(Post|Put|Patch|Delete)\(/g) ?? []).length;
    expect((ctrl.match(/@Throttle\(/g) ?? []).length).toBe(writes);
  });
});

describe('nothing is destroyed', () => {
  it('removing deactivates the row and keeps the object', () => {
    expect(svc).toMatch(/data: \{ isActive: false \}/);
    expect(svc).not.toMatch(/providerMarketingAsset\.delete\(/);
    expect(svc).not.toMatch(/deleteObject\(/);
  });

  it('the remove route is a POST, not a DELETE', () => {
    expect(ctrl).toMatch(/@Post\(':id\/remove'\)/);
    expect(ctrl).not.toMatch(/@Delete\(/);
  });

  it('upload, download and removal are all audited', () => {
    for (const e of ['PROVIDER_MARKETING_ASSET_UPLOADED', 'PROVIDER_MARKETING_ASSET_DOWNLOADED', 'PROVIDER_MARKETING_ASSET_REMOVED']) {
      expect(svc).toMatch(new RegExp(e));
    }
  });
});

describe('the Performance feature is intact behind the hidden nav', () => {
  // The nav itself is asserted in the frontend suite, where the component lives.
  it('the endpoint, its guards and its scoping are untouched', () => {
    const analytics = read('./provider-analytics.controller.ts');
    expect(analytics).toMatch(/@Controller\('provider\/analytics'\)/);
    expect(analytics).toMatch(/@Roles\('PROVIDER'\)/);
    expect(analytics).toMatch(/providerId: req\.providerAccess\.providerId/);
    expect(read('./provider-analytics.service.ts')).toMatch(/where: \{ providerId: actor\.providerId \}/);
  });
});
