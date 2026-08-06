// PR-EXPLORE — fill latitude/longitude for institutions using OpenStreetMap's
// Nominatim geocoder (free, no API key, pairs with the Leaflet/OSM map).
//
// NOMINATIM USAGE POLICY is not optional and is enforced here:
//   * absolute maximum 1 request/second — this waits 1100ms between calls
//   * a genuine User-Agent identifying the application and a contact
//   * results cached in the DB so a re-run geocodes only what is still missing
// Breaching it gets the whole platform's IP blocked, which would take the map
// down for everyone. https://operations.osmfoundation.org/policies/nominatim/
//
// NEVER GUESSES. An institution that cannot be matched inside New Zealand is
// left null, listed in the report, and still appears in Explore results without
// a pin. A wrong pin is worse than no pin: a student would read it as fact.
//
// Usage:
//   npx ts-node --transpile-only scripts/geocode-providers.ts [--retry-misses] [--limit N]
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { geocodeQueries, judgeCandidate, type GeocodeCandidate } from '../src/providers/geocode.logic';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CONTACT = process.env.GEOCODER_CONTACT ?? 'admin@sorenavisa.com';
const USER_AGENT = `SorenaVisaPlatform/1.0 (${CONTACT})`;
const DELAY_MS = 1100; // policy is <=1/s; 1.1s leaves headroom

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookup(query: string): Promise<GeocodeCandidate | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=nz`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (res.status === 429 || res.status === 403) {
    throw new Error(`Nominatim refused the request (${res.status}) — rate limited or blocked. Stopping.`);
  }
  if (!res.ok) return null;
  const rows: any[] = await res.json();
  if (!rows.length) return null;
  const r = rows[0];
  return {
    lat: parseFloat(r.lat), lon: parseFloat(r.lon),
    displayName: r.display_name, importance: r.importance, type: r.type, class: r.class,
  };
}

(async () => {
  const retryMisses = process.argv.includes('--retry-misses');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;

  // ── PRODUCTION GUARD ──────────────────────────────────────────────────────
  // Same rail as catalogue-import-local.ts, but this script is legitimately
  // useful against production (that is how the live map got its pins), so it
  // gates rather than refuses outright: a non-local DATABASE_URL demands
  // --confirm-production. Without the flag it stops, so nobody reaches for a
  // shell with a production URL already exported and geocodes the live
  // catalogue by accident.
  //
  // "Local" is deliberately narrow — anything that is not localhost/127.0.0.1
  // is treated as production, so a staging or demo URL is gated too. Better to
  // ask an unnecessary question than to skip a necessary one.
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    console.error('REFUSING TO RUN: DATABASE_URL is not set.');
    process.exit(1);
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const confirmed = process.argv.includes('--confirm-production');

  if (!isLocal && !confirmed) {
    const host = (() => { try { return new URL(url).hostname; } catch { return '(unparseable host)'; } })();
    console.error('REFUSING TO RUN: DATABASE_URL is not local.');
    console.error(`  target host : ${host}`);
    console.error('');
    console.error('This writes latitude/longitude/geocodedAt/geocodeSource on education_providers');
    console.error('for every institution owning an imported programme. Against production that is a');
    console.error('real data change, so it needs to be deliberate:');
    console.error('');
    console.error('  npx ts-node --transpile-only scripts/geocode-providers.ts --confirm-production');
    console.error('');
    console.error('Take a backup first, per the standing rule.');
    process.exit(1);
  }
  if (!isLocal && confirmed) {
    const host = (() => { try { return new URL(url).hostname; } catch { return '(unparseable host)'; } })();
    console.log(`⚠ RUNNING AGAINST A NON-LOCAL DATABASE — host ${host}`);
    console.log('  writing: latitude, longitude, geocodedAt, geocodeSource (education_providers only)\n');
  }
  // A --confirm-production flag on a local database is harmless but almost
  // always means the operator thought they were pointed somewhere else.
  if (isLocal && confirmed) {
    console.log('note: --confirm-production given but DATABASE_URL is local; running locally.\n');
  }

  const prisma = new PrismaClient();

  // Only institutions that actually appear on the Explore map: those owning an
  // imported programme. Re-runs skip anything already geocoded unless asked.
  const providers = await prisma.educationProvider.findMany({
    where: {
      programmes: { some: { sourceRef: { not: null } } },
      ...(retryMisses ? { latitude: null } : { geocodedAt: null }),
    },
    select: { id: true, name: true, city: true },
    orderBy: { name: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  const total = await prisma.educationProvider.count({
    where: { programmes: { some: { sourceRef: { not: null } } } },
  });
  console.log(`institutions on the Explore map : ${total}`);
  console.log(`to geocode this run             : ${providers.length}${retryMisses ? ' (retrying previous misses)' : ''}`);
  if (!providers.length) { await prisma.$disconnect(); return; }
  console.log(`estimated time                  : ~${Math.ceil((providers.length * DELAY_MS) / 1000 / 60)} min (1 req/s policy)\n`);

  const misses: Array<{ name: string; reason: string }> = [];
  const byQuality: Record<string, number> = { campus: 0, institution: 0, city: 0 };

  for (const [i, p] of providers.entries()) {
    const queries = geocodeQueries(p.name, p.city);
    let done = false;

    for (const [qi, q] of queries.entries()) {
      await sleep(DELAY_MS);
      let candidate: GeocodeCandidate | null = null;
      try {
        candidate = await lookup(q);
      } catch (e: any) {
        console.error(`\nABORTING: ${e.message}`);
        await prisma.$disconnect();
        process.exit(1);
      }
      const decision = judgeCandidate(candidate, qi, queries.length);
      if (!decision.accepted) continue;

      await prisma.educationProvider.update({
        where: { id: p.id },
        data: {
          latitude: decision.lat, longitude: decision.lon,
          geocodedAt: new Date(), geocodeSource: `nominatim:${decision.quality}`,
        },
      });
      byQuality[decision.quality]++;
      console.log(`  ${String(i + 1).padStart(3)}/${providers.length}  ${decision.quality.padEnd(11)} ${p.name}`);
      done = true;
      break;
    }

    if (!done) {
      // Stamp the attempt so a plain re-run does not retry it forever, but
      // leave the coordinates null — --retry-misses picks these up.
      await prisma.educationProvider.update({
        where: { id: p.id },
        data: { geocodedAt: new Date(), geocodeSource: 'nominatim:miss' },
      });
      misses.push({ name: p.name, reason: 'no confident New Zealand match' });
      console.log(`  ${String(i + 1).padStart(3)}/${providers.length}  MISS        ${p.name}`);
    }
  }

  const withCoords = await prisma.educationProvider.count({
    where: { programmes: { some: { sourceRef: { not: null } } }, latitude: { not: null } },
  });

  console.log('\n══════ RESULT ══════');
  console.log(`  campus-accurate pins      : ${byQuality.campus}`);
  console.log(`  institution-level pins    : ${byQuality.institution}`);
  console.log(`  city-level pins (approx)  : ${byQuality.city}`);
  console.log(`  could not geocode         : ${misses.length}`);
  console.log(`\n  institutions with a pin   : ${withCoords} / ${total}`);
  if (misses.length) {
    console.log('\n  NOT PINNED (these still appear in results, just without a map pin):');
    misses.forEach((m) => console.log(`    · ${m.name} — ${m.reason}`));
    console.log('\n  Re-try just these with: npx ts-node --transpile-only scripts/geocode-providers.ts --retry-misses');
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
