import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

// PR-PROVIDER-PORTAL slice B — what an institution may change about ITSELF.
//
// This is NOT UpdateProviderDto and must never become it. That DTO carries the
// commercial terms Sorena negotiated WITH this institution; handing it to the
// institution would let them set their own commission.
//
// INCLUDED — descriptive and contact detail only:
//   descriptionEn, websiteUrl, aboutUrl, catalogueUrl, city, legalEntityName
//
// EXCLUDED, and why. Each of these is either money, a Sorena-side judgement, or
// an identity the institution must not be able to restate:
//   commissionY1Type/Value, commissionY2Type/Value          — the commission
//   commissionEnglishY1Type/Value, ...Y2Type/Value          — the English rate
//   volumeTarget, bonusType, bonusValue                     — volume incentives
//   status                                                  — self-activation
//   isFeatured                                              — paid/editorial placement
//   rankingTier, rankingScore, rankingSource                — Sorena's own ranking
//   agreementUrl, agreementStart/End/RenewalDate            — the contract
//   institutionType, providerType, country                  — drives student-facing
//                                                             rules (slot rules,
//                                                             country grouping)
//   name, brand                                             — identity students match on
//   userId                                                  — the login link itself
//   notes                                                   — internal staff notes
//   latitude/longitude/geocodedAt/geocodeSource             — derived, not entered
//
// `name` is deliberately excluded even though it looks administrative: it is the
// string students see and the key the importer matches providers on. Renaming is
// a staff action.
//
// The global ValidationPipe runs `whitelist: true, forbidNonWhitelisted: true`,
// so a body carrying any field not listed below — including `id`, `providerId`
// or `commissionY1Value` — is REJECTED with 400 rather than quietly dropped.
// That is the second half of the boundary: the first is that no route reads an
// id at all.
export class UpdateOwnProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionEn?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Website must be a valid URL.' })
  @MaxLength(500)
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({}, { message: 'About page must be a valid URL.' })
  @MaxLength(500)
  aboutUrl?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Programme catalogue URL must be a valid URL.' })
  @MaxLength(500)
  catalogueUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalEntityName?: string;
}
