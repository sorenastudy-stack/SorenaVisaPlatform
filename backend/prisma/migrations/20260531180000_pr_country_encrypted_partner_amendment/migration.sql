-- PR-COUNTRY-ENCRYPTED: Phase 4 amendment.
--
-- The previous migration (20260531120000_pr_country_consolidate_iso_codes)
-- skipped four columns on the visa_partner table under the false premise
-- they were encrypted Bytes? columns. The PR-COUNTRY-ENCRYPTED investigation
-- confirmed they are plaintext String? columns — a Phase 1 inventory error.
-- This migration fills the gap with the same idempotent CTE pattern,
-- writing into the existing country_migration_log audit table.
--
-- contacts.nationality is also included even though it has 0 non-null rows
-- today, so the column is covered by the Phase 4 normalisation contract
-- going forward (anything in DB matching ^[A-Z]{2}$ is left alone; anything
-- else is mapped via the lookup or NULLed and logged).
--
-- The truly encrypted country column (visa_applications.countryOfResidenceEncrypted)
-- has 0 non-null rows today, so no decrypt → re-encrypt loop is needed in
-- this PR. If/when rows appear before such a script is written, the Phase 3
-- backend validator (assertCountryCodeOrEmpty in saveSupportingDocuments)
-- prevents new non-ISO writes at the source.
--
-- Idempotency: re-running this migration is safe. The lookup table is
-- dropped + recreated; each column block skips rows already matching the
-- alpha-2 pattern; UPDATEs are guarded by IS DISTINCT FROM; the
-- country_migration_log insert only fires for rows that actually changed.

-- ── Step 1: temporary name → ISO alpha-2 lookup ────────────────────
DROP TABLE IF EXISTS "_pr_country_encrypted_lookup";
CREATE TABLE "_pr_country_encrypted_lookup" (
  name TEXT PRIMARY KEY,
  code TEXT NOT NULL
);
INSERT INTO "_pr_country_encrypted_lookup" (name, code) VALUES
    ('Afghanistan', 'AF'),
    ('Åland Islands', 'AX'),
    ('Albania', 'AL'),
    ('Algeria', 'DZ'),
    ('American Samoa', 'AS'),
    ('Andorra', 'AD'),
    ('Angola', 'AO'),
    ('Anguilla', 'AI'),
    ('Antarctica', 'AQ'),
    ('Antigua and Barbuda', 'AG'),
    ('Argentina', 'AR'),
    ('Armenia', 'AM'),
    ('Aruba', 'AW'),
    ('Australia', 'AU'),
    ('Austria', 'AT'),
    ('Azerbaijan', 'AZ'),
    ('Bahamas', 'BS'),
    ('Bahrain', 'BH'),
    ('Bangladesh', 'BD'),
    ('Barbados', 'BB'),
    ('Belarus', 'BY'),
    ('Belgium', 'BE'),
    ('Belize', 'BZ'),
    ('Benin', 'BJ'),
    ('Bermuda', 'BM'),
    ('Bhutan', 'BT'),
    ('Bolivia', 'BO'),
    ('Bonaire, Sint Eustatius and Saba', 'BQ'),
    ('Bosnia and Herzegovina', 'BA'),
    ('Botswana', 'BW'),
    ('Bouvet Island', 'BV'),
    ('Brazil', 'BR'),
    ('British Indian Ocean Territory', 'IO'),
    ('Brunei', 'BN'),
    ('Brunei Darussalam', 'BN'),
    ('Bulgaria', 'BG'),
    ('Burkina Faso', 'BF'),
    ('Burundi', 'BI'),
    ('Cabo Verde', 'CV'),
    ('Cambodia', 'KH'),
    ('Cameroon', 'CM'),
    ('Canada', 'CA'),
    ('Cape Verde', 'CV'),
    ('Cayman Islands', 'KY'),
    ('Central African Republic', 'CF'),
    ('Chad', 'TD'),
    ('Chile', 'CL'),
    ('China', 'CN'),
    ('Christmas Island', 'CX'),
    ('Cocos (Keeling) Islands', 'CC'),
    ('Colombia', 'CO'),
    ('Comoros', 'KM'),
    ('Congo (Democratic Republic)', 'CD'),
    ('Congo (Republic)', 'CG'),
    ('Cook Islands', 'CK'),
    ('Costa Rica', 'CR'),
    ('Cote d''Ivoire', 'CI'),
    ('Croatia', 'HR'),
    ('Cuba', 'CU'),
    ('Curaçao', 'CW'),
    ('Cyprus', 'CY'),
    ('Czech Republic', 'CZ'),
    ('Democratic Republic of the Congo', 'CD'),
    ('Denmark', 'DK'),
    ('Djibouti', 'DJ'),
    ('Dominica', 'DM'),
    ('Dominican Republic', 'DO'),
    ('Ecuador', 'EC'),
    ('Egypt', 'EG'),
    ('El Salvador', 'SV'),
    ('Equatorial Guinea', 'GQ'),
    ('Eritrea', 'ER'),
    ('Estonia', 'EE'),
    ('Eswatini', 'SZ'),
    ('Ethiopia', 'ET'),
    ('Falkland Islands (Malvinas)', 'FK'),
    ('Faroe Islands', 'FO'),
    ('Fiji', 'FJ'),
    ('Finland', 'FI'),
    ('France', 'FR'),
    ('French Guiana', 'GF'),
    ('French Polynesia', 'PF'),
    ('French Southern Territories', 'TF'),
    ('Gabon', 'GA'),
    ('Gambia', 'GM'),
    ('Georgia', 'GE'),
    ('Germany', 'DE'),
    ('Ghana', 'GH'),
    ('Gibraltar', 'GI'),
    ('Greece', 'GR'),
    ('Greenland', 'GL'),
    ('Grenada', 'GD'),
    ('Guadeloupe', 'GP'),
    ('Guam', 'GU'),
    ('Guatemala', 'GT'),
    ('Guernsey', 'GG'),
    ('Guinea', 'GN'),
    ('Guinea-Bissau', 'GW'),
    ('Guyana', 'GY'),
    ('Haiti', 'HT'),
    ('Heard Island and McDonald Islands', 'HM'),
    ('Holy See (Vatican City State)', 'VA'),
    ('Honduras', 'HN'),
    ('Hong Kong', 'HK'),
    ('Hungary', 'HU'),
    ('Iceland', 'IS'),
    ('India', 'IN'),
    ('Indonesia', 'ID'),
    ('Iran', 'IR'),
    ('Iraq', 'IQ'),
    ('Ireland', 'IE'),
    ('Islamic Republic of Iran', 'IR'),
    ('Isle of Man', 'IM'),
    ('Israel', 'IL'),
    ('Italy', 'IT'),
    ('Jamaica', 'JM'),
    ('Japan', 'JP'),
    ('Jersey', 'JE'),
    ('Jordan', 'JO'),
    ('Kazakhstan', 'KZ'),
    ('Kenya', 'KE'),
    ('Kiribati', 'KI'),
    ('Kosovo', 'XK'),
    ('Kuwait', 'KW'),
    ('Kyrgyzstan', 'KG'),
    ('Lao People''s Democratic Republic', 'LA'),
    ('Laos', 'LA'),
    ('Latvia', 'LV'),
    ('Lebanon', 'LB'),
    ('Lesotho', 'LS'),
    ('Liberia', 'LR'),
    ('Libya', 'LY'),
    ('Liechtenstein', 'LI'),
    ('Lithuania', 'LT'),
    ('Luxembourg', 'LU'),
    ('Macao', 'MO'),
    ('Madagascar', 'MG'),
    ('Malawi', 'MW'),
    ('Malaysia', 'MY'),
    ('Maldives', 'MV'),
    ('Mali', 'ML'),
    ('Malta', 'MT'),
    ('Marshall Islands', 'MH'),
    ('Martinique', 'MQ'),
    ('Mauritania', 'MR'),
    ('Mauritius', 'MU'),
    ('Mayotte', 'YT'),
    ('Mexico', 'MX'),
    ('Micronesia', 'FM'),
    ('Micronesia, Federated States of', 'FM'),
    ('Moldova', 'MD'),
    ('Moldova, Republic of', 'MD'),
    ('Monaco', 'MC'),
    ('Mongolia', 'MN'),
    ('Montenegro', 'ME'),
    ('Montserrat', 'MS'),
    ('Morocco', 'MA'),
    ('Mozambique', 'MZ'),
    ('Myanmar', 'MM'),
    ('Namibia', 'NA'),
    ('Nauru', 'NR'),
    ('Nepal', 'NP'),
    ('Netherlands', 'NL'),
    ('New Caledonia', 'NC'),
    ('New Zealand', 'NZ'),
    ('NEW_ZEALAND', 'NZ'),
    ('Nicaragua', 'NI'),
    ('Niger', 'NE'),
    ('Nigeria', 'NG'),
    ('Niue', 'NU'),
    ('Norfolk Island', 'NF'),
    ('North Korea', 'KP'),
    ('North Macedonia', 'MK'),
    ('Northern Mariana Islands', 'MP'),
    ('Norway', 'NO'),
    ('Oman', 'OM'),
    ('Pakistan', 'PK'),
    ('Palau', 'PW'),
    ('Palestine', 'PS'),
    ('Panama', 'PA'),
    ('Papua New Guinea', 'PG'),
    ('Paraguay', 'PY'),
    ('People''s Republic of China', 'CN'),
    ('Peru', 'PE'),
    ('Philippines', 'PH'),
    ('Pitcairn', 'PN'),
    ('Poland', 'PL'),
    ('Portugal', 'PT'),
    ('Puerto Rico', 'PR'),
    ('Qatar', 'QA'),
    ('Republic of the Congo', 'CG'),
    ('Republic of The Gambia', 'GM'),
    ('Reunion', 'RE'),
    ('Romania', 'RO'),
    ('Russia', 'RU'),
    ('Russian Federation', 'RU'),
    ('Rwanda', 'RW'),
    ('Saint Barthélemy', 'BL'),
    ('Saint Helena', 'SH'),
    ('Saint Kitts and Nevis', 'KN'),
    ('Saint Lucia', 'LC'),
    ('Saint Martin (French part)', 'MF'),
    ('Saint Pierre and Miquelon', 'PM'),
    ('Saint Vincent and the Grenadines', 'VC'),
    ('Samoa', 'WS'),
    ('San Marino', 'SM'),
    ('Sao Tome and Principe', 'ST'),
    ('Saudi Arabia', 'SA'),
    ('Senegal', 'SN'),
    ('Serbia', 'RS'),
    ('Seychelles', 'SC'),
    ('Sierra Leone', 'SL'),
    ('Singapore', 'SG'),
    ('Sint Maarten (Dutch part)', 'SX'),
    ('Slovakia', 'SK'),
    ('Slovenia', 'SI'),
    ('Solomon Islands', 'SB'),
    ('Somalia', 'SO'),
    ('South Africa', 'ZA'),
    ('South Georgia and the South Sandwich Islands', 'GS'),
    ('South Korea', 'KR'),
    ('South Sudan', 'SS'),
    ('Spain', 'ES'),
    ('Sri Lanka', 'LK'),
    ('State of Palestine', 'PS'),
    ('Sudan', 'SD'),
    ('Suriname', 'SR'),
    ('Svalbard and Jan Mayen', 'SJ'),
    ('Sweden', 'SE'),
    ('Switzerland', 'CH'),
    ('Syria', 'SY'),
    ('Syrian Arab Republic', 'SY'),
    ('Taiwan', 'TW'),
    ('Taiwan, Province of China', 'TW'),
    ('Tajikistan', 'TJ'),
    ('Tanzania', 'TZ'),
    ('Thailand', 'TH'),
    ('The Republic of North Macedonia', 'MK'),
    ('Timor-Leste', 'TL'),
    ('Togo', 'TG'),
    ('Tokelau', 'TK'),
    ('Tonga', 'TO'),
    ('Trinidad and Tobago', 'TT'),
    ('Tunisia', 'TN'),
    ('Turkey', 'TR'),
    ('Türkiye', 'TR'),
    ('Turkmenistan', 'TM'),
    ('Turks and Caicos Islands', 'TC'),
    ('Tuvalu', 'TV'),
    ('Uganda', 'UG'),
    ('Ukraine', 'UA'),
    ('United Arab Emirates', 'AE'),
    ('United Kingdom', 'GB'),
    ('United Republic of Tanzania', 'TZ'),
    ('United States', 'US'),
    ('United States Minor Outlying Islands', 'UM'),
    ('United States of America', 'US'),
    ('Uruguay', 'UY'),
    ('Uzbekistan', 'UZ'),
    ('Vanuatu', 'VU'),
    ('Vatican City', 'VA'),
    ('Venezuela', 'VE'),
    ('Vietnam', 'VN'),
    ('Virgin Islands, British', 'VG'),
    ('Virgin Islands, U.S.', 'VI'),
    ('Wallis and Futuna', 'WF'),
    ('Western Sahara', 'EH'),
    ('Yemen', 'YE'),
    ('Zambia', 'ZM'),
    ('Zimbabwe', 'ZW');

-- ── Step 2: per-column normalisation (5 columns) ───────────────────

-- visa_partner.countryOfBirth
WITH to_migrate AS (
  SELECT t.id, t."countryOfBirth" AS old_value
  FROM "visa_partner" t
  WHERE t."countryOfBirth" IS NOT NULL
    AND t."countryOfBirth" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_encrypted_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_partner" a
  SET "countryOfBirth" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfBirth" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_partner', 'countryOfBirth', id, old_value, new_value FROM updated;

-- visa_partner.nationality
WITH to_migrate AS (
  SELECT t.id, t."nationality" AS old_value
  FROM "visa_partner" t
  WHERE t."nationality" IS NOT NULL
    AND t."nationality" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_encrypted_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_partner" a
  SET "nationality" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."nationality" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_partner', 'nationality', id, old_value, new_value FROM updated;

-- visa_partner.countryOfResidence
WITH to_migrate AS (
  SELECT t.id, t."countryOfResidence" AS old_value
  FROM "visa_partner" t
  WHERE t."countryOfResidence" IS NOT NULL
    AND t."countryOfResidence" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_encrypted_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_partner" a
  SET "countryOfResidence" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfResidence" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_partner', 'countryOfResidence', id, old_value, new_value FROM updated;

-- visa_partner.passportCountryOfIssue
WITH to_migrate AS (
  SELECT t.id, t."passportCountryOfIssue" AS old_value
  FROM "visa_partner" t
  WHERE t."passportCountryOfIssue" IS NOT NULL
    AND t."passportCountryOfIssue" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_encrypted_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_partner" a
  SET "passportCountryOfIssue" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."passportCountryOfIssue" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_partner', 'passportCountryOfIssue', id, old_value, new_value FROM updated;

-- contacts.nationality
WITH to_migrate AS (
  SELECT t.id, t."nationality" AS old_value
  FROM "contacts" t
  WHERE t."nationality" IS NOT NULL
    AND t."nationality" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_encrypted_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "contacts" a
  SET "nationality" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."nationality" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'contacts', 'nationality', id, old_value, new_value FROM updated;

-- ── Step 3: drop the lookup table ──────────────────────────────────
DROP TABLE "_pr_country_encrypted_lookup";
