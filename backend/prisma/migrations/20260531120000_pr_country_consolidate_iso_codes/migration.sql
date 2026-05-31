-- PR-COUNTRY-CONSOLIDATE: Phase 4 data migration.
--
-- Normalises every plaintext country-storing column to ISO 3166-1
-- alpha-2 codes. Existing values that don't map to a known country
-- become NULL (e.g. 'Atlantis' test data). The admission schoolCountry
-- column additionally preserves the 'OVERSEAS' sentinel.
--
-- Encrypted columns (visa_partners.*Encrypted, leads.countryOfResidenceEncrypted)
-- are NOT touched — they need a separate decrypt → re-encrypt pass
-- tracked as the PR-COUNTRY-ENCRYPTED follow-up. users.country lives
-- on a different lifecycle (already ISO codes, populated only via the
-- staff-side CountryPicker) and is intentionally out of scope.
--
-- Idempotency: re-running this migration is safe. The audit-log table
-- is created with IF NOT EXISTS; the lookup table is dropped + recreated;
-- each column block skips rows already matching the alpha-2 pattern
-- (`^[A-Z]{2}$`) so a second run finds nothing to change and writes no
-- new log rows. The INSERT INTO country_migration_log only fires for
-- rows where the UPDATE actually changed the column value (RETURNING
-- inside the CTE chain).
--
-- Audit trail: every changed row is recorded in country_migration_log
-- with (table_name, column_name, row_id, original_value, new_value).
-- Unmappable values appear with new_value = NULL so reviewers can spot
-- junk data (Atlantis, typos) that got nulled.

-- ── Step 1: persistent audit log ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "country_migration_log" (
  id             SERIAL PRIMARY KEY,
  table_name     TEXT NOT NULL,
  column_name    TEXT NOT NULL,
  row_id         TEXT NOT NULL,
  original_value TEXT,
  new_value      TEXT,
  migrated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "country_migration_log_table_column_idx"
  ON "country_migration_log" (table_name, column_name);

-- ── Step 2: temporary name → ISO alpha-2 lookup ────────────────────
-- The lookup pairs the 250 canonical i18n-iso-countries names with 20
-- legacy aliases (e.g. 'Iran' → 'IR', 'NEW_ZEALAND' → 'NZ') used by the
-- pre-PR-COUNTRY-CONSOLIDATE frontend so existing DB values map cleanly.
DROP TABLE IF EXISTS "_pr_country_consolidate_lookup";
CREATE TABLE "_pr_country_consolidate_lookup" (
  name TEXT PRIMARY KEY,
  code TEXT NOT NULL
);
INSERT INTO "_pr_country_consolidate_lookup" (name, code) VALUES
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

-- ── Step 3: per-column normalisation (26 columns) ──────────────────

-- admission_applications.countryOfBirth
WITH to_migrate AS (
  SELECT t.id, t."countryOfBirth" AS old_value
  FROM "admission_applications" t
  WHERE t."countryOfBirth" IS NOT NULL
    AND t."countryOfBirth" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "admission_applications" a
  SET "countryOfBirth" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfBirth" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'admission_applications', 'countryOfBirth', id, old_value, new_value FROM updated;

-- admission_applications.citizenship
WITH to_migrate AS (
  SELECT t.id, t."citizenship" AS old_value
  FROM "admission_applications" t
  WHERE t."citizenship" IS NOT NULL
    AND t."citizenship" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "admission_applications" a
  SET "citizenship" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."citizenship" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'admission_applications', 'citizenship', id, old_value, new_value FROM updated;

-- admission_applications.schoolCountry  (schoolCountry: OVERSEAS literal preserved)
WITH to_migrate AS (
  SELECT t.id, t."schoolCountry" AS old_value
  FROM "admission_applications" t
  WHERE t."schoolCountry" IS NOT NULL
    AND t."schoolCountry" != 'OVERSEAS' AND t."schoolCountry" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "admission_applications" a
  SET "schoolCountry" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."schoolCountry" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'admission_applications', 'schoolCountry', id, old_value, new_value FROM updated;

-- admission_applications.guardianCountry
WITH to_migrate AS (
  SELECT t.id, t."guardianCountry" AS old_value
  FROM "admission_applications" t
  WHERE t."guardianCountry" IS NOT NULL
    AND t."guardianCountry" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "admission_applications" a
  SET "guardianCountry" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."guardianCountry" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'admission_applications', 'guardianCountry', id, old_value, new_value FROM updated;

-- admission_education_entries.country
WITH to_migrate AS (
  SELECT t.id, t."country" AS old_value
  FROM "admission_education_entries" t
  WHERE t."country" IS NOT NULL
    AND t."country" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "admission_education_entries" a
  SET "country" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."country" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'admission_education_entries', 'country', id, old_value, new_value FROM updated;

-- visa_applications.countryWhenSubmitting
WITH to_migrate AS (
  SELECT t.id, t."countryWhenSubmitting" AS old_value
  FROM "visa_applications" t
  WHERE t."countryWhenSubmitting" IS NOT NULL
    AND t."countryWhenSubmitting" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_applications" a
  SET "countryWhenSubmitting" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryWhenSubmitting" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_applications', 'countryWhenSubmitting', id, old_value, new_value FROM updated;

-- visa_applications.passportCountryOfIssue
WITH to_migrate AS (
  SELECT t.id, t."passportCountryOfIssue" AS old_value
  FROM "visa_applications" t
  WHERE t."passportCountryOfIssue" IS NOT NULL
    AND t."passportCountryOfIssue" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_applications" a
  SET "passportCountryOfIssue" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."passportCountryOfIssue" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_applications', 'passportCountryOfIssue', id, old_value, new_value FROM updated;

-- visa_applications.nationalIdCountry
WITH to_migrate AS (
  SELECT t.id, t."nationalIdCountry" AS old_value
  FROM "visa_applications" t
  WHERE t."nationalIdCountry" IS NOT NULL
    AND t."nationalIdCountry" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_applications" a
  SET "nationalIdCountry" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."nationalIdCountry" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_applications', 'nationalIdCountry', id, old_value, new_value FROM updated;

-- visa_applications.physicalCountry
WITH to_migrate AS (
  SELECT t.id, t."physicalCountry" AS old_value
  FROM "visa_applications" t
  WHERE t."physicalCountry" IS NOT NULL
    AND t."physicalCountry" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_applications" a
  SET "physicalCountry" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."physicalCountry" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_applications', 'physicalCountry', id, old_value, new_value FROM updated;

-- visa_applications.postalCountry
WITH to_migrate AS (
  SELECT t.id, t."postalCountry" AS old_value
  FROM "visa_applications" t
  WHERE t."postalCountry" IS NOT NULL
    AND t."postalCountry" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_applications" a
  SET "postalCountry" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."postalCountry" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_applications', 'postalCountry', id, old_value, new_value FROM updated;

-- visa_applications.agentCountry
WITH to_migrate AS (
  SELECT t.id, t."agentCountry" AS old_value
  FROM "visa_applications" t
  WHERE t."agentCountry" IS NOT NULL
    AND t."agentCountry" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_applications" a
  SET "agentCountry" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."agentCountry" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_applications', 'agentCountry', id, old_value, new_value FROM updated;

-- visa_applications.policeCertCountryOfIssue
WITH to_migrate AS (
  SELECT t.id, t."policeCertCountryOfIssue" AS old_value
  FROM "visa_applications" t
  WHERE t."policeCertCountryOfIssue" IS NOT NULL
    AND t."policeCertCountryOfIssue" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_applications" a
  SET "policeCertCountryOfIssue" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."policeCertCountryOfIssue" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_applications', 'policeCertCountryOfIssue', id, old_value, new_value FROM updated;

-- visa_other_citizenships.country
WITH to_migrate AS (
  SELECT t.id, t."country" AS old_value
  FROM "visa_other_citizenships" t
  WHERE t."country" IS NOT NULL
    AND t."country" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_other_citizenships" a
  SET "country" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."country" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_other_citizenships', 'country', id, old_value, new_value FROM updated;

-- visa_tb_risk_countries.country
WITH to_migrate AS (
  SELECT t.id, t."country" AS old_value
  FROM "visa_tb_risk_countries" t
  WHERE t."country" IS NOT NULL
    AND t."country" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_tb_risk_countries" a
  SET "country" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."country" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_tb_risk_countries', 'country', id, old_value, new_value FROM updated;

-- visa_former_partners.countryOfBirth
WITH to_migrate AS (
  SELECT t.id, t."countryOfBirth" AS old_value
  FROM "visa_former_partners" t
  WHERE t."countryOfBirth" IS NOT NULL
    AND t."countryOfBirth" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_former_partners" a
  SET "countryOfBirth" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfBirth" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_former_partners', 'countryOfBirth', id, old_value, new_value FROM updated;

-- visa_former_partners.nationality
WITH to_migrate AS (
  SELECT t.id, t."nationality" AS old_value
  FROM "visa_former_partners" t
  WHERE t."nationality" IS NOT NULL
    AND t."nationality" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_former_partners" a
  SET "nationality" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."nationality" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_former_partners', 'nationality', id, old_value, new_value FROM updated;

-- visa_children.countryOfBirth
WITH to_migrate AS (
  SELECT t.id, t."countryOfBirth" AS old_value
  FROM "visa_children" t
  WHERE t."countryOfBirth" IS NOT NULL
    AND t."countryOfBirth" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_children" a
  SET "countryOfBirth" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfBirth" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_children', 'countryOfBirth', id, old_value, new_value FROM updated;

-- visa_children.nationality
WITH to_migrate AS (
  SELECT t.id, t."nationality" AS old_value
  FROM "visa_children" t
  WHERE t."nationality" IS NOT NULL
    AND t."nationality" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_children" a
  SET "nationality" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."nationality" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_children', 'nationality', id, old_value, new_value FROM updated;

-- visa_parents.countryOfBirth
WITH to_migrate AS (
  SELECT t.id, t."countryOfBirth" AS old_value
  FROM "visa_parents" t
  WHERE t."countryOfBirth" IS NOT NULL
    AND t."countryOfBirth" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_parents" a
  SET "countryOfBirth" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfBirth" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_parents', 'countryOfBirth', id, old_value, new_value FROM updated;

-- visa_parents.citizenship
WITH to_migrate AS (
  SELECT t.id, t."citizenship" AS old_value
  FROM "visa_parents" t
  WHERE t."citizenship" IS NOT NULL
    AND t."citizenship" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_parents" a
  SET "citizenship" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."citizenship" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_parents', 'citizenship', id, old_value, new_value FROM updated;

-- visa_parents.countryOfResidence
WITH to_migrate AS (
  SELECT t.id, t."countryOfResidence" AS old_value
  FROM "visa_parents" t
  WHERE t."countryOfResidence" IS NOT NULL
    AND t."countryOfResidence" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_parents" a
  SET "countryOfResidence" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfResidence" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_parents', 'countryOfResidence', id, old_value, new_value FROM updated;

-- visa_siblings.countryOfBirth
WITH to_migrate AS (
  SELECT t.id, t."countryOfBirth" AS old_value
  FROM "visa_siblings" t
  WHERE t."countryOfBirth" IS NOT NULL
    AND t."countryOfBirth" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_siblings" a
  SET "countryOfBirth" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfBirth" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_siblings', 'countryOfBirth', id, old_value, new_value FROM updated;

-- visa_siblings.citizenship
WITH to_migrate AS (
  SELECT t.id, t."citizenship" AS old_value
  FROM "visa_siblings" t
  WHERE t."citizenship" IS NOT NULL
    AND t."citizenship" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_siblings" a
  SET "citizenship" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."citizenship" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_siblings', 'citizenship', id, old_value, new_value FROM updated;

-- visa_siblings.countryOfResidence
WITH to_migrate AS (
  SELECT t.id, t."countryOfResidence" AS old_value
  FROM "visa_siblings" t
  WHERE t."countryOfResidence" IS NOT NULL
    AND t."countryOfResidence" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_siblings" a
  SET "countryOfResidence" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfResidence" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_siblings', 'countryOfResidence', id, old_value, new_value FROM updated;

-- visa_employment_entries.countryOfWork
WITH to_migrate AS (
  SELECT t.id, t."countryOfWork" AS old_value
  FROM "visa_employment_entries" t
  WHERE t."countryOfWork" IS NOT NULL
    AND t."countryOfWork" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_employment_entries" a
  SET "countryOfWork" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfWork" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_employment_entries', 'countryOfWork', id, old_value, new_value FROM updated;

-- visa_employment_entries.organisationCountry
WITH to_migrate AS (
  SELECT t.id, t."organisationCountry" AS old_value
  FROM "visa_employment_entries" t
  WHERE t."organisationCountry" IS NOT NULL
    AND t."organisationCountry" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "visa_employment_entries" a
  SET "organisationCountry" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."organisationCountry" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'visa_employment_entries', 'organisationCountry', id, old_value, new_value FROM updated;

-- contacts.countryOfResidence  (added post-Phase-4 after PR-COUNTRY-CONSOLIDATE
-- bug investigation surfaced one stale 'New Zealand' row in contacts that
-- flowed into visa Step 2's physicalCountry save payload and failed the new
-- ISO validator. Same idempotent CTE shape as the 26 column blocks above.)
WITH to_migrate AS (
  SELECT t.id, t."countryOfResidence" AS old_value
  FROM "contacts" t
  WHERE t."countryOfResidence" IS NOT NULL
    AND t."countryOfResidence" !~ '^[A-Z]{2}$'
),
mapped AS (
  SELECT m.id, m.old_value, l.code AS new_value
  FROM to_migrate m
  LEFT JOIN "_pr_country_consolidate_lookup" l ON l.name = m.old_value
),
updated AS (
  UPDATE "contacts" a
  SET "countryOfResidence" = mp.new_value
  FROM mapped mp
  WHERE a.id = mp.id AND a."countryOfResidence" IS DISTINCT FROM mp.new_value
  RETURNING a.id, mp.old_value, mp.new_value
)
INSERT INTO "country_migration_log" (table_name, column_name, row_id, original_value, new_value)
SELECT 'contacts', 'countryOfResidence', id, old_value, new_value FROM updated;

-- ── Step 4: drop the lookup table ──────────────────────────────────
DROP TABLE "_pr_country_consolidate_lookup";
