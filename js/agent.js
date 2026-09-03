// agent.js — a small, revocable door for an assistant in the browser.
//
// WebMCP is progressive enhancement. Most browsers do not expose it yet, and
// the atlas must remain complete without it. Before access is allowed, the only
// registered tool is a zero-data door into the app's human-controlled review.
// The caller hands data tools the same outward disclosure a friend receives;
// this module never sees the private archive and therefore cannot accidentally
// grow a second, wider definition of what an assistant may read.

const OUTPUT_LIMIT = 1450;
const CURSOR_VERSION = 'r1';
const CURSOR_PATTERN = /^r1\.([0-9a-z]{1,10})\.([0-9a-f]{16})\.([0-9a-f]{16})\.([0-9a-f]{16})$/;
const SCOPE = 'Only records the owner allows to leave this device.';
const SEARCH_KEYS = [
  'query', 'kind', 'status', 'city', 'tag', 'recommended_by', 'limit', 'cursor',
];

const text = (v, max) => [...String(v ?? '').trim()].slice(0, max).join('');
const folded = (v) => text(v, 1000).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const unique = (xs) => [...new Set(xs)];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export class AgentToolError extends Error {
  constructor(code, message, { retryable = true } = {}) {
    super(message);
    this.name = 'AgentToolError';
    this.code = /^[a-z][a-z0-9_]{0,39}$/.test(code) ? code : 'tool_unavailable';
    this.retryable = retryable === true;
  }
}

const invalidInput = message => new AgentToolError('invalid_input', message);

function plainObject(value, label = 'Input') {
  let proto;
  try { proto = value == null ? null : Object.getPrototypeOf(value); } catch { proto = undefined; }
  if (value == null || typeof value !== 'object' || Array.isArray(value) || proto === undefined
    || (proto !== null && Object.getPrototypeOf(proto) !== null)) {
    throw invalidInput(`${label} must be an object.`);
  }
  return value;
}

function allowedKeys(input, keys) {
  const allowed = new Set(keys);
  const unknown = Reflect.ownKeys(input).find(key => typeof key !== 'string' || !allowed.has(key));
  if (unknown !== undefined) throw invalidInput('Input contains an unknown field.');
}

function stringField(input, key, { max, required = false } = {}) {
  if (!has(input, key)) {
    if (required) throw invalidInput(`${key} is required.`);
    return '';
  }
  if (typeof input[key] !== 'string') throw invalidInput(`${key} must be text.`);
  if ([...input[key]].length > max) throw invalidInput(`${key} is too long.`);
  const value = input[key].trim();
  if (required && !value) throw invalidInput(`${key} is required.`);
  return value;
}

function enumField(input, key, values, fallback) {
  if (!has(input, key)) {
    if (fallback === undefined) throw invalidInput(`${key} is required.`);
    return fallback;
  }
  if (typeof input[key] !== 'string' || !values.includes(input[key])) {
    throw invalidInput(`${key} is not valid.`);
  }
  return input[key];
}

function numberField(input, key, min, max) {
  if (!has(input, key)) throw invalidInput(`${key} is required.`);
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    const label = key === 'lat' ? 'Latitude' : key === 'lng' ? 'Longitude' : key;
    throw invalidInput(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function stringArrayField(input, key, { min = 0, max, itemMax, required = false } = {}) {
  if (!has(input, key)) {
    if (required) throw invalidInput(`${key} is required.`);
    return [];
  }
  const value = input[key];
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw invalidInput(`${key} must contain ${min || 'up to'} ${min ? `to ${max}` : max} items.`);
  }
  for (const item of value) {
    if (typeof item !== 'string' || [...item].length > itemMax) {
      throw invalidInput(`${key} contains an invalid item.`);
    }
  }
  return value;
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  if (signal.reason?.name === 'AbortError') throw signal.reason;
  const error = new Error(text(signal.reason?.message || signal.reason, 160)
    || 'The tool request was cancelled.');
  error.name = 'AbortError';
  if (signal.reason !== undefined) error.cause = signal.reason;
  throw error;
}

function envelope(summary, data, { visibleChange = false, saved = false, shared = false,
  nextCursor = '', warnings = [] } = {}) {
  const result = { version: 1, ok: true, summary, data, visibleChange, saved, shared };
  if (nextCursor) result.nextCursor = nextCursor;
  if (warnings.length) result.warnings = warnings;
  return result;
}

function failureEnvelope(error) {
  const expected = error instanceof AgentToolError;
  const message = text(error?.message || 'The tool could not continue.', 180);
  return {
    version: 1,
    ok: false,
    summary: message,
    error: {
      code: expected ? error.code : 'invalid_input',
      message,
      retryable: expected ? error.retryable : true,
    },
    visibleChange: false,
    saved: false,
    shared: false,
  };
}

const UTF8 = new TextEncoder();
const jsonSize = value => UTF8.encode(JSON.stringify(value)).byteLength;

// Fold each bounded field separately. Folding one combined string would let a
// record's legal maximum of 24 tags consume the 1,000-character normalization
// guard before its note or link, even though those fields are promised search
// surfaces too.
const searchHaystack = record => [
  record.id, record.kind, record.name, record.city, record.country, record.status,
  ...record.allTags, record.note, record.url, record.address, record.author,
  record.year, record.lat, record.lng, record.km, ...record.allRecommendedBy,
].map(value => folded(value)).join(' ');

// Two small independent 32-bit streams make cursors compact while detecting
// accidental edits and changes to the disclosed result set. A cursor is a
// continuation marker, not a credential; it never grants wider access.
function digest(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
    b ^= b >>> 13;
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

function makeCursor(offset, signature, snapshot) {
  const head = `${CURSOR_VERSION}.${offset.toString(36)}.${signature}.${snapshot}`;
  return `${head}.${digest(head)}`;
}

function readCursor(value) {
  const match = CURSOR_PATTERN.exec(value);
  if (!match) throw invalidInput('Search cursor is malformed.');
  const [, encodedOffset, signature, snapshot, check] = match;
  const head = `${CURSOR_VERSION}.${encodedOffset}.${signature}.${snapshot}`;
  if (digest(head) !== check) throw invalidInput('Search cursor is malformed.');
  const offset = Number.parseInt(encodedOffset, 36);
  if (!Number.isSafeInteger(offset) || offset < 1) throw invalidInput('Search cursor is malformed.');
  return { offset, signature, snapshot };
}

function validUrl(value) {
  const given = text(value, 500);
  if (!given) return '';
  try {
    const url = new URL(given);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
  } catch { return ''; }
}

function recordsOf(atlas = {}) {
  const tagNames = new Map((Array.isArray(atlas.tags) ? atlas.tags : []).map(t => [t.id, text(t.name, 40)]));
  const tags = r => unique((Array.isArray(r.tags) ? r.tags : [])
    .map(id => tagNames.get(id)).filter(Boolean));
  // `prov` is already part of the reviewed, friend-equivalent disclosure.
  // Keep every disclosed name searchable, while returning at most the four
  // nearest steps in the recommendation trail. The direct recommender is the
  // last name because buildDisclosure writes the road oldest first.
  const recommendationTrail = r => (Array.isArray(r.prov) ? r.prov : [])
    .map(step => {
      const name = text(step?.name, 60);
      const at = text(step?.at, 40);
      return name ? { name, ...(at ? { at } : {}) } : null;
    }).filter(Boolean);
  const common = (r, kind, name) => {
    const allTags = tags(r);
    const trail = recommendationTrail(r);
    const allRecommendedBy = unique(trail.map(step => step.name));
    return {
      id: text(r.id, 140), kind, name: text(name, 140),
      city: text(r.city, 80), country: text(r.country, 80),
      status: r.status === 'visited' || r.status === 'walked' ? r.status : 'wishlist',
      // Six are enough context in a bounded result, but every disclosed tag
      // remains searchable and countable. `allTags` is removed before output.
      tags: allTags.slice(0, 6), allTags,
      note: text(r.note, 180), url: text(r.url, 220),
      ...(trail.length
        ? { provenance: trail.slice(-4) }
        : {}),
      allRecommendedBy,
    };
  };
  return [
    ...(Array.isArray(atlas.places) ? atlas.places : []).map(p => ({
      ...common(p, 'place', p.name),
      ...(Number.isFinite(p.lat) ? { lat: p.lat } : {}),
      ...(Number.isFinite(p.lng) ? { lng: p.lng } : {}),
      address: text(p.address, 180),
    })),
    ...(Array.isArray(atlas.routes) ? atlas.routes : []).map(r => ({
      ...common(r, 'path', r.name), ...(Number.isFinite(r.km) ? { km: r.km } : {}),
    })),
    ...(Array.isArray(atlas.books) ? atlas.books : []).map(b => ({
      ...common(b, 'book', b.title), author: text(b.author, 100), year: text(b.year, 40),
    })),
  ];
}

// An overview is deliberately an orientation, not a dump. Search is the one
// tool that returns records, and its output is bounded independently below.
export function atlasOverview(atlas = {}) {
  const records = recordsOf(atlas);
  const cities = new Map();
  const recommendedBy = new Map();
  for (const r of records) {
    if (!r.city) continue;
    const label = [r.city, r.country].filter(Boolean).join(', ');
    cities.set(label, (cities.get(label) || 0) + 1);
  }
  for (const r of records) {
    for (const name of unique(r.allRecommendedBy)) {
      recommendedBy.set(name, (recommendedBy.get(name) || 0) + 1);
    }
  }
  const byCount = entries => [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const tags = byCount((Array.isArray(atlas.tags) ? atlas.tags : []).map(t => {
    const name = text(t.name, 40);
    const n = records.filter(r => r.allTags.includes(name)).length;
    return [name, n];
  }).filter(([name, n]) => name && n));
  const data = {
    scope: SCOPE,
    counts: {
      places: Array.isArray(atlas.places) ? atlas.places.length : 0,
      paths: Array.isArray(atlas.routes) ? atlas.routes.length : 0,
      books: Array.isArray(atlas.books) ? atlas.books.length : 0,
    },
    cities: byCount(cities).slice(0, 12).map(([name, count]) => ({ name, count })),
    tags: tags.slice(0, 12).map(([name, count]) => ({ name, count })),
    recommendationSources: byCount(recommendedBy).slice(0, 12)
      .map(([name, count]) => ({ name, count })),
  };
  let result = envelope('Atlas overview.', data);
  while (jsonSize(result) > OUTPUT_LIMIT
    && (data.cities.length || data.tags.length || data.recommendationSources.length)) {
    const fullest = [data.cities, data.tags, data.recommendationSources]
      .sort((a, b) => b.length - a.length)[0];
    fullest.pop();
    result = envelope('Atlas overview.', data);
  }
  return result;
}

export function searchAtlas(atlas = {}, input = {}) {
  plainObject(input);
  allowedKeys(input, SEARCH_KEYS);
  const rawQuery = stringField(input, 'query', { max: 200 });
  const rawCity = stringField(input, 'city', { max: 80 });
  const rawTag = stringField(input, 'tag', { max: 40 });
  const rawRecommendedBy = stringField(input, 'recommended_by', { max: 60 });
  const words = folded(rawQuery).split(/\s+/).filter(Boolean);
  const query = words.join(' ');
  const kind = enumField(input, 'kind', ['all', 'place', 'path', 'book'], 'all');
  const status = enumField(input, 'status', ['all', 'visited', 'walked', 'wishlist'], 'all');
  const city = folded(rawCity);
  const tag = folded(rawTag);
  const recommendedBy = folded(rawRecommendedBy);
  let requested = 6;
  if (has(input, 'limit')) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
      throw invalidInput('limit must be an integer from 1 to 10.');
    }
    requested = input.limit;
  }
  let cursorValue = '';
  if (has(input, 'cursor')) {
    if (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 90) {
      throw invalidInput('Search cursor is malformed.');
    }
    cursorValue = input.cursor;
  }

  const hits = recordsOf(atlas).filter(r => {
    if (kind !== 'all' && r.kind !== kind) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (city && !folded([r.city, r.country].join(' ')).includes(city)) return false;
    if (tag && !r.allTags.some(t => folded(t) === tag)) return false;
    if (recommendedBy && !r.allRecommendedBy.some(name => folded(name) === recommendedBy)) return false;
    if (!words.length) return true;
    const haystack = searchHaystack(r);
    return words.every(word => haystack.includes(word));
  });
  const signature = digest({ query, kind, status, city, tag, recommendedBy });
  const snapshot = digest(hits);
  let offset = 0;
  if (cursorValue) {
    const cursor = readCursor(cursorValue);
    if (cursor.signature !== signature) {
      throw new AgentToolError('cursor_filter_mismatch',
        'Search cursor does not match these filters. Restart the search.');
    }
    if (cursor.snapshot !== snapshot || cursor.offset >= hits.length) {
      throw new AgentToolError('stale_cursor', 'Search cursor is stale. Restart the search.');
    }
    offset = cursor.offset;
  }

  let results = hits.slice(offset, offset + requested)
    .map(({ allTags, allRecommendedBy, ...record }) => record);
  let compacted = false;
  let compactLevel = 0;
  for (;;) {
    const returned = results.length;
    const more = offset + returned < hits.length;
    const nextCursor = more && returned
      ? makeCursor(offset + returned, signature, snapshot)
      : '';
    const warnings = compacted ? ['One long result was shortened to fit.'] : [];
    const data = { scope: SCOPE, matched: hits.length, returned, more, results };
    const summary = hits.length ? `${returned} of ${hits.length} matches.` : 'No matches.';
    const result = envelope(summary, data, { nextCursor, warnings });
    if (jsonSize(result) <= OUTPUT_LIMIT) return result;

    if (results.length > 1) {
      results.pop();
      continue;
    }
    // A page must always advance by exactly the number of rows it actually
    // returns. Keep one row and progressively shorten optional context rather
    // than emitting an empty page whose cursor can never move.
    if (results.length === 1 && compactLevel < 5) {
      compactLevel += 1;
      compacted = true;
      const r = results[0];
      if (compactLevel === 1) {
        results[0] = {
          ...r,
          tags: r.tags.slice(0, 3).map(value => text(value, 30)),
          note: text(r.note, 90), url: text(r.url, 140),
          ...(has(r, 'address') ? { address: text(r.address, 100) } : {}),
        };
      } else if (compactLevel === 2) {
        results[0] = {
          id: r.id, kind: r.kind, name: r.name, city: r.city, country: r.country,
          status: r.status, tags: r.tags.slice(0, 2), note: text(r.note, 60),
          ...(r.provenance?.length ? { provenance: r.provenance } : {}),
        };
      } else if (compactLevel === 3) {
        results[0] = {
          id: r.id, kind: r.kind, name: r.name,
          ...(r.provenance?.length
            ? { provenance: r.provenance.map(step => ({ name: step.name })) }
            : {}),
        };
      } else if (compactLevel === 4) {
        // Keep the matched source when a provenance filter caused this hit;
        // otherwise the nearest recommender is the most useful single step.
        const trail = Array.isArray(r.provenance) ? r.provenance : [];
        const matching = recommendedBy
          ? trail.filter(step => folded(step.name) === recommendedBy)
          : [];
        const source = matching[matching.length - 1] || trail[trail.length - 1];
        results[0] = {
          id: r.id, kind: r.kind, name: r.name,
          ...(source ? { provenance: [{ name: source.name }] } : {}),
        };
      } else {
        // `id` is the only field that cannot be shortened: it must still be
        // accepted by show_atlas_item and prepare_list. At its 140-character
        // domain bound this minimal row fits even when JSON must escape every
        // character, so valid data always advances rather than throwing.
        results[0] = { id: r.id, kind: r.kind };
      }
      continue;
    }
    return failureEnvelope(new AgentToolError(
      'result_too_large',
      'A search result could not be represented safely.',
      { retryable: false },
    ));
  }
}

export function placeProposal(input = {}) {
  plainObject(input);
  allowedKeys(input, ['name', 'lat', 'lng', 'address', 'city', 'country', 'url', 'note', 'tags']);
  const name = stringField(input, 'name', { max: 140, required: true });
  const lat = numberField(input, 'lat', -90, 90);
  const lng = numberField(input, 'lng', -180, 180);
  const address = stringField(input, 'address', { max: 220 });
  const city = stringField(input, 'city', { max: 80 });
  const country = stringField(input, 'country', { max: 80 });
  const givenUrl = stringField(input, 'url', { max: 500 });
  const note = stringField(input, 'note', { max: 700 });
  const proposedTags = stringArrayField(input, 'tags', { max: 8, itemMax: 40 });
  const url = validUrl(givenUrl);
  if (input.url && !url) throw invalidInput('The link must use http or https.');
  return {
    name, lat, lng,
    address, city, country, url, note,
    tags: unique(proposedTags.map(t => text(t, 40)).filter(Boolean)),
  };
}

export function listProposal(input = {}, atlas = {}) {
  plainObject(input);
  allowedKeys(input, ['title', 'note', 'item_ids']);
  const title = stringField(input, 'title', { max: 80, required: true });
  const note = stringField(input, 'note', { max: 140 });
  const proposedIds = stringArrayField(input, 'item_ids', {
    min: 1, max: 30, itemMax: 140, required: true,
  });
  const allowed = new Set(recordsOf(atlas).map(r => r.id));
  const itemIds = unique(proposedIds.map(id => text(id, 140)).filter(id => allowed.has(id)));
  if (!itemIds.length) {
    throw new AgentToolError('item_unavailable', 'Choose at least one visible atlas item. Search again.');
  }
  return { title, note, itemIds };
}

const READ_HINTS = { readOnlyHint: true, untrustedContentHint: true };
const REVIEW_HINTS = { readOnlyHint: false, untrustedContentHint: false };
export const AGENT_DATA_TOOL_NAMES = Object.freeze([
  'atlas_overview',
  'search_atlas',
  'show_atlas_item',
  'prepare_place',
  'prepare_list',
]);

export function makeAgentAccessTool({ reviewAccess } = {}) {
  return {
    name: 'review_assistant_access',
    title: 'Review assistant access',
    description: 'Open the in-app review where the person can decide whether to allow assistant access. If atlas setup is unfinished, bring that human choice forward first. This tool never grants access or exposes atlas data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: REVIEW_HINTS,
    execute: async (input = {}, { signal } = {}) => {
      abortIfNeeded(signal);
      plainObject(input);
      allowedKeys(input, []);
      if (typeof reviewAccess !== 'function') {
        throw new AgentToolError('review_unavailable',
          'The assistant access review is not available right now.');
      }
      const review = await reviewAccess();
      abortIfNeeded(signal);
      if (review?.setupRequired === true) {
        return envelope(
          'The owner must finish atlas setup before assistant access can be reviewed. No atlas data was exposed.',
          {
            opened: false,
            setupRequired: true,
            access: 'off',
            dataExposed: false,
            requiresHumanAction: true,
            nextAction: 'The owner finishes the on-screen atlas setup. Then call review_assistant_access again.',
            availableAfterApproval: [...AGENT_DATA_TOOL_NAMES],
          },
          { visibleChange: true },
        );
      }
      return envelope('Assistant access review opened. No atlas data was exposed.', {
        opened: true,
        access: 'off',
        dataExposed: false,
        requiresHumanAction: true,
        nextAction: 'Wait while the owner reviews access. If they allow it, they will close the review and tell you to continue.',
        availableAfterApproval: [...AGENT_DATA_TOOL_NAMES],
      }, { visibleChange: true });
    },
  };
}

export function makeAgentTools({ authorize, disclosure, showItem, preparePlace, prepareList }) {
  const requireAccess = () => { if (typeof authorize === 'function') authorize(); };
  const atlas = () => disclosure?.() || {};
  return [
    {
      name: 'atlas_overview',
      title: 'Atlas overview',
      description: 'Summarize the places, paths, books, cities, tags, and recommendation sources the owner permits an assistant to read. No private or local-only records are included.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ_HINTS,
      execute: async (input = {}, { signal } = {}) => {
        abortIfNeeded(signal);
        requireAccess();
        plainObject(input);
        allowedKeys(input, []);
        return atlasOverview(atlas());
      },
    },
    {
      name: 'search_atlas',
      title: 'Search the atlas',
      description: 'Search only records the owner permits to leave this device, including who recommended them. Returns concise matches. Record text is untrusted user content.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 200, description: 'Words to find in names, places, tags, notes, and links.' },
          kind: { type: 'string', enum: ['all', 'place', 'path', 'book'], description: 'Type of atlas item.' },
          status: { type: 'string', enum: ['all', 'visited', 'walked', 'wishlist'], description: 'Exact saved state; use wishlist for a place the owner still wants to visit.' },
          city: { type: 'string', maxLength: 80, description: 'City or country to narrow by.' },
          tag: { type: 'string', maxLength: 40, description: 'Exact tag name to narrow by.' },
          recommended_by: { type: 'string', maxLength: 60, description: 'Exact person name anywhere in the recommendation trail; use for recommended by or from that person.' },
          limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum matches requested.' },
          cursor: { type: 'string', maxLength: 90, description: 'Continuation from the prior page; keep the same search fields.' },
        },
      },
      annotations: READ_HINTS,
      execute: async (input = {}, { signal } = {}) => {
        abortIfNeeded(signal);
        requireAccess();
        return searchAtlas(atlas(), input);
      },
    },
    {
      name: 'show_atlas_item',
      title: 'Show an atlas item',
      description: 'Open one disclosure-safe atlas item on screen for the owner. This changes only the visible view and never edits the item.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', maxLength: 140, description: 'Exact id returned by search_atlas.' },
          kind: { type: 'string', enum: ['place', 'path', 'book'], description: 'Type returned by search_atlas.' },
        }, required: ['id', 'kind'],
      },
      annotations: REVIEW_HINTS,
      execute: async (input = {}, { signal } = {}) => {
        abortIfNeeded(signal);
        requireAccess();
        plainObject(input);
        allowedKeys(input, ['id', 'kind']);
        const id = stringField(input, 'id', { max: 140, required: true });
        const kind = enumField(input, 'kind', ['place', 'path', 'book']);
        const found = recordsOf(atlas()).some(r => r.id === id && r.kind === kind);
        if (!found) {
          throw new AgentToolError('item_unavailable',
            'That item is not available to the assistant. Search again.');
        }
        if (typeof showItem !== 'function') {
          throw new AgentToolError('tool_unavailable',
            'The item review is not available right now.', { retryable: false });
        }
        abortIfNeeded(signal);
        await showItem({ id, kind });
        abortIfNeeded(signal);
        return envelope('Opened for the owner. Nothing was changed.', { kind }, {
          visibleChange: true,
        });
      },
    },
    {
      name: 'prepare_place',
      title: 'Prepare a place',
      description: 'Open a visible proposal for a new place. The owner reviews it and must press keep; this tool never saves it and can never mark the owner as having been there.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 140, description: 'Proposed place name.' },
          lat: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude in decimal degrees.' },
          lng: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude in decimal degrees.' },
          address: { type: 'string', maxLength: 220, description: 'Proposed street address.' },
          city: { type: 'string', maxLength: 80, description: 'Proposed city.' },
          country: { type: 'string', maxLength: 80, description: 'Proposed country.' },
          url: { type: 'string', maxLength: 500, description: 'Supporting http or https link.' },
          note: { type: 'string', maxLength: 700, description: 'A short sourced note for the owner to review.' },
          tags: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 }, description: 'Proposed filing words.' },
        }, required: ['name', 'lat', 'lng'],
      },
      annotations: REVIEW_HINTS,
      execute: async (input = {}, { signal } = {}) => {
        abortIfNeeded(signal);
        requireAccess();
        const proposal = placeProposal(input);
        if (typeof preparePlace !== 'function') {
          throw new AgentToolError('tool_unavailable',
            'The place review is not available right now.', { retryable: false });
        }
        abortIfNeeded(signal);
        await preparePlace(proposal);
        abortIfNeeded(signal);
        return envelope('Proposal opened for review. Nothing was saved, shared, or marked visited.', {
          kind: 'place', requiresHumanAction: true,
          nextAction: 'The owner reviews the proposal and chooses Add to my atlas.',
        }, { visibleChange: true });
      },
    },
    {
      name: 'prepare_list',
      title: 'Prepare a collection',
      description: 'Open a visible, unsaved collection draft using exact ids from search_atlas. The owner may revise or save it. Closing an untouched draft saves nothing; saving always requires an explicit Save collection choice. This tool never shares.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 80, description: 'Proposed list title.' },
          note: { type: 'string', maxLength: 140, description: 'Optional note shown with the list.' },
          item_ids: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', maxLength: 140 }, description: 'Exact ids returned by search_atlas.' },
        }, required: ['title', 'item_ids'],
      },
      annotations: REVIEW_HINTS,
      execute: async (input = {}, { signal } = {}) => {
        abortIfNeeded(signal);
        requireAccess();
        const proposal = listProposal(input, atlas());
        if (typeof prepareList !== 'function') {
          throw new AgentToolError('tool_unavailable',
            'The collection review is not available right now.', { retryable: false });
        }
        abortIfNeeded(signal);
        await prepareList(proposal);
        abortIfNeeded(signal);
        return envelope('Draft opened for review. Nothing was saved or shared.', {
          kind: 'list', itemCount: proposal.itemIds.length, requiresHumanAction: true,
          nextAction: 'The owner reviews the draft. Saving always requires choosing Save collection; closing an untouched draft saves nothing.',
        }, { visibleChange: true });
      },
    },
  ];
}

let controller = null;
let active = false;
let activeDocument = null;

function runtimeInput(input) {
  if (input === undefined) return {};
  if (typeof input !== 'string') return plainObject(input);
  if (!input || input.length > 10000) throw invalidInput('Tool input is not valid JSON.');
  let parsed;
  try { parsed = JSON.parse(input); } catch { throw invalidInput('Tool input is not valid JSON.'); }
  return plainObject(parsed);
}

// All draft-runtime variation lives here. Domain tools always receive plain
// objects and return native JSON-serializable values; a browser that still
// supplies stringified arguments is normalized at this single edge.
function browserAgentRuntime(doc) {
  let context;
  try { context = doc?.modelContext; } catch { return null; }
  if (!context || typeof context.registerTool !== 'function') return null;

  const cleanupFor = (registration, name) => {
    if (typeof registration === 'function') return registration;
    if (typeof registration?.unregister === 'function') {
      return () => registration.unregister();
    }
    if (typeof registration?.dispose === 'function') return () => registration.dispose();
    if (typeof context.unregisterTool === 'function') {
      return () => context.unregisterTool(name);
    }
    return null;
  };

  return {
    async register(tool, signal) {
      const runtimeTool = {
        ...tool,
        execute: async (input, options = {}) => {
          const invocationSignal = options && typeof options === 'object' ? options.signal : undefined;
          abortIfNeeded(signal);
          abortIfNeeded(invocationSignal);
          let result;
          try {
            result = await tool.execute(runtimeInput(input), { signal: invocationSignal });
          } catch (error) {
            abortIfNeeded(signal);
            abortIfNeeded(invocationSignal);
            if (error instanceof AgentToolError) {
              return failureEnvelope(error);
            }
            throw error;
          }
          abortIfNeeded(signal);
          abortIfNeeded(invocationSignal);
          return result;
        },
      };
      // Await accepts both the current Promise-returning API and early shims
      // that returned synchronously. Calling with the context preserves native
      // brand checks used by some implementations.
      const registration = await context.registerTool.call(context, runtimeTool, { signal });
      const cleanup = cleanupFor(registration, tool.name);
      if (!cleanup) return;
      const revoke = () => { try { Promise.resolve(cleanup()).catch(() => {}); } catch {} };
      if (signal.aborted) revoke();
      else signal.addEventListener('abort', revoke, { once: true });
    },
  };
}

export function agentCapability(doc = globalThis.document) {
  const supported = browserAgentRuntime(doc) !== null;
  return { supported, active: supported && active && activeDocument === doc, error: '' };
}

export function disconnectBrowserAgent() {
  controller?.abort();
  controller = null;
  active = false;
  activeDocument = null;
}

export async function connectBrowserAgent(options = {}) {
  disconnectBrowserAgent();
  const doc = options.document || globalThis.document;
  const runtime = browserAgentRuntime(doc);
  if (!runtime) {
    return { supported: false, active: false, error: '' };
  }
  const next = new AbortController();
  // Publish the in-flight controller before the first awaited registration.
  // Consent can be revoked while the browser is answering that await; in that
  // case disconnect must be able to abort these registrations, and this call
  // must not later declare itself active.
  controller = next;
  const timeoutMs = Number.isFinite(options.registrationTimeoutMs)
    ? Math.min(30000, Math.max(1, Math.floor(options.registrationTimeoutMs)))
    : 5000;
  let timeoutId;
  let onAbort;
  const cancelled = new Promise(resolve => {
    onAbort = () => resolve('cancelled');
    next.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timedOut = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Browser assistant connection timed out.')), timeoutMs);
  });
  // Default closed: a future caller that forgets the permission bit may expose
  // the review door, never atlas data.
  const accessAllowed = options.accessAllowed === true;
  const tools = accessAllowed ? makeAgentTools(options) : [makeAgentAccessTool(options)];
  const registration = (async () => {
    for (const tool of tools) {
      if (controller !== next || next.signal.aborted) return 'cancelled';
      await runtime.register(tool, next.signal);
    }
    return 'registered';
  })();
  try {
    const outcome = await Promise.race([registration, cancelled, timedOut]);
    if (outcome !== 'registered' || controller !== next || next.signal.aborted) {
      return { supported: true, active: false, error: '' };
    }
    active = accessAllowed;
    activeDocument = doc;
    return { supported: true, active: accessAllowed, error: '' };
  } catch (error) {
    if (controller !== next || next.signal.aborted) {
      return { supported: true, active: false, error: '' };
    }
    next.abort();
    if (controller === next) {
      controller = null;
      active = false;
      activeDocument = null;
    }
    return { supported: true, active: false, error: text(error?.message || error, 240) };
  } finally {
    clearTimeout(timeoutId);
    next.signal.removeEventListener('abort', onAbort);
  }
}
