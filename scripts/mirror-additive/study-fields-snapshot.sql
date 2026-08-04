-- Snapshot of the demo study_fields taxonomy (categories -> fields -> relations),
-- captured from the seeded demo DB. Idempotent load used by mirror-prod-to-demo.sh
-- ONLY when study_fields is empty. Stable ids preserved so FK refs stay valid.
SET session_replication_role = replica;
COPY public."study_field_categories" (id,key,"nameEn","nameFa","alwaysSelectable","displayOrder","isActive","createdAt","updatedAt") FROM stdin;
cmsdy2nlo0000udtk565ttxv5	management_business	Management & Business	مدیریت و کسب‌وکار	t	1	t	2026-08-04 00:53:26.652	2026-08-04 00:53:26.652
cmsdy2o2p0001udtki24ri29o	it_data	Information Technology & Data	فناوری اطلاعات و داده	f	2	t	2026-08-04 00:53:27.265	2026-08-04 00:53:27.265
cmsdy2oe40002udtkkykkw0y1	health	Healthcare & Medical	بهداشت و پزشکی	f	3	t	2026-08-04 00:53:27.676	2026-08-04 00:53:27.676
cmsdy2omn0003udtkfu5qsxks	engineering	Engineering	مهندسی	f	4	t	2026-08-04 00:53:27.984	2026-08-04 00:53:27.984
cmsdy2ov60004udtk0ax0tof8	trades	Construction, Trades & Infrastructure	ساخت‌وساز، فنی و زیرساخت	f	5	t	2026-08-04 00:53:28.291	2026-08-04 00:53:28.291
cmsdy2p6q0005udtk605ypqlu	education	Education & Teaching	آموزش و تدریس	f	6	t	2026-08-04 00:53:28.706	2026-08-04 00:53:28.706
cmsdy2pi10006udtk82sj91dl	sciences	Science & Environment	علوم و محیط‌زیست	f	7	t	2026-08-04 00:53:29.113	2026-08-04 00:53:29.113
cmsdy2ptg0007udtkcgh13tl8	creative	Arts, Design & Media	هنر، طراحی و رسانه	f	8	t	2026-08-04 00:53:29.524	2026-08-04 00:53:29.524
cmsdy2q1x0008udtka812v66v	hospitality	Hospitality, Tourism & Culinary	مهمان‌نوازی، گردشگری و آشپزی	f	9	t	2026-08-04 00:53:29.829	2026-08-04 00:53:29.829
cmsdy2qci0009udtkbvk26ru5	primary_industries	Agriculture & Primary Industries	کشاورزی و صنایع اولیه	f	10	t	2026-08-04 00:53:30.21	2026-08-04 00:53:30.21
cmsdy2ql9000audtkg9ctuv9y	other	Other / Interdisciplinary	سایر / میان‌رشته‌ای	f	11	t	2026-08-04 00:53:30.526	2026-08-04 00:53:30.526
\.
COPY public."study_fields" (id,key,"nameEn","nameFa","categoryId","backgroundWeight","displayOrder","isActive","explainerVideoId","evergreenVideoIds","createdAt","updatedAt") FROM stdin;
cmsdy2que000cudtkspn0gs3p	it_computer_science	Information Technology & Computer Science	فناوری اطلاعات و علوم کامپیوتر	cmsdy2o2p0001udtki24ri29o	4	1	t	\N	\N	2026-08-04 00:53:30.853	2026-08-04 00:53:30.853
cmsdy2rbe000eudtkghnu8wcj	healthcare_medical	Healthcare & Medical	بهداشت و پزشکی	cmsdy2oe40002udtkkykkw0y1	4	2	t	\N	\N	2026-08-04 00:53:31.466	2026-08-04 00:53:31.466
cmsdy2rk3000gudtkdprhem32	nursing	Nursing	پرستاری	cmsdy2oe40002udtkkykkw0y1	4	3	t	\N	\N	2026-08-04 00:53:31.779	2026-08-04 00:53:31.779
cmsdy2rsx000iudtkjwk6562s	engineering	Engineering	مهندسی	cmsdy2omn0003udtkfu5qsxks	4	4	t	\N	\N	2026-08-04 00:53:32.097	2026-08-04 00:53:32.097
cmsdy2s1b000kudtk8727q3xp	construction_trades	Construction, Trades & Infrastructure	ساخت‌وساز، فنی و زیرساخت	cmsdy2ov60004udtk0ax0tof8	4	5	t	\N	\N	2026-08-04 00:53:32.399	2026-08-04 00:53:32.399
cmsdy2s9u000mudtkmc5rp5hi	education_teaching	Education & Teaching	آموزش و تدریس	cmsdy2p6q0005udtk605ypqlu	4	6	t	\N	\N	2026-08-04 00:53:32.706	2026-08-04 00:53:32.706
cmsdy2sid000oudtknel904d5	agriculture	Agriculture & Primary Industries	کشاورزی و صنایع اولیه	cmsdy2qci0009udtkbvk26ru5	4	7	t	\N	\N	2026-08-04 00:53:33.013	2026-08-04 00:53:33.013
cmsdy2sqw000qudtkdmkoz1lo	business_management	Business & Management	کسب‌وکار و مدیریت	cmsdy2nlo0000udtk565ttxv5	3	8	t	\N	\N	2026-08-04 00:53:33.32	2026-08-04 00:53:33.32
cmsdy2t1y000sudtkg4352lmu	project_management	Project Management	مدیریت پروژه	cmsdy2nlo0000udtk565ttxv5	3	9	t	\N	\N	2026-08-04 00:53:33.718	2026-08-04 00:53:33.718
cmsdy2tag000uudtk16457axc	healthcare_management	Healthcare Management	مدیریت بهداشت و درمان	cmsdy2nlo0000udtk565ttxv5	3	10	t	\N	\N	2026-08-04 00:53:34.025	2026-08-04 00:53:34.025
cmsdy2tlz000wudtk8091zl93	hospitality_management	Hospitality Management	مدیریت مهمان‌نوازی	cmsdy2nlo0000udtk565ttxv5	3	11	t	\N	\N	2026-08-04 00:53:34.439	2026-08-04 00:53:34.439
cmsdy2tx8000yudtklwq23n90	science_environment	Science & Environment	علوم و محیط‌زیست	cmsdy2pi10006udtk82sj91dl	3	12	t	\N	\N	2026-08-04 00:53:34.844	2026-08-04 00:53:34.844
cmsdy2u5p0010udtkw4cmxfpv	aviation_transport	Aviation, Maritime & Transport	هوانوردی، دریانوردی و حمل‌ونقل	cmsdy2ql9000audtkg9ctuv9y	3	13	t	\N	\N	2026-08-04 00:53:35.15	2026-08-04 00:53:35.15
cmsdy2uea0012udtkv3kil6uv	hospitality_culinary	Hospitality, Tourism & Culinary	مهمان‌نوازی، گردشگری و آشپزی	cmsdy2q1x0008udtka812v66v	3	14	t	\N	\N	2026-08-04 00:53:35.458	2026-08-04 00:53:35.458
cmsdy2umr0014udtk6qt543kr	media_communication	Media & Communication	رسانه و ارتباطات	cmsdy2ptg0007udtkcgh13tl8	2	15	t	\N	\N	2026-08-04 00:53:35.764	2026-08-04 00:53:35.764
cmsdy2uv70016udtknr47b756	arts_design	Arts, Design & Creative Industries	هنر، طراحی و صنایع خلاق	cmsdy2ptg0007udtkcgh13tl8	2	16	t	\N	\N	2026-08-04 00:53:36.067	2026-08-04 00:53:36.067
cmsdy2v3q0018udtka32i6yso	law_government	Law, Politics & Government	حقوق، سیاست و دولت	cmsdy2ql9000audtkg9ctuv9y	2	17	t	\N	\N	2026-08-04 00:53:36.374	2026-08-04 00:53:36.374
cmsdy2vcf001audtkaivzfji0	general_interdisciplinary	General / Interdisciplinary	عمومی / میان‌رشته‌ای	cmsdy2ql9000audtkg9ctuv9y	1	18	t	\N	\N	2026-08-04 00:53:36.687	2026-08-04 00:53:36.687
cmsdy2vl1001cudtktef9ewco	other	Other	سایر	cmsdy2ql9000audtkg9ctuv9y	0	19	t	\N	\N	2026-08-04 00:53:36.997	2026-08-04 00:53:36.997
cmsdy2vth001eudtk1ogqas7w	personal_services	Personal Services (Beauty & Hair)	خدمات فردی (زیبایی و آرایش)	cmsdy2ql9000audtkg9ctuv9y	0	20	t	\N	\N	2026-08-04 00:53:37.301	2026-08-04 00:53:37.301
cmsdy2w4v001gudtkaccoo01i	sport_recreation	Sport & Recreation	ورزش و تفریحات	cmsdy2oe40002udtkkykkw0y1	0	21	t	\N	\N	2026-08-04 00:53:37.712	2026-08-04 00:53:37.712
cmsdy2wg9001iudtkokghw1sl	social_community	Social & Community Services	خدمات اجتماعی و اجتماع‌محور	cmsdy2p6q0005udtk605ypqlu	0	22	t	\N	\N	2026-08-04 00:53:38.121	2026-08-04 00:53:38.121
cmsdy2wrm001kudtk8eolkqzo	foundation_pathways	Foundation & Pathways	دوره‌های پایه و آماده‌سازی	cmsdy2ql9000audtkg9ctuv9y	0	23	t	\N	\N	2026-08-04 00:53:38.53	2026-08-04 00:53:38.53
\.
COPY public."study_field_relations" (id,"sourceFieldId","targetFieldId","reviewStatus","createdAt","updatedAt","updatedById") FROM stdin;
cmsdy2x32001mudtkw35ukgjd	cmsdy2que000cudtkspn0gs3p	cmsdy2tx8000yudtklwq23n90	APPROVED	2026-08-04 00:53:38.942	2026-08-04 00:53:38.942	\N
cmsdy2xkd001oudtkjqrad9ax	cmsdy2rsx000iudtkjwk6562s	cmsdy2que000cudtkspn0gs3p	APPROVED	2026-08-04 00:53:39.566	2026-08-04 00:53:39.566	\N
cmsdy2xsz001qudtkmliv5prg	cmsdy2rsx000iudtkjwk6562s	cmsdy2s1b000kudtk8727q3xp	APPROVED	2026-08-04 00:53:39.875	2026-08-04 00:53:39.875	\N
cmsdy2y42001sudtkrxt427n8	cmsdy2s1b000kudtk8727q3xp	cmsdy2rsx000iudtkjwk6562s	APPROVED	2026-08-04 00:53:40.274	2026-08-04 00:53:40.274	\N
cmsdy2ycy001uudtkjb15b7qk	cmsdy2rbe000eudtkghnu8wcj	cmsdy2rk3000gudtkdprhem32	APPROVED	2026-08-04 00:53:40.594	2026-08-04 00:53:40.594	\N
cmsdy2ynw001wudtku1ybznp3	cmsdy2rk3000gudtkdprhem32	cmsdy2rbe000eudtkghnu8wcj	APPROVED	2026-08-04 00:53:40.988	2026-08-04 00:53:40.988	\N
cmsdy2yza001yudtkqs8811vg	cmsdy2rbe000eudtkghnu8wcj	cmsdy2tx8000yudtklwq23n90	APPROVED	2026-08-04 00:53:41.398	2026-08-04 00:53:41.398	\N
cmsdy2zm00020udtkj59xp01i	cmsdy2tx8000yudtklwq23n90	cmsdy2que000cudtkspn0gs3p	APPROVED	2026-08-04 00:53:41.807	2026-08-04 00:53:41.807	\N
cmsdy2zx80022udtkqmxaattd	cmsdy2tx8000yudtklwq23n90	cmsdy2rbe000eudtkghnu8wcj	APPROVED	2026-08-04 00:53:42.621	2026-08-04 00:53:42.621	\N
cmsdy308u0024udtkr3ekhy37	cmsdy2sid000oudtknel904d5	cmsdy2tx8000yudtklwq23n90	APPROVED	2026-08-04 00:53:43.038	2026-08-04 00:53:43.038	\N
cmsdy30i00026udtk7zf7dxud	cmsdy2umr0014udtk6qt543kr	cmsdy2uv70016udtknr47b756	APPROVED	2026-08-04 00:53:43.369	2026-08-04 00:53:43.369	\N
cmsdy30qk0028udtktgc6rlfp	cmsdy2uv70016udtknr47b756	cmsdy2umr0014udtk6qt543kr	APPROVED	2026-08-04 00:53:43.677	2026-08-04 00:53:43.677	\N
\.
SET session_replication_role = origin;
