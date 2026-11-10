#!/usr/bin/env node
// Log an outdoor workout (e.g. a Strava ride) into the 75 Hard data repo.
// Uses the GitHub CLI (`gh`) for auth, so no token is needed here.
//
// Usage:
//   node tools/log-ride.mjs --date 2026-11-11 [--gpx ride.gpx] [--min 142] [--km 38.4]
//        [--type Bike] [--stats "412 m elev · avg 16.3 km/h · HR 142"] [--notes "..."]
//        [--repo esperu4/75-hard-data] [--branch main] [--dry]
// Values given explicitly (from the Strava summary) win over values computed from the GPX.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
  if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));
const REPO = args.repo || 'esperu4/75-hard-data';
const BRANCH = args.branch || 'main';
const date = args.date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { console.error('--date YYYY-MM-DD is required'); process.exit(1); }

const gh = (path, { method = 'GET', body, raw } = {}) => {
  const a = ['api', `repos/${REPO}/${path}`, '-X', method];
  if (raw) a.push('-H', 'Accept: application/vnd.github.raw+json');
  if (body) a.push('--input', '-');
  const out = execFileSync('gh', a, { input: body ? JSON.stringify(body) : undefined, maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  return raw ? out : JSON.parse(out);
};

// ---------- GPX ----------
function parseGpx(xml) {
  const pts = [...xml.matchAll(/<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)].map(m => ({
    lat: +m[1], lon: +m[2],
    ele: +(/<ele>([-\d.]+)<\/ele>/.exec(m[3])?.[1] ?? NaN),
    t: Date.parse(/<time>([^<]+)<\/time>/.exec(m[3])?.[1] ?? ''),
    hr: +(/<(?:\w+:)?hr>(\d+)<\/(?:\w+:)?hr>/.exec(m[3])?.[1] ?? NaN),
  }));
  if (pts.length < 2) throw new Error('GPX has no track points');
  const R = 6371e3, rad = x => x * Math.PI / 180;
  let dist = 0, moving = 0, gain = 0, eleRef = pts[0].ele;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(h));
    dist += d;
    const dt = (b.t - a.t) / 1000;
    if (dt > 0 && dt < 120 && d / dt > 0.8) moving += dt; // count as moving above ~3 km/h
    if (!isNaN(b.ele)) { if (b.ele - eleRef > 3) { gain += b.ele - eleRef; eleRef = b.ele; } else if (eleRef - b.ele > 3) eleRef = b.ele; }
  }
  const hrs = pts.map(p => p.hr).filter(x => !isNaN(x));
  const start = pts.find(p => !isNaN(p.t))?.t;
  return {
    km: +(dist / 1000).toFixed(1),
    min: Math.round(moving / 60),
    elapsedMin: start ? Math.round((pts.at(-1).t - start) / 60000) : null,
    gain: Math.round(gain),
    avgHr: hrs.length ? Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length) : null,
    startTime: start ? new Date(start) : null,
  };
}

let g = null, gpxB64 = null;
if (args.gpx) {
  const xml = readFileSync(args.gpx, 'utf8');
  g = parseGpx(xml);
  gpxB64 = Buffer.from(xml).toString('base64');
  console.log(`GPX ${basename(args.gpx)}: ${g.km} km · ${g.min} min moving (${g.elapsedMin} elapsed) · +${g.gain} m${g.avgHr ? ' · avg HR ' + g.avgHr : ''}`);
}

const min = args.min != null ? Number(args.min) : g?.min;
const km = args.km != null ? Number(args.km) : g?.km;
const avgKmh = min && km ? (km / (min / 60)).toFixed(1) : null;
const stats = args.stats || [
  g?.gain != null ? `+${g.gain} m` : null,
  avgKmh ? `avg ${avgKmh} km/h` : null,
  g?.avgHr ? `avg HR ${g.avgHr}` : null,
  g?.startTime ? `start ${g.startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' })}` : null,
].filter(Boolean).join(' · ');

// ---------- update data.json ----------
let data;
try { data = JSON.parse(gh(`contents/data.json?ref=${BRANCH}`, { raw: true })); }
catch (err) {
  if (!String(err.stderr || err.message).includes('404')) throw err;
  data = { startDate: '2026-11-11', startSetAt: 0, days: {} }; // nothing synced from the app yet
}
data.days ||= {};
const e = data.days[date] ||= { date };
e.out ||= {};
e.out.type = args.type || e.out.type || 'Bike';
if (min != null && !isNaN(min)) e.out.min = min;
if (km != null && !isNaN(km)) e.out.km = km;
const line = `Strava: ${[km != null ? km + ' km' : null, min != null ? min + ' min' : null, stats].filter(Boolean).join(' · ')}`;
const keep = (e.out.notes || '').split('\n').filter(l => !l.startsWith('Strava:'));
e.out.notes = [line, args.notes, ...keep].filter(Boolean).join('\n');
if (gpxB64) e.out.route = `rides/${date}.gpx`;
if ((min ?? 0) >= 45) e.out.done = true;
e.check ||= {};
if (e.inside) e.check.workouts = !!(e.out.done && e.inside.done);
e.updatedAt = Date.now();
e.needsRender = true;

console.log(`\n${date}: ${e.out.type} · ${e.out.min ?? '–'} min · ${e.out.km ?? '–'} km · done=${!!e.out.done}\n${e.out.notes}`);
if (args.dry) { console.log('\n(dry run, nothing pushed)'); process.exit(0); }

// ---------- one commit: data.json (+ GPX) ----------
const base = gh(`git/ref/heads/${BRANCH}`).object.sha;
const baseTree = gh(`git/commits/${base}`).tree.sha;
const tree = [{ path: 'data.json', mode: '100644', type: 'blob', content: JSON.stringify(data, null, 1) }];
if (gpxB64) tree.push({ path: `rides/${date}.gpx`, mode: '100644', type: 'blob', sha: gh('git/blobs', { method: 'POST', body: { content: gpxB64, encoding: 'base64' } }).sha });
const t = gh('git/trees', { method: 'POST', body: { base_tree: baseTree, tree } });
const c = gh('git/commits', { method: 'POST', body: { message: `Ride ${date}: ${e.out.km ?? '?'} km, ${e.out.min ?? '?'} min (Strava)`, tree: t.sha, parents: [base] } });
gh(`git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: c.sha } });
console.log(`\nPushed ${c.sha.slice(0, 7)} to ${REPO}. Open the app to see it (it will refresh the day page).`);
