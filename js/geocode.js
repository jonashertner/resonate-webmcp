// geocode.js — Nominatim (OpenStreetMap) search + reverse geocoding

const BASE = 'https://nominatim.openstreetmap.org';

// The Nominatim usage policy asks for at most one request a second, and for
// results to be cached rather than asked for twice. Both are kept here, so no
// caller can breach the policy by accident.
const MIN_GAP_MS = 1100;
const CACHE_MAX = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const memo = new Map();
let lastCall = 0;
let queue = Promise.resolve();

function cached(key) {
  const hit = memo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { memo.delete(key); return null; }
  // keep it warm: most recently used last
  memo.delete(key); memo.set(key, hit);
  return hit.value;
}

function remember(key, value) {
  memo.set(key, { at: Date.now(), value });
  while (memo.size > CACHE_MAX) memo.delete(memo.keys().next().value);
}

// one request at a time, never closer together than the policy allows
function paced(fn) {
  const run = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

function pickCity(addr = {}) {
  return addr.city || addr.town || addr.village || addr.municipality || addr.hamlet || addr.suburb || '';
}

function shortName(r) {
  if (r.name) return r.name;
  return (r.display_name || '').split(',')[0].trim();
}

function subLine(r) {
  const name = shortName(r);
  const parts = (r.display_name || '').split(',').map(s => s.trim()).filter(s => s && s !== name);
  const head = parts.slice(0, 2);
  // always end with the country so same-named places are tellable apart
  const country = (r.address && r.address.country) || parts[parts.length - 1];
  if (country && !head.includes(country)) head.push(country);
  return head.join(', ');
}

function toResult(r) {
  const addr = r.address || {};
  return {
    name: shortName(r),
    sub: subLine(r),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    address: subLine(r),
    city: pickCity(addr),
    country: addr.country || '',
    countryCode: (addr.country_code || '').toLowerCase(),
    kind: r.type || '',
  };
}

export async function searchGeo(query, { signal, limit = 6 } = {}) {
  const q = String(query || '').trim();
  const key = `s:${limit}:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return hit;
  const url = `${BASE}/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`;
  const rows = await paced(async () => {
    const res = await fetch(url, { signal, headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    return res.json();
  });
  const out = rows.map(toResult).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  remember(key, out);
  return out;
}

export async function reverseGeo(lat, lng, { signal } = {}) {
  // a fix is only worth asking about to about a metre
  const key = `r:${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;
  const hit = cached(key);
  if (hit !== null && hit !== undefined) return hit;
  const url = `${BASE}/reverse?format=jsonv2&addressdetails=1&zoom=17&lat=${lat}&lon=${lng}`;
  const r = await paced(async () => {
    const res = await fetch(url, { signal, headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!res.ok) throw new Error(`Reverse geocoding failed (${res.status})`);
    return res.json();
  });
  const out = r.error ? null : toResult(r);
  remember(key, out);
  return out;
}

// ---------- recognition, while a person is still typing ----------
//
// Nominatim above answers when it is asked, once, deliberately: its usage
// policy forbids autocomplete outright, and the pacing in `paced` is what
// keeps this app honest about that. So the as-you-type answer comes from a
// different door. Photon is the OSM typeahead built for exactly this, run by
// komoot on the same data, and its results are ODbL, which the field's own
// © OSM mark already attributes.
//
// The two are not interchangeable and both stay. Photon is built to answer
// half a word and is thin on full addresses; Nominatim reads an address, and
// it is the only one asked to name the ground under a coordinate. Which is
// why the world row survives underneath the suggestions: what a person meant
// is not always what a prefix matches.
//
// Politeness here is a debounce and an abort at the caller, not a queue: this
// is a public instance with no published rate, and at real scale the answer is
// to run our own, which is club-grade work under the standing rule.
//
// The caveat worth saying out loud on the surface: OSM's coverage of small
// businesses trails Google's in some regions, and a place the index has never
// heard of is still a place, marked on the field by hand.
const PHOTON = 'https://photon.komoot.io';

// photon speaks four languages, and answering in a fifth is not one of the
// things it does: ask in one it knows, or take its default
function photonLang() {
  const tag = String(navigator.language || 'en').slice(0, 2).toLowerCase();
  return ['de', 'en', 'fr', 'it'].includes(tag) ? tag : 'en';
}

function toSuggestion(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry?.coordinates || [];
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const city = p.city || p.town || p.village || p.district || '';
  const name = p.name || street || city || p.state || p.country || '';
  const parts = [];
  if (street && street !== name) parts.push(street);
  if (city && city !== name) parts.push(city);
  if (p.state && p.state !== city && p.state !== name) parts.push(p.state);
  if (p.country && !parts.includes(p.country)) parts.push(p.country);
  const sub = parts.slice(0, 3).join(', ');
  return {
    name,
    sub,
    lat: Number(lat),
    lng: Number(lng),
    address: sub,
    city,
    country: p.country || '',
    countryCode: String(p.countrycode || '').toLowerCase(),
    kind: p.osm_value || p.type || '',
  };
}

export async function suggestGeo(query, { signal, limit = 5, at = null } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  // where the field is looking, to about a kilometre. it decides which Springfield
  // comes first and is not precise enough to say where anybody is standing.
  const near = at && Number.isFinite(at.lat) && Number.isFinite(at.lng)
    ? `&lat=${at.lat.toFixed(2)}&lon=${at.lng.toFixed(2)}` : '';
  const key = `p:${limit}:${near}:${photonLang()}:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return hit;
  const url = `${PHOTON}/api/?limit=${limit}&lang=${photonLang()}&q=${encodeURIComponent(q)}${near}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Suggestions failed (${res.status})`);
  const data = await res.json();
  const out = (data.features || [])
    .map(toSuggestion)
    .filter(r => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng));
  remember(key, out);
  return out;
}

export function fmtCoord(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns} · ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

// degrees-and-minutes, the way charts label a graticule (never GPS decimals)
export function fmtDM(value, isLat) {
  const hemi = isLat ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
  let v = Math.abs(value);
  let d = Math.floor(v);
  let m = Math.round((v - d) * 60);
  if (m === 60) { d += 1; m = 0; }
  return m ? `${d}°${String(m).padStart(2, '0')}′${hemi}` : `${d}°${hemi}`;
}

export function fmtDMS(lat, lng) {
  return `${fmtDM(lat, true)} · ${fmtDM(lng, false)}`;
}

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function fmtDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
