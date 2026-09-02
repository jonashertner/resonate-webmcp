// library.js — one searchable library, without teaching every caller the
// different words places, paths and books use for the same ideas.
//
// This module is deliberately pure. It knows the records already held by the
// store, but it knows nothing about the DOM, persistence, maps or network.

const KIND_ALIASES = new Map([
  ['place', 'place'], ['places', 'place'],
  ['path', 'path'], ['paths', 'path'],
  ['route', 'path'], ['routes', 'path'],
  ['way', 'path'], ['ways', 'path'],
  ['book', 'book'], ['books', 'book'],
]);

const VISITED = new Set(['visited', 'walked', 'read', 'been', 'done', 'experienced']);
const WISHLIST = new Set(['wishlist', 'want', 'wanted', 'planned']);

const array = value => Array.isArray(value) ? value : [];

function kindWord(value) {
  return KIND_ALIASES.get(String(value == null ? '' : value).trim().toLowerCase()) || '';
}

/**
 * Return the public kind of a stored record: place, path or book.
 *
 * Places predate the `kind` field and therefore normally need either the
 * collection hint supplied by searchLibrary or the final shape fallback.
 */
export function recordKind(record, hint = '') {
  const fromHint = kindWord(hint);
  if (fromHint) return fromHint;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return '';

  const explicit = kindWord(record.kind);
  if (explicit) return explicit;
  if (Object.hasOwn(record, 'title') || Object.hasOwn(record, 'author')) return 'book';
  if (Array.isArray(record.path) || Object.hasOwn(record, 'walkedAt')
    || Object.hasOwn(record, 'ascent') || Object.hasOwn(record, 'descent')) return 'path';
  return 'place';
}

/**
 * Map the type-specific completed word back to the two states the existing
 * atlas filters understand. A walked path is the path equivalent of a visited
 * place or a read book.
 */
export function recordState(record, hint = '') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'wishlist';
  const raw = String(record.status == null ? '' : record.status).trim().toLowerCase();
  if (VISITED.has(raw)) return 'visited';
  if (WISHLIST.has(raw)) return 'wishlist';
  if (recordKind(record, hint) === 'path' && record.walkedAt) return 'visited';
  return 'wishlist';
}

/** The words a person sees for one canonical library state. */
export function stateLabel(kind, state) {
  const k = kindWord(kind) || 'place';
  const s = VISITED.has(String(state == null ? '' : state).trim().toLowerCase())
    ? 'visited' : 'wishlist';
  if (k === 'book') return s === 'visited' ? 'read' : 'want to read';
  if (k === 'path') return s === 'visited' ? 'walked' : 'want to walk';
  return s === 'visited' ? 'been' : 'want to go';
}

function tagMap(tags) {
  return new Map(array(tags).map(tag => [String(tag?.id || ''), String(tag?.name || '')]));
}

function tagNames(record, names) {
  return array(record?.tags)
    .map(tag => typeof tag === 'string' ? (names.get(tag) || tag) : String(tag?.name || ''))
    .filter(Boolean);
}

function titleOf(record, kind) {
  return String(kind === 'book' ? (record.title || '') : (record.name || '')).trim();
}

function pathsOf(holder) {
  const routes = array(holder?.routes);
  return routes.length ? routes : array(holder?.paths);
}

function provenanceNames(record) {
  const p = record?.provenance;
  if (!p || typeof p !== 'object') return [];
  return [p.name, ...array(p.chain).map(step => step?.name)].filter(Boolean);
}

function fold(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function termsOf(query) {
  const q = fold(query);
  return q ? q.split(' ') : [];
}

function stateFilter(value) {
  const raw = String(value == null ? 'all' : value).trim().toLowerCase();
  if (raw === 'all') return 'all';
  if (VISITED.has(raw)) return 'visited';
  if (WISHLIST.has(raw)) return 'wishlist';
  return 'all';
}

function kindFilter(value) {
  const raw = String(value == null ? 'all' : value).trim().toLowerCase();
  return raw === 'all' ? 'all' : (kindWord(raw) || 'all');
}

function fieldsOf(item) {
  const r = item.record;
  const common = [item.title, r.note, r.url, ...item.tagNames,
    item.correspondent?.name, ...provenanceNames(r)];
  if (item.kind === 'book') return [...common, r.author, r.year];
  return [...common, r.address, r.city, r.country];
}

function makeItem(record, hint, names, correspondent = null) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const kind = recordKind(record, hint);
  if (!kind) return null;
  const state = recordState(record, kind);
  return {
    kind,
    state,
    stateLabel: stateLabel(kind, state),
    title: titleOf(record, kind),
    source: correspondent ? 'correspondent' : 'local',
    correspondent,
    tagNames: tagNames(record, names),
    record,
  };
}

function collect(source) {
  const atlas = source && typeof source === 'object' ? source : {};
  const ownTags = tagMap(atlas.tags);
  const out = [];
  const add = (records, hint, names, correspondent = null) => {
    for (const record of array(records)) {
      const item = makeItem(record, hint, names, correspondent);
      if (item) out.push(item);
    }
  };

  add(atlas.places, 'place', ownTags);
  add(pathsOf(atlas), 'path', ownTags);
  add(atlas.books, 'book', ownTags);

  for (const correspondent of array(atlas.correspondents)) {
    if (!correspondent || typeof correspondent !== 'object') continue;
    const theirTags = tagMap(correspondent.tags);
    add(correspondent.places, 'place', theirTags, correspondent);
    add(pathsOf(correspondent), 'path', theirTags, correspondent);
    add(correspondent.books, 'book', theirTags, correspondent);
  }
  return out;
}

/**
 * Search and filter the whole mixed library.
 *
 * `source` accepts the store-shaped collections (`places`, `routes`, `books`,
 * `tags`, `correspondents`). Future correspondents may carry `routes`/`paths`
 * and `books`; current place-only correspondents continue to work unchanged.
 * Results keep the original record by reference and add only view metadata:
 * `{ kind, state, stateLabel, title, source, correspondent, tagNames, record }`.
 */
export function searchLibrary(source, query = '', {
  kind = 'all', state = 'all', limit = Infinity,
} = {}) {
  const wantedKind = kindFilter(kind);
  const wantedState = stateFilter(state);
  const terms = termsOf(query);
  const cap = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : Infinity;
  if (cap === 0) return [];

  const found = [];
  for (const item of collect(source)) {
    if (wantedKind !== 'all' && item.kind !== wantedKind) continue;
    if (wantedState !== 'all' && item.state !== wantedState) continue;
    if (terms.length) {
      const haystack = fold(fieldsOf(item).filter(Boolean).join(' '));
      if (!terms.every(term => haystack.includes(term))) continue;
    }
    found.push(item);
    if (found.length >= cap) break;
  }
  return found;
}
