import test from 'node:test';
import assert from 'node:assert/strict';

import {
  atlasOverview, searchAtlas, placeProposal, listProposal, makeAgentTools,
  AGENT_DATA_TOOL_NAMES, AgentToolError, agentCapability,
  connectBrowserAgent, disconnectBrowserAgent,
} from '../js/agent.js';

const atlas = {
  kind: 'atlas',
  tags: [
    { id: 't-food', name: 'Food' },
    { id: 't-art', name: 'Art' },
  ],
  places: [
    { id: 'p1', name: 'Café Frühling', lat: 47.55, lng: 7.59, city: 'Basel', country: 'Switzerland',
      address: 'Klybeckstrasse', status: 'visited', tags: ['t-food'], note: 'Quiet before nine.', url: 'https://example.com/cafe',
      prov: [{ name: 'Léa', at: '2026-05-01T00:00:00.000Z' }, { name: 'Marta', at: '2026-06-01T00:00:00.000Z' }] },
    { id: 'p2', name: 'Kunsthalle', lat: 52.5, lng: 13.4, city: 'Berlin', country: 'Germany',
      status: 'wishlist', tags: ['t-art'], note: 'See the new rooms.',
      prov: [{ name: 'Nina', at: '2026-04-01T00:00:00.000Z' }] },
  ],
  routes: [
    { id: 'r1', name: 'Rhine walk', city: 'Basel', country: 'Switzerland', status: 'walked',
      tags: [], note: '', km: 6.2 },
  ],
  books: [
    { id: 'b1', title: 'The Rings of Saturn', author: 'W. G. Sebald', year: '1995',
      status: 'visited', tags: ['t-art'], note: 'For the long way round.',
      prov: [{ name: 'Marta', at: '2026-03-01T00:00:00.000Z' }] },
  ],
};

test('overview is a bounded orientation over the supplied disclosure', () => {
  const out = atlasOverview(atlas);
  assert.ok(JSON.stringify(out).length <= 1450);
  assert.equal(out.version, 1);
  assert.equal(out.ok, true);
  assert.equal(out.visibleChange, false);
  assert.equal(out.saved, false);
  assert.equal(out.shared, false);
  assert.deepEqual(out.data.counts, { places: 2, paths: 1, books: 1 });
  assert.deepEqual(out.data.cities[0], { name: 'Basel, Switzerland', count: 2 });
  assert.deepEqual(out.data.tags.find(t => t.name === 'Art'), { name: 'Art', count: 2 });
  assert.deepEqual(out.data.recommendationSources.find(person => person.name === 'Marta'),
    { name: 'Marta', count: 2 });
});

test('search is accent tolerant, filtered, concise, and native structured data', () => {
  assert.equal(searchAtlas(atlas, { query: 'cafe fruhling' }).data.results[0].id, 'p1');
  assert.deepEqual(searchAtlas(atlas, { tag: 'Art', kind: 'book' }).data.results.map(r => r.id), ['b1']);
  assert.deepEqual(searchAtlas(atlas, { city: 'Basel', status: 'walked' }).data.results.map(r => r.id), ['r1']);
  assert.deepEqual(searchAtlas(atlas, { recommended_by: 'Léa' }).data.results.map(r => r.id), ['p1']);
  assert.deepEqual(searchAtlas(atlas, { query: 'marta' }).data.results.map(r => r.id), ['p1', 'b1']);
  assert.deepEqual(searchAtlas(atlas, { recommended_by: 'marta', kind: 'place' })
    .data.results[0].provenance, [
    { name: 'Léa', at: '2026-05-01T00:00:00.000Z' },
    { name: 'Marta', at: '2026-06-01T00:00:00.000Z' },
  ]);

  const out = searchAtlas(atlas, {});
  assert.equal(out.ok, true);
  assert.equal(out.visibleChange, false);
  assert.equal(out.saved, false);
  assert.equal(out.shared, false);
  assert.ok(JSON.stringify(out).length <= 1450);

  const sevenTags = Array.from({ length: 24 }, (_, i) => ({
    id: `t${i}`, name: `Sentinel tag ${i} ${'x'.repeat(22)}`,
  }));
  const deeplyTagged = {
    ...atlas,
    tags: sevenTags,
    places: [
      {
        ...atlas.places[0], tags: sevenTags.map(tag => tag.id),
        note: 'Unique note sentinel after every tag.',
        url: 'https://example.com/unique-link-sentinel',
      },
      { ...atlas.places[1], tags: [sevenTags.at(-1).id], note: '', url: '' },
    ],
    routes: [], books: [],
  };
  const lastTag = sevenTags.at(-1).name;
  const seventh = searchAtlas(deeplyTagged, { tag: lastTag });
  assert.deepEqual(seventh.data.results.map(result => result.id), ['p1', 'p2']);
  assert.equal(seventh.data.results[0].tags.includes(lastTag), false,
    'concise output unexpectedly widened beyond six tag labels');
  assert.deepEqual(searchAtlas(deeplyTagged, { query: 'sentinel tag 23' }).data.results
    .map(result => result.id), ['p1', 'p2']);
  assert.deepEqual(searchAtlas(deeplyTagged, { query: 'unique note sentinel' }).data.results
    .map(result => result.id), ['p1']);
  assert.deepEqual(searchAtlas(deeplyTagged, { query: 'unique-link-sentinel' }).data.results
    .map(result => result.id), ['p1']);
  assert.deepEqual(atlasOverview(deeplyTagged).data.tags.find(tag => tag.name === lastTag),
    { name: lastTag, count: 2 });
});

test('search pagination is bounded, gap-free, cursor-bound, and stale-safe', () => {
  const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const enormous = { ...atlas, places: Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`, name: `Place ${i} ${'x'.repeat(130)}`, lat: 46, lng: 8,
    city: 'Somewhere', country: 'Switzerland', status: 'wishlist', tags: ['t-food'],
    note: 'n'.repeat(600), url: `https://example.com/${'u'.repeat(190)}`,
  })) };
  const ids = [];
  let cursor = '';
  let first;
  do {
    const out = searchAtlas(enormous, { query: 'Place', limit: 10, ...(cursor ? { cursor } : {}) });
    first ||= out;
    assert.ok(byteLength(out) <= 1450);
    assert.equal(out.data.returned, out.data.results.length);
    ids.push(...out.data.results.map(result => result.id));
    cursor = out.nextCursor || '';
  } while (cursor);
  assert.deepEqual(ids, Array.from({ length: 30 }, (_, i) => `p${i}`));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(first.data.returned < 10, 'the byte bound did not reduce a deliberately enormous page');
  assert.equal(first.nextCursor.split('.')[1], first.data.returned.toString(36),
    'cursor advanced by a number other than the rows actually returned');
  const normalized = searchAtlas(enormous, { query: '  PLÁCE  ', limit: 1 });
  assert.doesNotThrow(() => searchAtlas(enormous, {
    query: 'place', limit: 2, cursor: normalized.nextCursor,
  }), 'equivalent normalized search words invalidated the cursor');

  assert.throws(() => searchAtlas(enormous, {
    query: 'Elsewhere', limit: 10, cursor: first.nextCursor,
  }), /does not match/);
  assert.throws(() => searchAtlas({
    ...enormous,
    places: enormous.places.map((place, index) => index ? place : { ...place, note: 'changed' }),
  }, { query: 'Place', limit: 10, cursor: first.nextCursor }), /stale/);
  const last = first.nextCursor.at(-1);
  assert.throws(() => searchAtlas(enormous, {
    query: 'Place', limit: 10,
    cursor: `${first.nextCursor.slice(0, -1)}${last === '0' ? '1' : '0'}`,
  }), /malformed/);
});

test('search remains byte-bounded with multibyte text and hostile provenance escaping', () => {
  const quoted = '"'.repeat(60);
  const hostile = {
    tags: [], routes: [], books: [],
    places: Array.from({ length: 2 }, (_, index) => ({
      id: `${'\ud83c\udf0d'.repeat(63)}${index}`,
      name: '界'.repeat(140),
      lat: 46, lng: 8, status: 'wishlist', tags: [],
      prov: Array.from({ length: 4 }, () => ({
        name: quoted,
        at: '2026-08-01T00:00:00.000Z',
      })),
    })),
  };
  const result = searchAtlas(hostile, {});
  const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  assert.equal(result.ok, true);
  assert.ok(result.data.returned >= 1, 'a valid bounded record did not advance the page');
  assert.ok(bytes <= 1450, `search returned ${bytes} UTF-8 bytes`);
});

test('search validates its whole direct input instead of widening invalid filters', () => {
  assert.throws(() => searchAtlas(atlas, { kind: 'route' }), error => (
    error instanceof AgentToolError && error.code === 'invalid_input' && /kind/.test(error.message)
  ));
  assert.throws(() => searchAtlas(atlas, { status: 'all-ish' }), /status/);
  assert.throws(() => searchAtlas(atlas, { limit: '10' }), /limit/);
  assert.throws(() => searchAtlas(atlas, { limit: 0 }), /limit/);
  assert.throws(() => searchAtlas(atlas, { private: true }), /unknown field/);
  assert.throws(() => searchAtlas(atlas, '{"query":"Basel"}'), /object/);
  assert.throws(() => searchAtlas(atlas, { query: 'x'.repeat(201) }), /too long/);
  assert.throws(() => searchAtlas(atlas, { recommended_by: 'x'.repeat(61) }), /too long/);
});

test('a place proposal has only fields an assistant may propose', () => {
  const p = placeProposal({
    name: '  The place  ', lat: 46.2, lng: 8.3, city: 'Basel', country: 'Switzerland',
    url: 'https://example.com', note: 'Look again', tags: ['Food', 'Food', ' Late '],
  });
  assert.deepEqual(Object.keys(p), ['name', 'lat', 'lng', 'address', 'city', 'country', 'url', 'note', 'tags']);
  assert.equal(p.name, 'The place');
  assert.deepEqual(p.tags, ['Food', 'Late']);
  assert.equal(p.status, undefined);
  assert.throws(() => placeProposal({
    name: 'False witness', lat: 46, lng: 8, status: 'visited', private: true,
  }), /unknown field/);
  assert.throws(() => placeProposal({ name: 'Coerced', lat: '46.2', lng: 8 }), /Latitude/);
  assert.throws(() => placeProposal({ name: 'Nowhere', lat: 99, lng: 8 }), /Latitude/);
  assert.throws(() => placeProposal({ name: 'Bad link', lat: 46, lng: 8, url: 'javascript:alert(1)' }), /http or https/);
});

test('a list proposal accepts only item ids present in the outward disclosure', () => {
  assert.deepEqual(listProposal({ title: 'A day', note: 'Start early', item_ids: ['p1', 'private', 'r1', 'p1'] }, atlas), {
    title: 'A day', note: 'Start early', itemIds: ['p1', 'r1'],
  });
  assert.throws(() => listProposal({ title: 'Empty', item_ids: ['private'] }, atlas), error => (
    error instanceof AgentToolError && error.code === 'item_unavailable'
      && /visible atlas item/.test(error.message)
  ));
  assert.throws(() => listProposal({ title: 'Hidden', item_ids: ['p1'], share: true }, atlas), /unknown field/);
});

test('the five tools are narrow, bounded, annotated, and structurally refuse forbidden place fields', async () => {
  const calls = [];
  const tools = makeAgentTools({
    disclosure: () => atlas,
    showItem: v => calls.push(['show', v]),
    preparePlace: v => calls.push(['place', v]),
    prepareList: v => calls.push(['list', v]),
  });
  assert.deepEqual(tools.map(t => t.name), [
    'atlas_overview', 'search_atlas', 'show_atlas_item', 'prepare_place', 'prepare_list',
  ]);
  for (const tool of tools) {
    assert.ok(tool.name.length <= 30);
    assert.ok(tool.description.length <= 500);
    assert.equal(tool.inputSchema.additionalProperties, false);
    for (const [name, schema] of Object.entries(tool.inputSchema.properties || {})) {
      assert.ok(name.length <= 30);
      assert.ok((schema.description || '').length <= 150);
    }
  }
  assert.deepEqual(tools[0].annotations, { readOnlyHint: true, untrustedContentHint: true });
  assert.deepEqual(tools[1].annotations, { readOnlyHint: true, untrustedContentHint: true });
  assert.deepEqual(tools[3].annotations, { readOnlyHint: false, untrustedContentHint: false });
  assert.deepEqual(Object.keys(tools[3].inputSchema.properties), [
    'name', 'lat', 'lng', 'address', 'city', 'country', 'url', 'note', 'tags',
  ]);

  const opened = await tools[2].execute({ id: 'p1', kind: 'place' });
  const proposed = await tools[3].execute({ name: 'A proposal', lat: 46, lng: 8 });
  const drafted = await tools[4].execute({ title: 'A list', item_ids: ['p1', 'private'] });
  for (const result of [opened, proposed, drafted]) {
    assert.equal(result.ok, true);
    assert.equal(result.visibleChange, true);
    assert.equal(result.saved, false);
    assert.equal(result.shared, false);
  }
  assert.equal(proposed.data.requiresHumanAction, true);
  assert.match(proposed.data.nextAction, /Add to my atlas/);
  assert.equal(drafted.data.requiresHumanAction, true);
  assert.match(drafted.data.nextAction, /Save collection/);
  assert.equal(calls.length, 3);
  await assert.rejects(() => tools[2].execute({ id: 'private', kind: 'place' }), /not available/);
  await assert.rejects(() => tools[2].execute({ id: 'p1' }), /kind is required/);
  await assert.rejects(() => tools[0].execute({ extra: true }), /unknown field/);
  await assert.rejects(() => tools[3].execute({
    name: 'Forbidden', lat: 46, lng: 8, status: 'visited',
  }), /unknown field/);

  const unwired = makeAgentTools({ disclosure: () => atlas });
  for (const index of [2, 3, 4]) {
    const input = index === 2 ? { id: 'p1', kind: 'place' }
      : index === 3 ? { name: 'Unwired', lat: 46, lng: 8 }
        : { title: 'Unwired', item_ids: ['p1'] };
    await assert.rejects(() => unwired[index].execute(input), error => (
      error instanceof AgentToolError && error.code === 'tool_unavailable'
        && error.retryable === false
    ));
  }
});

test('the access-off tool is a strict zero-data door to human review and never grants access', async () => {
  let opened = 0;
  let disclosureReads = 0;
  const accessAllowed = false;
  const registered = new Map();
  const document = { modelContext: { registerTool(tool, { signal } = {}) {
    registered.set(tool.name, tool);
    signal?.addEventListener('abort', () => {
      if (registered.get(tool.name) === tool) registered.delete(tool.name);
    }, { once: true });
  } } };
  const state = await connectBrowserAgent({
    document,
    accessAllowed: false,
    disclosure: () => { disclosureReads += 1; return atlas; },
    reviewAccess: (...args) => {
      assert.equal(args.length, 0);
      opened += 1;
    },
  });

  assert.deepEqual(state, { supported: true, active: false, error: '' });
  assert.equal(agentCapability(document).active, false);
  assert.deepEqual([...registered.keys()], ['review_assistant_access']);
  const tool = registered.get('review_assistant_access');
  assert.deepEqual(tool.inputSchema, {
    type: 'object', properties: {}, additionalProperties: false,
  });
  assert.deepEqual(tool.annotations, { readOnlyHint: false, untrustedContentHint: false });
  assert.match(tool.description, /never grants access or exposes atlas data/i);
  assert.equal(JSON.stringify(tool).includes('Café Frühling'), false);

  const refused = await tool.execute({ query: 'Basel' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'invalid_input');
  assert.equal(opened, 0);

  const result = await tool.execute({});
  assert.equal(result.ok, true);
  assert.equal(result.visibleChange, true);
  assert.equal(result.saved, false);
  assert.equal(result.shared, false);
  assert.deepEqual(result.data, {
    opened: true,
    access: 'off',
    dataExposed: false,
    requiresHumanAction: true,
    availableAfterApproval: [...AGENT_DATA_TOOL_NAMES],
  });
  assert.equal(opened, 1);
  assert.equal(disclosureReads, 0);
  assert.equal(accessAllowed, false, 'opening the review changed consent');

  disconnectBrowserAgent();
  assert.equal(registered.size, 0);
});

test('the access-off tool returns a zero-data human handoff when atlas setup comes first', async () => {
  let disclosureReads = 0;
  const registered = new Map();
  const document = { modelContext: { registerTool(tool) { registered.set(tool.name, tool); } } };
  await connectBrowserAgent({
    document,
    accessAllowed: false,
    disclosure: () => { disclosureReads += 1; return atlas; },
    reviewAccess: () => ({ setupRequired: true }),
  });

  const result = await registered.get('review_assistant_access').execute({});
  assert.equal(result.ok, true);
  assert.match(result.summary, /owner must finish atlas setup/i);
  assert.equal(result.visibleChange, true);
  assert.equal(result.saved, false);
  assert.equal(result.shared, false);
  assert.deepEqual(result.data, {
    opened: false,
    setupRequired: true,
    access: 'off',
    dataExposed: false,
    requiresHumanAction: true,
    nextAction: 'The owner finishes the on-screen atlas setup. Then call review_assistant_access again.',
    availableAfterApproval: [...AGENT_DATA_TOOL_NAMES],
  });
  assert.equal(disclosureReads, 0);
  assert.deepEqual([...registered.keys()], ['review_assistant_access']);

  disconnectBrowserAgent();
});

test('access changes atomically replace the review door and the five data tools', async () => {
  const registered = new Map();
  const signals = [];
  const document = { modelContext: { registerTool(tool, { signal } = {}) {
    registered.set(tool.name, tool);
    if (!signals.includes(signal)) signals.push(signal);
    signal?.addEventListener('abort', () => {
      if (registered.get(tool.name) === tool) registered.delete(tool.name);
    }, { once: true });
  } } };

  await connectBrowserAgent({ document, reviewAccess() {} });
  assert.deepEqual([...registered.keys()], ['review_assistant_access']);
  await connectBrowserAgent({ document, accessAllowed: true, disclosure: () => atlas });
  assert.equal(signals[0].aborted, true);
  assert.deepEqual([...registered.keys()].sort(), [...AGENT_DATA_TOOL_NAMES].sort());
  assert.equal(registered.has('review_assistant_access'), false);
  await connectBrowserAgent({ document, accessAllowed: false, reviewAccess() {} });
  assert.equal(signals[1].aborted, true);
  assert.deepEqual([...registered.keys()], ['review_assistant_access']);
  disconnectBrowserAgent();
});

test('revocation cancels an in-flight access review without returning success', async () => {
  const registered = new Map();
  let release;
  let began;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { began = resolve; });
  const document = { modelContext: { registerTool(tool) { registered.set(tool.name, tool); } } };
  await connectBrowserAgent({
    document,
    accessAllowed: false,
    reviewAccess: async () => { began(); await gate; },
  });
  const running = registered.get('review_assistant_access').execute({});
  await started;
  disconnectBrowserAgent();
  release();
  await assert.rejects(running, error => error?.name === 'AbortError');
});

test('registration is capability-checked and one abort revokes every tool', async () => {
  const registered = [];
  let signal = null;
  const document = { modelContext: { registerTool: async (tool, options) => {
    registered.push(tool);
    signal = options.signal;
  } } };
  assert.deepEqual(agentCapability({}), { supported: false, active: false, error: '' });
  assert.deepEqual(agentCapability(Object.defineProperty({}, 'modelContext', {
    get() { throw new Error('draft getter failed'); },
  })), { supported: false, active: false, error: '' });
  let disclosed = atlas;
  const state = await connectBrowserAgent({
    document, accessAllowed: true, disclosure: () => disclosed,
  });
  assert.deepEqual(state, { supported: true, active: true, error: '' });
  assert.equal(agentCapability(document).active, true);
  const otherDocument = { modelContext: { registerTool() {} } };
  assert.equal(agentCapability(otherDocument).active, false,
    'a different document inherited another page\'s active state');
  assert.equal(signal.aborted, false);
  assert.equal(registered.length, 5);

  const search = registered.find(tool => tool.name === 'search_atlas');
  const native = await search.execute('{"query":"Basel","limit":2}');
  assert.equal(native.version, 1);
  assert.equal(native.ok, true);
  assert.deepEqual(native.data.results.map(result => result.id), ['p1', 'r1']);
  const invalidJson = await search.execute('{no');
  assert.deepEqual(invalidJson.error, {
    code: 'invalid_input', message: 'Tool input is not valid JSON.', retryable: true,
  });
  assert.equal(invalidJson.version, 1);
  assert.equal(invalidJson.visibleChange, false);
  const mismatched = await search.execute(JSON.stringify({
    query: 'Elsewhere', cursor: searchAtlas(atlas, { query: 'Basel', limit: 1 }).nextCursor,
  }));
  assert.equal(mismatched.error.code, 'cursor_filter_mismatch');
  const firstPage = searchAtlas(atlas, { query: 'Basel', limit: 1 });
  disclosed = {
    ...atlas,
    places: atlas.places.map((place, index) => index ? place : { ...place, note: 'Changed.' }),
  };
  const stale = await search.execute({ query: 'Basel', limit: 1, cursor: firstPage.nextCursor });
  assert.equal(stale.error.code, 'stale_cursor');
  const unavailable = await registered.find(tool => tool.name === 'show_atlas_item')
    .execute({ id: 'private', kind: 'place' });
  assert.equal(unavailable.error.code, 'item_unavailable');

  disconnectBrowserAgent();
  assert.equal(signal.aborted, true);
  assert.equal(agentCapability(document).active, false);
});

test('the adapter normalizes early registration cleanup and expected UI-state errors', async () => {
  const registered = new Map();
  const removed = [];
  let callbackError = new AgentToolError(
    'review_in_progress', 'Finish or close the current review first.',
  );
  const context = {
    registerTool(tool) {
      assert.equal(this, context, 'registerTool lost its native receiver');
      registered.set(tool.name, tool);
      return { unregister: () => removed.push(tool.name) };
    },
  };
  const document = { modelContext: context };
  await connectBrowserAgent({
    document,
    accessAllowed: true,
    disclosure: () => atlas,
    preparePlace: () => { throw callbackError; },
  });
  const result = await registered.get('prepare_place').execute({ name: 'Later', lat: 46, lng: 8 });
  assert.deepEqual(result.error, {
    code: 'review_in_progress',
    message: 'Finish or close the current review first.',
    retryable: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.saved, false);
  assert.equal(result.shared, false);

  callbackError = new TypeError('Unexpected proposal renderer defect.');
  await assert.rejects(
    () => registered.get('prepare_place').execute({ name: 'Break', lat: 46, lng: 8 }),
    error => error === callbackError,
    'an implementation TypeError was mislabeled as invalid caller input',
  );
  disconnectBrowserAgent();
  await Promise.resolve();
  assert.deepEqual(removed.sort(), [
    'atlas_overview', 'prepare_list', 'prepare_place', 'search_atlas', 'show_atlas_item',
  ]);
});

test('invocation and consent cancellation both reject in-flight work as AbortError', async () => {
  async function run(cancel) {
    const registered = new Map();
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { started = resolve; });
    const document = { modelContext: { registerTool(tool) { registered.set(tool.name, tool); } } };
    await connectBrowserAgent({
      document,
      accessAllowed: true,
      disclosure: () => atlas,
      preparePlace: async () => { started(); await gate; },
    });
    const invocation = new AbortController();
    const running = registered.get('prepare_place').execute(
      { name: 'Wait', lat: 46, lng: 8 }, { signal: invocation.signal },
    );
    await began;
    cancel(invocation);
    release();
    await assert.rejects(running, error => error?.name === 'AbortError');
  }

  await run(invocation => invocation.abort());
  await run(() => disconnectBrowserAgent());
  disconnectBrowserAgent();
});

test('a runtime that never finishes registration is timed out and revoked', async () => {
  let signal;
  const document = { modelContext: { registerTool(_tool, options) {
    signal = options.signal;
    return new Promise(() => {});
  } } };
  const state = await connectBrowserAgent({
    document, accessAllowed: true, disclosure: () => atlas, registrationTimeoutMs: 8,
  });
  assert.deepEqual(state, {
    supported: true, active: false, error: 'Browser assistant connection timed out.',
  });
  assert.equal(signal.aborted, true);
  assert.equal(agentCapability(document).active, false);
});

test('revoking consent while registration is waiting cannot reactivate the tools', async () => {
  let release;
  let signal;
  let cleanup = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const document = { modelContext: { registerTool: async (_tool, options) => {
    signal = options.signal;
    await gate;
    return () => { cleanup += 1; };
  } } };
  const connecting = connectBrowserAgent({
    document, accessAllowed: true, disclosure: () => atlas,
  });
  await Promise.resolve();
  disconnectBrowserAgent();
  assert.equal(signal.aborted, true, 'revocation reaches the in-flight registration');
  release();
  assert.deepEqual(await connecting, { supported: true, active: false, error: '' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cleanup, 1, 'a late registration result was not cleaned up after revocation');
  assert.equal(agentCapability(document).active, false, 'the completed await did not restore consent');
});
