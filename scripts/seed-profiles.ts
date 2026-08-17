/**
 * Seed/refresh the model profiles on the live API.
 * Run: UGC_API_TOKEN=<operator-token> npx tsx scripts/seed-profiles.ts
 */
import { SEED_PROFILES } from '../worker/seeds/profiles';

const API = process.env.UGC_API_BASE ?? 'https://ugc-api.khian-moclou.workers.dev';
const TOKEN = process.env.UGC_API_TOKEN;
if (!TOKEN) { console.error('set UGC_API_TOKEN'); process.exit(1); }

for (const profile of SEED_PROFILES) {
  const res = await fetch(`${API}/profiles/${profile.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': TOKEN },
    body: JSON.stringify(profile),
  });
  const body = await res.json();
  console.log(`${profile.id}: HTTP ${res.status}`, JSON.stringify(body));
  if (!res.ok) process.exit(1);
}
console.log('profiles seeded');
