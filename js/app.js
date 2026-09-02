// app.js — THE RESONANT FIELD
// The map is the interface. Five corner marks, one command line,
// summoned posters. One field, one ink — and one counter-ink for
// the voices of other people.

import { store, newPlace, newTag, newRoute, newFolio, newBook, demoData, baseTags, TAG_STATIONS, setWriteFailedHandler, unreadableKeys, releaseUnreadable, mayLeave } from './store.js?v=rf157';
import { parseGPX, simplify, measure, profile, encodePath, fmtKm, fmtHours, effort } from './route.js?v=rf157';
import { searchGeo, suggestGeo, reverseGeo, fmtDMS, haversineKm, fmtDistance } from './geocode.js?v=rf157';
import * as mapView from './map.js?v=rf157';
import { makeShareUrl, makeAskUrl, makeThanksUrl, makeIntroUrl, parseShareHash, readPayload, clearShareHash, buildPayload, disclosureCounts, packPayload } from './share.js?v=rf157';
import { normPayload, classifyFile, SHARE_VERSION, LIMITS } from './schema.js?v=rf157';
import { mergeLetters, markOf, onIntroduction, onVersion, routeOf, maySend, PAIRING, PAIRING_VERSION } from './pairing.js?v=rf157';
import { mintIdentity, identityFrom, pubFrom, sealLetter, openLetter, senderOf, newMsgId, keyId, LETTER_LIMITS } from './letters.js?v=rf157';
import { resonance, verdict, evidenceLines, grounds, samePlace } from './kinship.js?v=rf157';
import { exifGPS } from './exif.js?v=rf157';
import { seal, unseal, makeClient, burnPatch, syncGuard, unfinishedJoins, forgetJoins, CLUB_URL, PRICE, TESTING } from './club.js?v=rf157';
import * as photoStore from './photos.js?v=rf157';
import { readShared, coordsIn, alreadyHeld } from './capture.js?v=rf157';
import { cityLabel, oneSpelling, groupByCity, citiesHeld, wordsOf, answers, cityTyped, PLACELESS } from './find.js?v=rf157';
import { evening, deviceZone } from './evening.js?v=rf157';
import { AgentToolError, agentCapability, connectBrowserAgent, disconnectBrowserAgent } from './agent.js?v=rf157';
import { recordState, searchLibrary, stateLabel } from './library.js?v=rf157';

// One word ties a tester's report to the exact offline shell they are using.
// It comes from this module's own address, so it cannot drift from the cache
// key in the page that loaded it.
const RELEASE = new URL(import.meta.url).searchParams.get('v') || 'local';

// Direct browser-agent data access is off until a person asks for it. A
// capable browser may expose one zero-data door into that human-controlled
// review, but never atlas records before the person allows them. Capability
// and permission are separate: a saved yes may meet a browser that cannot yet
// expose WebMCP, and the settings room must say both truths rather than folding
// them into an optimistic switch.
let agentAccessState = { ...agentCapability(), connecting: false };

// Registering a browser tool is not a repaint. Each registration belongs to
// one document runtime and aborts the registration it replaces, so treating
// every atlas write as a reason to "sync" briefly makes every tool vanish and
// return. Keep the target we have already reconciled instead: permission,
// whether this document is the active page, and the exact modelContext
// implementation that owns the registrations.
let agentPageActive = true;
let agentAccessTarget = null;
let agentAccessPending = null;
let agentAccessRevision = 0;
// A pre-consent tool may arrive while the first-visit introduction is still
// covering the human setup. It may end that cover, but it must not remember
// the introduction as watched or choose anything on the person's behalf.
let finishFirstRunIntro = null;

function browserAgentRuntime() {
  try {
    const context = document?.modelContext;
    const registerTool = typeof context?.registerTool === 'function' ? context.registerTool : null;
    return { context, registerTool, supported: !!registerTool };
  } catch {
    // A browser or extension may expose the property before its implementation
    // is ready. That is an unavailable capability, never a broken app boot.
    return { context: null, registerTool: null, supported: false };
  }
}

function sameAgentTarget(a, b) {
  return !!a && !!b
    && a.allowed === b.allowed
    && a.pageActive === b.pageActive
    && a.context === b.context
    && a.registerTool === b.registerTool;
}

const AGENT_ACCESS_COPY = 'Allowing access lets Resonate’s browser tools search records included in sharing and read exact locations, addresses, notes, links, tags, and recommendation names and dates. They can open items and prepare places or collections. They cannot read excluded records or your People list, and cannot save, delete, share, or mark visits. Access stays on in this browser until you stop it. Your assistant provider may process returned data under its own terms.';

function paintAgentAccess() {
  const allowed = store.settings.agentAccess === true;
  const live = agentAccessState.active === true;
  const summary = $('#agentAccessSummary');
  if (summary) summary.textContent = agentAccessState.connecting
    ? 'connecting'
    : live ? 'on' : allowed ? 'allowed' : 'off';
  const stateName = live ? 'on' : agentAccessState.connecting ? 'waiting' : 'off';
  const stateCopy = agentAccessState.connecting
    ? 'connecting…'
    : live
      ? 'on in this browser · tools return no excluded records'
      : agentAccessState.supported
        ? allowed && agentAccessState.error
          ? 'allowed · the browser blocked the connection'
          : 'off · no atlas data is exposed as tools'
        : allowed
          ? 'allowed · direct tools are not available in this browser'
          : 'direct tools are not available in this browser';
  ['#agentAccessState', '#agentReviewState'].forEach(selector => {
    const line = $(selector);
    if (!line) return;
    line.dataset.state = stateName;
    line.textContent = stateCopy;
  });
  ['#agentAccessCopy', '#agentReviewCopy'].forEach(selector => {
    const copy = $(selector);
    if (copy) copy.textContent = AGENT_ACCESS_COPY;
  });
  ['#agentAccessToggle', '#agentReviewToggle'].forEach(selector => {
    const toggle = $(selector);
    if (!toggle) return;
    toggle.hidden = !agentAccessState.supported && !allowed;
    // Consent may always be withdrawn, including while an experimental
    // runtime is taking too long to answer registration.
    toggle.disabled = false;
    toggle.setAttribute('aria-pressed', String(allowed));
    toggle.textContent = allowed ? 'Stop access' : 'Allow access';
  });
}

async function toggleAgentAccess() {
  const allowed = store.settings.agentAccess === true;
  store.settings.agentAccess = !allowed;
  if (!store.saveSettings()) {
    store.settings.agentAccess = allowed;
    return toast('this browser refused to remember that choice');
  }
  const state = await syncAgentAccess();
  if (!store.settings.agentAccess) return toast('assistant access is off');
  if (state.active) return toast('assistant access is on in this browser');
  toast('permission is saved, but direct tools are not available in this browser', 6500);
}

function bindAgentAccessToggle(root = document) {
  root.querySelectorAll('[data-agent-access-toggle]').forEach(toggle => {
    toggle.addEventListener('click', toggleAgentAccess);
  });
}

function renderAgentAccessReview() {
  const body = $('#agentAccessReviewBody');
  if (!body) return;
  body.innerHTML = `
    <section class="set-sec agent-access-review">
      <div class="agent-state mono" id="agentReviewState" data-state="off" aria-live="polite"></div>
      <p class="set-row-sub" id="agentReviewCopy"></p>
      <div class="word-row">
        <button class="word-btn" id="agentReviewToggle" data-agent-access-toggle aria-pressed="false">Allow access</button>
        <a class="word-btn quiet" href="read.html?d=assistant">Read data contract</a>
      </div>
      <p class="set-row-sub set-note">Nothing changes until you choose Allow access.</p>
    </section>`;
  paintAgentAccess();
  bindAgentAccessToggle(body);
}

function openAgentAccessReview() {
  if ($('#intro')?.hidden === false && store.settings.chosen !== true) {
    finishFirstRunIntro?.();
  }
  const front = frontDialog();
  // A first visitor is already at a human-only decision: whether to start
  // empty, inspect the example, or restore an atlas. Keep that gate in front
  // and tell the tool it reached a prerequisite, rather than throwing a
  // generic "another review is open" failure from behind the threshold.
  // Focusing the dialog root cannot activate any choice; the next key walks
  // into the options, just as it does when the threshold first opens.
  if (front?.id === 'threshold' && store.settings.chosen !== true) {
    front.scrollTop = 0;
    front.focus({ preventScroll: true });
    return { setupRequired: true };
  }
  const ordinaryAtlas = !front || front.id === 'settingsOverlay'
    || front.id === 'indexOverlay' || front.id === 'agentAccessOverlay';
  if ($('#intro')?.hidden === false || !ordinaryAtlas) {
    throw new AgentToolError('review_in_progress', 'Finish or close the current review first.');
  }
  if (!$('#agentAccessReviewBody')) {
    throw new AgentToolError('review_unavailable',
      'The assistant access review is not available right now.');
  }
  if (front?.id === 'agentAccessOverlay') renderAgentAccessReview();
  else openSurface('agentAccessOverlay', renderAgentAccessReview);
  // A tool may open this asynchronously. Leave focus on the dialog itself so
  // a carried Enter or Space cannot become consent before the review is read.
  $('#agentAccessOverlay')?.focus({ preventScroll: true });
}

function requireAgentAccess() {
  const readable = loadLatestAtlas({ notify: false });
  if (!readable || store.settings.agentAccess !== true || !agentPageActive) {
    // A cross-tab revocation may be discovered here before its storage event.
    // Reconcile immediately so every captured data-tool registration is
    // aborted, then fail this invocation without returning or painting data.
    void syncAgentAccess();
    throw new AgentToolError('atlas_unavailable',
      readable
        ? 'Assistant access is off. Ask the owner to review access again.'
        : 'The atlas could not be read safely. Try again after reopening Resonate.');
  }
}

function disclosureForAgent() {
  requireAgentAccess();
  return store.outward();
}

function syncAgentAccess() {
  const runtime = browserAgentRuntime();
  const target = {
    allowed: store.settings.agentAccess === true,
    pageActive: agentPageActive,
    context: runtime.context,
    registerTool: runtime.registerTool,
  };

  // Several settings renders and lifecycle signals can describe the same
  // target while an asynchronous browser registration is still in flight.
  // All of them share that one attempt; a settled target is a pure repaint.
  if (sameAgentTarget(target, agentAccessTarget)) {
    paintAgentAccess();
    return agentAccessPending || Promise.resolve(agentAccessState);
  }

  agentAccessTarget = target;
  const revision = ++agentAccessRevision;

  if (!target.pageActive || !runtime.supported) {
    disconnectBrowserAgent();
    agentAccessPending = null;
    agentAccessState = {
      supported: runtime.supported,
      active: false,
      connecting: false,
      paused: target.allowed && !target.pageActive,
      error: '',
    };
    paintAgentAccess();
    return Promise.resolve(agentAccessState);
  }

  agentAccessState = {
    supported: true,
    active: false,
    connecting: target.allowed,
    paused: false,
    error: '',
  };
  paintAgentAccess();
  const pending = connectBrowserAgent({
    accessAllowed: target.allowed,
    reviewAccess: openAgentAccessReview,
    authorize: requireAgentAccess,
    // Every tool invocation crosses the durable boundary itself. A storage
    // event from another tab may still be queued when an agent call begins;
    // waiting for that event would leave a narrow stale-disclosure race.
    disclosure: disclosureForAgent,
    showItem: ({ id, kind }) => {
      if (frontDialog()) throw new AgentToolError('review_in_progress', 'Finish or close the current review first.');
      openAgentAtlasItem({ id, kind });
    },
    preparePlace: proposal => {
      if (frontDialog()) throw new AgentToolError('review_in_progress', 'Finish or close the current review first.');
      openAgentPlaceProposal(proposal);
    },
    prepareList: ({ title, note, itemIds }) => {
      if (frontDialog()) throw new AgentToolError('review_in_progress', 'Finish or close the current review first.');
      // The draft is painted from the disclosure too. Using the ordinary
      // whole-house composer here would put private rows on the glass even
      // though none could be selected by the tool, which is still a wider
      // reading for an assistant that can see the page.
      const outward = disclosureForAgent();
      openFolioComposer({
        fresh: true, title, dedication: note, preselect: itemIds, agentView: true,
        places: outward.places, ways: outward.routes, books: outward.books,
      });
    },
  }).then(next => {
    // Revocation and a replacement runtime both abort an older registration.
    // Its promise may still settle afterwards; it no longer owns the state or
    // the words on screen, so it may not paint either of them.
    if (revision !== agentAccessRevision) return agentAccessState;
    agentAccessState = { ...next, connecting: false, paused: false };
    paintAgentAccess();
    return agentAccessState;
  }).catch(error => {
    if (revision !== agentAccessRevision) return agentAccessState;
    agentAccessState = {
      supported: true,
      active: false,
      connecting: false,
      paused: false,
      error: String(error?.message || error || 'connection failed').slice(0, 240),
    };
    paintAgentAccess();
    return agentAccessState;
  }).finally(() => {
    if (revision === agentAccessRevision) agentAccessPending = null;
  });
  agentAccessPending = pending;
  return pending;
}

// Installation is a capability, not a platform. Browsers that can offer a
// native install hand us the prompt; every other browser keeps the same word
// and sends it to the short, platform-specific instructions instead.
let installOffer = null;
const installedHere = () => matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true;

function paintDeviceState() {
  const stateWord = $('#deviceState');
  const installWord = $('#installWord');
  const device = $('#deviceSettings');
  const summary = $('#deviceSummary');
  const photographs = Number(device?.dataset.photographs || 0);
  const canWorkOffline = 'serviceWorker' in navigator;
  if (summary) summary.textContent = photographs
    ? `${photographs} photo${photographs === 1 ? '' : 's'} to review`
    : installedHere() ? 'installed'
      : !canWorkOffline ? 'online only'
        : navigator.serviceWorker?.controller ? 'ready offline' : 'preparing';
  if (stateWord) {
    const offline = !('serviceWorker' in navigator)
      ? 'offline copy unavailable in this browser'
      : navigator.serviceWorker.controller
        ? 'ready to open offline'
        : 'preparing its offline copy';
    stateWord.textContent = `${offline} · ${navigator.onLine ? 'online now' : 'offline now'}`;
  }
  if (installWord) installWord.hidden = installedHere();
  const installRow = $('#installRow');
  if (installRow) installRow.hidden = installedHere();
  const installedWord = $('#installedWord');
  if (installedWord) installedWord.hidden = !installedHere();
}

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installOffer = e;
  paintDeviceState();
});
addEventListener('appinstalled', () => {
  installOffer = null;
  paintDeviceState();
  toast('resonate is installed on this device');
});
addEventListener('offline', () => {
  paintDeviceState();
  toast('offline. your atlas still works here; maps and search wait for a connection', 6000);
});
addEventListener('online', () => {
  paintDeviceState();
  toast('back online');
});

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- writing that survives the tab closing ----------
//
// A note used to be saved on a 400ms debounce and nothing else. Type a
// sentence and close the tab inside that breath and the sentence was gone:
// the timer never fired, and nothing on screen had suggested the words were
// not yet kept. A debounce is a courtesy to the disk, and it must never be
// the only thing standing between a person and their own writing.
//
// So a pending write is held here rather than in a closure, and anything that
// means "this moment is over" flushes it first: leaving the field, closing
// the plate, hiding the tab, or the page going away. pagehide and
// visibilitychange are the last events a browser reliably gives, and on a
// phone they are often the only ones.
const pending = new Map();

function later(key, fn, ms = 400) {
  const held = pending.get(key);
  if (held) clearTimeout(held.timer);
  const timer = setTimeout(() => { pending.delete(key); fn(); }, ms);
  pending.set(key, { timer, fn });
}

function flushWrites({ durableLoaded = false } = {}) {
  if (!pending.size) return true;
  // A delayed field edit is a patch, never a captured atlas. Another tab may
  // have excluded or removed its record during the debounce. Load that durable
  // truth before applying the patch by id, so saving a note cannot resurrect a
  // stale public copy or overwrite an unrelated change.
  if (!durableLoaded) {
    try { store.load(); }
    catch { return false; }
  }
  for (const [key, { timer, fn }] of [...pending]) {
    clearTimeout(timer);
    pending.delete(key);
    try { fn(); } catch { /* the next flush is not this one's to lose */ }
  }
  return true;
}

// a field that writes on a delay, and gives the words up the moment the
// person looks away from it
function writesLater(el, key, fn, ms = 400) {
  el.addEventListener('input', () => later(key, () => fn(el.value), ms));
  el.addEventListener('blur', () => flushWrites());
}

// Notes grow with their words. A fixed-height textarea made a complete saved
// note look truncated on narrow phones, and its inner scrollbar was almost
// impossible to discover with a thumb. The plate already scrolls, so keep one
// calm scroll surface and let each note take the height it needs.
function sizeNoteInput(el) {
  if (!el?.isConnected) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(70, el.scrollHeight)}px`;
}

function fitNoteInput(el) {
  if (!el) return;
  el.addEventListener('input', () => sizeNoteInput(el));
  // Plates render while hidden and open in the same turn. Measure on the next
  // frame, when their wrapping width and font metrics are real.
  requestAnimationFrame(() => sizeNoteInput(el));
  // Firefox can finish the variable face after that frame. Its line box then
  // grows without changing the textarea's width, so no resize event follows.
  // Re-measure against the final face instead of leaving the last line hidden.
  document.fonts?.ready.then(() => sizeNoteInput(el));
}

const refitNotes = debounce(() => {
  document.querySelectorAll('.note-input:is(textarea)').forEach(sizeNoteInput);
}, 60);
window.addEventListener('resize', refitNotes);
window.visualViewport?.addEventListener('resize', refitNotes);

function safeUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch { return false; }
}

// A person copying an address off a card or out of memory types the host and
// nothing else. The field took `kunstmuseumbasel.ch`, kept it, and did nothing
// anyone could see: safeUrl wants a scheme, so no door appeared, and the next
// load dropped the value outright, because the schema keeps a url only when it
// begins http or https. None of that was ever said. So the scheme is completed
// once, here, on the way in, and the word the person typed becomes the door
// they meant. The field shows the completed value back, so nothing is done
// behind them.
//
// Only a bare host is completed. Anything already carrying a scheme passes
// through exactly as typed, so `javascript:` stays a thing safeUrl refuses
// rather than a hostname wearing https in front of it. A colon reads as a
// scheme here even when it is really a port, which costs `example.com:8080`
// its door, and that is the right way round: the cost of guessing wrong falls
// on the rare case and never on the dangerous one.
const HOSTISH = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
function asUrl(v) {
  const t = String(v ?? '').trim();
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  return HOSTISH.test(t.split(/[/?#]/)[0]) ? `https://${t}` : t;
}

let toastTimer;
let toastDeadline = 0;
let toastRemaining = 0;
let lastToastAt = 0;

function hideToast() {
  const el = $('#toast');
  clearTimeout(toastTimer);
  toastTimer = null;
  toastDeadline = 0;
  toastRemaining = 0;
  el.hidden = true;
  el.classList.remove('has-action');
  restoreToastHome();
}

function armToast(ms) {
  clearTimeout(toastTimer);
  toastRemaining = Math.max(0, ms);
  toastDeadline = Date.now() + toastRemaining;
  toastTimer = setTimeout(hideToast, toastRemaining);
}

// An undo must not disappear while a person is reaching for it or has put the
// keyboard on it. The ordinary notices still let the map receive every touch;
// only a notice with an action holds its small patch of the field.
function holdToast() {
  const el = $('#toast');
  if (el.hidden || !toastTimer) return;
  toastRemaining = Math.max(0, toastDeadline - Date.now());
  clearTimeout(toastTimer);
  toastTimer = null;
}

function releaseToast() {
  const el = $('#toast');
  if (el.hidden || el.matches(':hover') || el.contains(document.activeElement)) return;
  armToast(Math.max(250, toastRemaining));
}

function toast(msg, ms = 2800, act = null) {
  lastToastAt = Date.now();
  const el = $('#toast');
  el.replaceChildren();
  const copy = document.createElement('span');
  copy.className = 'toast-copy';
  copy.textContent = msg;
  el.append(copy);
  el.classList.toggle('has-action', Boolean(act));
  if (act) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = act.word;
    b.addEventListener('click', () => { hideToast(); act.run(); });
    el.append(b);
    ms = Math.max(ms, 9000);
  }
  dockToastWithDialog();
  el.hidden = false;
  armToast(ms);
}

const toastEl = $('#toast');
const toastHome = { parent: toastEl.parentNode, next: toastEl.nextSibling };

function restoreToastHome() {
  if (toastEl.parentNode === toastHome.parent) return;
  const before = toastHome.next?.parentNode === toastHome.parent ? toastHome.next : null;
  toastHome.parent.insertBefore(toastEl, before);
}

/* A live notice belongs to the modal that caused it. This keeps an undo in
   the same accessibility tree and focus cycle as the action it reverses,
   while fixed positioning preserves the small visual slip. */
function dockToastWithDialog(front = null) {
  let owner = front;
  if (!owner) {
    try { owner = frontDialog(); } catch { owner = null; }
  }
  if (owner) {
    if (toastEl.parentNode !== owner) owner.append(toastEl);
  } else {
    restoreToastHome();
  }
}

toastEl.addEventListener('pointerenter', holdToast);
toastEl.addEventListener('pointerleave', releaseToast);
toastEl.addEventListener('focusin', holdToast);
toastEl.addEventListener('focusout', releaseToast);

// An archive that came home short of what it carried says so. A file can be
// damaged, and a record inside it can be unreadable while the rest is fine:
// the rest is kept, and the loss is named rather than absorbed. Said after
// the first sentence has been read, so the good news is not stepped on.
// An archive that could not be handed over exactly is not handed over at all,
// and the person is told which record and which part of it stopped the
// restore. "Some of it did not fit" is not an answer a keeper of memory gives.
async function sayWhatWasLost(lost, { verb = 'bring in' } = {}) {
  const n = lost?.length || 0;
  if (!n) return;
  const lines = lost.slice(0, 6).map(l =>
    `${l.kind || 'a record'}${l.id ? ` ${l.id}` : ''}: ${l.reason}`).join('\n');
  await ask(
    `This atlas did not ${verb}, and nothing on this device changed.\n\n${lines}`
    + (n > 6 ? `\n\nand ${n - 6} more` : '')
    + '\n\nThe file is untouched. Keep it, and say what you see here: an archive that cannot come home whole is a fault in this app, not in your file.',
    { yes: 'i see', no: '' });
}

// An unparseable date does not throw: toLocaleDateString hands back the
// string "Invalid Date", which then reads as though the app knew something.
// It says nothing instead, and every caller must be ready for nothing.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}

// An atlas holds the places that matter to you, so keeping one is already
// the recommendation. Nothing here asks for a verdict beside it: only whether
// you have been, and the note.

// what a place says of itself in one line, wherever it is listed
function datumWord(p) {
  return p.status === 'wishlist' ? 'want to go' : 'been';
}
function fmtNo(n) { return String(n).padStart(2, '0'); }

// ---------- state ----------

const state = {
  filters: { tags: new Set(), status: 'all', kind: 'all' },
  sort: 'recent',
  selectedId: null,
  selectedRouteId: null,
  foreign: null, // { corrId?, name, sig, place } a place from someone else's atlas
  visiting: null, // temp correspondent-shaped object when "just looking" at a share
  pendingAdd: null, // {lat, lng, name?} awaiting confirm
  here: null, // { lat, lng, accuracy, at } once the device has been asked and has answered
  gather: null, // { kind: 'city' | 'country' | 'tag', value } brought to the top of the index
};

function allPlaces() { return store.places; }
// the pool anything may be handed from: a place that never leaves is not in it
function sharablePlaces() { return store.places.filter(mayLeave); }
function sharableBooks() { return store.books.filter(mayLeave); }

// ---------- the keyboard is asked for, never assumed ----------
//
// A keyboard that rises on its own takes half a phone's screen, and it covers
// the exact thing the person was just sent to look at: the point on the map
// they are naming, the place that has only this second arrived, the shelf they
// came to read. The plate is worse than that. It selects the whole name, so
// one stray tap replaces the word they typed a second earlier.
//
// So a field is focused only when the press was itself a request to type, or
// when something has to be corrected. Arriving somewhere is neither.
//
// A pointer test rather than a width test: a narrow window on a desk has a
// keyboard already, and showing it costs nothing there.
function raisesAKeyboard() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
function focusSoftly(el) { if (el && !raisesAKeyboard()) el.focus(); }
// A way whose ends cannot be hidden is not handed over.
//
// Trimming used to give up on any path with fewer than eight points and hand
// the way over whole, which is the worst possible answer: a straight walk
// simplifies to two points, so the case where a person most wants their door
// hidden was exactly the case where both ends went out untouched, under a
// sentence promising otherwise. It fails closed now, and the ways it refuses
// are named on the surface rather than silently missing.
function sharableWays() {
  const ways = [];
  const tooShort = [];
  for (const r of store.routes) {
    if (!mayLeave(r)) continue;
    const out = store.trimWay(r);
    if (out) ways.push(out); else tooShort.push(r);
  }
  return { ways, tooShort };
}
function sharableRoutes() { return sharableWays().ways; }
const tooTitles = rs => rs.slice(0, 3).map(r => esc(r.name)).join(', ') + (rs.length > 3 ? `, and ${rs.length - 3} more` : '');

// ---------- what a word on a record holds back, said the same way twice ----------
//
// One word holds a record back, and it is an instruction the person gave, on a
// plate, in their own hand.
//
// There were two for a while. The records this app arrives with were held back
// as well, as something not yet the person's own, and the panel reported both
// counts as the first kind: a person who had marked nothing at all was told
// that eighteen records were marked never to leave. That is a small sentence
// to get wrong and a hard one to argue with afterwards, and it is why the
// sentence is written once here and read by every surface that counts. The
// second reason went away on its own when the owner ruled that the records
// this app arrives with are real places from real people, which travel like
// any other.
//
// Digits throughout, which is the house style on every counted line around
// this one.
const SHARING_EXCLUSION_COPY = 'Excluded from links, shared files, direct messages, print, and assistant access. Included in private backups.';

function staysBehindLine(excluded) {
  return `${excluded} record${excluded === 1 ? '' : 's'} excluded from sharing.`;
}

// The other reason a way does not travel, and it is now said at two doors for
// exactly the reason the sentence above is: store.outward() drops a way that
// asked to hide its ends and is too short to lose them, so the file built for
// an assistant loses the same ways the atlas panel names, silently, unless
// this sentence reaches that door too. Written once here rather than twice,
// because two copies of a counted sentence is how the first one drifts.
//
// The folio's own version of this is deliberately not routed through here. It
// says "enclosed" and "stays out", because a folio is a chosen few and the
// reader is being told what did not make it into the folio they composed,
// which is a different sentence about the same geometry.
function tooShortLine(rs) {
  const one = rs.length === 1;
  return `${rs.length} path${one ? '' : 's'} ${one ? 'is' : 'are'} too short to hide ${one ? 'its start and end' : 'their starts and ends'} safely, so ${one ? 'it stays' : 'they stay'} out: ${tooTitles(rs)}.`;
}

// And when nothing at all can leave.
//
// This used to be four words with nothing in them: everything enclosed stays
// behind. A person who pressed a city and reached for the one thing this app
// is for was told no, given no reason, and offered nothing to do about it. The
// reason and the remedy are both short, and the remedy is the more important
// of the two, because a refusal a person can undo is not a wall.
function nothingLeaves() {
  return 'All items are excluded from sharing. Open an item and choose Include in sharing.';
}
// only the tags the outgoing records actually use: an unused tag, or one
// used solely on a place that never leaves, has no business travelling
function tagsFor(places, routes) {
  const used = new Set([...places, ...routes].flatMap(r => r.tags || []));
  return allTags().filter(t => used.has(t.id));
}
function allTags() { return store.tags; }
function tagById(id) { return allTags().find(t => t.id === id); }
function placeById(id) { return allPlaces().find(p => p.id === id); }

// An outward action reads the atlas from durable storage at the last useful
// moment. Storage-event repainting is intentionally debounced, and an event
// may not have reached this tab yet at all; neither is permission to publish a
// stale copy. Pending edits in this tab are flushed first so refreshing cannot
// erase the words the person has just typed.
function loadLatestAtlas({
  notify = true,
  message = 'Sharing is unavailable until this atlas can be read again.',
} = {}) {
  try {
    store.load();
    if (!flushWrites({ durableLoaded: true })) throw new Error('pending write could not be reconciled');
    // Pending patches save synchronously. Read their durable result back so
    // every caller below works from the same source a second tab will see.
    store.load();
    return true;
  } catch {
    if (notify) toast(message);
    return false;
  }
}

function disclosureFingerprint(atlas) {
  return JSON.stringify(atlas);
}

function unsignedDisclosureFingerprint(atlas) {
  return disclosureFingerprint({ ...atlas, author: '' });
}

function accessionMap() {
  const sorted = [...allPlaces()].sort((a, b) =>
    (a.createdAt || '').localeCompare(b.createdAt || '') || String(a.id).localeCompare(String(b.id)));
  const m = new Map();
  sorted.forEach((p, i) => m.set(p.id, i + 1));
  return m;
}

// Where you are, and the atlas read from there.
//
// This runs on the device and asks nothing of any server of ours: the phone
// answers, the atlas is already here, and the arithmetic is a subtraction. It
// is free for the same reason the rest of the atlas is free.
//
// The dot on the field is drawn either way, because a person who asked where
// they are should be shown it whether or not they came for the list.
//
// Three places used to ask, each with its own four lines and its own idea of
// what came back. One kept `{lat, lng}` and dropped the accuracy the device
// had just handed over; another flew the map; the third did not. So the ask
// lives here once, the answer is kept whole, and everything downstream reads
// one shape.
//
// The fix is watched rather than sampled. Standing still, that costs nothing
// and the dot simply sits; walking, the dot walks with you, which is the only
// version of this that is true a minute after it is drawn.
const HERE_STALE_MS = 5 * 60 * 1000;

// `quiet` is for the asks nobody made: picking the watch back up when the tab
// comes forward is housekeeping, and housekeeping that announces itself twice
// a minute is how a sentence stops being read.
function askWhereYouAre(then, { fly = true, quiet = false } = {}) {
  // A watch already running is not a reason to do nothing.
  //
  // `mapView.locate` refuses a second subscription, which is right, and the
  // callback below only fires on a fix that has actually arrived. Together
  // those two silently ate the caller: press the arrangement word, then type
  // `near`, and findMe asked for a fix that was already held, got no answer
  // because nothing new had happened, and never opened the board. The fix is
  // held. Hand it over.
  if (mapView.watchingHere() && hereNow()) { then?.(state.here); return; }
  if (!quiet) toast('asking this device where you are');
  mapView.locate(
    (at) => {
      const first = !state.here;
      state.here = { lat: at.lat, lng: at.lng, accuracy: at.accuracy, at: Date.now() };
      // A fix that arrives while the index is open and sorted by distance
      // reorders it under the reader's hands, which is the point of having
      // asked. A fix arriving after that only moves the dot.
      paintSort();
      if (state.sort === 'distance' && !$('#indexOverlay').hidden) renderList();
      if (first) then?.(state.here);
    },
    (why) => {
      // A refusal ends it. Permission withdrawn mid-watch leaves a dot on the
      // field and a number on every row, sourced from a device that has just
      // said it will not answer again, and a live watch is what hereNow reads
      // instead of the clock. So the fix goes with the permission.
      if (why?.code === 1) forgetWhereYouAre();
      if (!quiet) toast('this device would not say where you are');
    },
    { watch: true, fly },
  );
}

// Whether what is held still describes now. Distance from a fix taken in
// another town is worse than no distance at all, because it is a number and
// numbers are believed.
//
// Age is only evidence once nobody is listening. `watchPosition` reports
// movement, not time, so a watch that has said nothing for five minutes is a
// device saying you have not gone anywhere: read as staleness, that turns
// standing still into a reason to stop knowing where you are, and the word
// falls back to `nearest` under somebody who has not moved a step. So a live
// watch is trusted, and the clock starts when the watch stops, which is when
// the screen went away and the app genuinely stopped being told.
function hereNow() {
  if (!state.here) return null;
  if (mapView.watchingHere()) return state.here;
  if (Date.now() - state.here.at > HERE_STALE_MS) { forgetWhereYouAre(); return null; }
  return state.here;
}

function forgetWhereYouAre() {
  state.here = null;
  mapView.forgetHere();
}

function findMe() {
  askWhereYouAre(() => {
    state.sort = 'distance';
    openIndex();
    renderList();
    paintSort();
    toast('nearest you, from where this device says you are');
  });
}

// The sort word says what it measures from, because "nearest" answered a
// question nobody could see: nearest the middle of the field is a different
// list from nearest you, and the two are one press apart.
function paintSort() {
  const word = $('#sortWord');
  if (!word) return;
  word.textContent = {
    recent: 'newest',
    name: 'a–z',
    // hereNow and not state.here: a fix that has gone stale is dropped, and
    // the word has to drop back with it rather than keep promising you.
    distance: hereNow() ? 'nearest you' : 'nearest',
    city: 'by city',
  }[state.sort] || 'newest';
  word.setAttribute('aria-label', `Arrange: ${word.textContent}. Press to cycle.`);
}

// The one point every distance in this app is measured from.
//
// It existed twice and the two disagreed. The sort read `state.here || centre`
// and the number printed on each row read the centre alone, so a held fix put
// the list in one order and labelled it with another: pan the field with the
// index open and the rows re-render, keeping their order from you and taking
// their numbers from wherever the map had drifted to. A row reading 0.4 km sat
// under a row reading 2.1 km and neither figure was wrong on its own.
//
// A stale fix is not used, which is why this is a call and not a constant.
function measuringFrom() { return hereNow() || mapView.getCenter(); }

function filteredPlaces() {
  if (!['all', 'place'].includes(state.filters.kind)) return [];
  let list = allPlaces().filter(p => {
    if (state.filters.status !== 'all' && p.status !== state.filters.status) return false;
    if (state.filters.tags.size && !p.tags.some(t => state.filters.tags.has(t))) return false;
    return true;
  });
  // Nearest to what? The middle of the field, until a person says otherwise.
  //
  // Measuring from the view is the honest default: it is the only point the app
  // knows without asking anybody anything, and someone looking at Lisbon means
  // near Lisbon. But "nearest" reads as "nearest me", and the app was already
  // asking the device and throwing the answer away: locate was called with a
  // null callback, so the coordinate was computed, drawn as a dot on the field,
  // and dropped. state.here is that coordinate kept.
  const center = measuringFrom();
  const nos = accessionMap();
  switch (state.sort) {
    case 'name': list.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'distance': list.sort((a, b) => haversineKm(center, a) - haversineKm(center, b)); break;
    case 'city':
      // an atlas is read by where things are: cities in order, and the
      // placeless gathered at the end rather than scattered through it.
      //
      // The order is taken on the same key the bands are drawn from, because
      // this sort is what decides the order those bands appear in. It used to
      // be `city || country`, which drops the country, so two cities sharing a
      // name were ordered as one and their two bands came out adjacent and
      // identically headed. One key, one function.
      list.sort((a, b) => {
        const ac = cityLabel(a);
        const bc = cityLabel(b);
        const an = ac === PLACELESS;
        const bn = bc === PLACELESS;
        if (an !== bn) return an ? 1 : -1;
        return ac.localeCompare(bc) || a.name.localeCompare(b.name);
      });
      break;
    default: list.sort((a, b) => nos.get(b.id) - nos.get(a.id));
  }
  // What was pressed comes to the top, and nothing leaves the page.
  //
  // The same act as a city typed into a folio's title, and the same reason: an
  // atlas is read by where things are, and the answer to "show me Basel" is
  // Basel first, not Basel alone. A person who pressed a tag to see it is one
  // scroll from the place they were going to add to it.
  if (state.gather) {
    const { kind, value } = state.gather;
    const holds = (p) => (kind === 'tag'
      ? p.tags.includes(value)
      : oneSpelling(kind === 'city' ? p.city : p.country) === oneSpelling(value));
    list = [...list.filter(holds), ...list.filter(p => !holds(p))];
  }
  return list;
}

// ---------- the whole atlas, in one file ----------

// A backup is not a backup if part of it is missing, and this is now the
// only shape a backup can have.
//
// It used to be two operations. The pictures lived in a store of their own
// and had to be read back in before the file could be written, so a browser
// that was busy or short of room could hand back a file that looked whole and
// was not. The export answered that with a count, a second word, and a rescue
// copy that said inside itself what it was missing. None of that has anything
// left to guard: the records are the whole atlas, they are already in memory,
// and a file of them either writes or does not.
//
// So the day is recorded every time, with no branch above it deciding
// whether this one counted. There is nothing left that could make it not.
//
// It stays async with nothing to wait for. Two of its callers run it bare,
// off a pressed word, after the surface has already been put away. An atlas
// past the engine's string limit throws in stringify, and as a promise that
// is a rejection the console records; made plain, it is an exception thrown
// through a click handler that has already changed the screen.
async function exportEverything() {
  if (!loadLatestAtlas({ message: 'The private backup is unavailable until this atlas can be read again.' })) return false;
  download('resonate-private-backup.json', store.exportJSON(), 'application/json');
  store.settings.lastExportAt = new Date().toISOString();
  store.saveSettings();
  toast('Private backup file downloaded.');
  return true;
}

function exportOutwardFile(filename, make, type) {
  if (!loadLatestAtlas()) return false;
  download(filename, make(), type);
  return true;
}

// ---------- the photographs, and the door held open ----------
//
// Resonate no longer keeps pictures: a phone already has a photo library, and
// a second one inside a browser is the part most likely to go when the browser
// tidies up. A device that kept some before this is still holding them, and is
// owed the news, a way to take them, and the choice.
//
// Nothing in this section destroys anything unless a person presses the word
// that destroys, and the word that destroys is never the one the keyboard
// reaches for on the way out.
//
// The notice is a courtesy and never the only door. Under `you`, for as long
// as this device holds a single picture, the same offer stands under a word of
// its own. Anything that can be dismissed by accident must not be the last
// chance anybody gets.

// The marker records that the matter was settled, not that a dialog was seen.
//
// Only two things write it: the pictures were written out whole, or the person
// let them go. A dismissal writes nothing, so the notice returns on the next
// visit, which is what a person who waved a dialog away is owed when the
// subject of it is irreversible.
//
// It is a key of its own rather than a setting, because a setting would not
// survive being told. store.restore rebuilds settings from the defaults plus a
// whitelist, and normSettings reads them through another one, so a flag kept
// there comes home from any backup file as though the notice had never been
// given, and the person is asked again about photographs that by then are no
// longer there. This key starts with `resonate.`, which is what an erase
// sweeps, so erasing the device erases this with it.
const TOLD_KEY = 'resonate.photographs.told.v1';

function alreadyTold() {
  try { return !!localStorage.getItem(TOLD_KEY); } catch { return false; }
}

function rememberTelling() {
  // a browser that refuses this asks again on the next visit, which is the
  // safe way for it to fail
  try { localStorage.setItem(TOLD_KEY, new Date().toISOString()); } catch { /* said again, then */ }
}

// The rescue writes pages of html, and the shape is chosen for the person
// opening them rather than for the code writing them.
//
// A zip is the obvious answer and this repository cannot make one: the app has
// no dependencies and no build step, and a compression library is a large
// thing to take on in order to help something leave. A file of json holding
// data urls is two lines to write and is a file only this app can read, which
// is the opposite of what a rescue is for. A page opens by double click on any
// computer with nothing installed, shows the pictures at once, and hands each
// one to the browser's own save image. It is the only shape here that outlives
// Resonate, which is the whole point of writing it.

// What a picture says about itself underneath: the place it belonged to, and
// where that place is.
//
// It used to print the database id, which is a string this app minted for its
// own bookkeeping and which means nothing whatever to the person reading the
// page. Worse, the records are about to stop naming those ids at all, so the
// caption was on its way to being an unexplained id under a photograph whose
// place had become unknowable. A picture with nothing true left to say about
// it gets nothing said: a blank is honest, and an id is not.
function pictureCaption(pic) {
  const p = pic.place;
  if (!p) return '';
  const where = Number.isFinite(p.lat) && Number.isFinite(p.lng)
    ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
    : '';
  return [p.name, where].filter(Boolean).join('  ·  ');
}

// One page cannot hold every library, and the ones it cannot hold are exactly
// the ones that most need writing out.
//
// A data url is a third larger than the bytes it carries, and a string has a
// ceiling in every engine: around half a gigabyte in the smallest of them.
// Past it the write does not come back shorter, it throws, so a person with
// two thousand photographs got an exception and no file at all while a person
// with three got everything. The people this owes the most to were the only
// ones it could not serve.
//
// So the pictures are dealt into numbered pages, and each page says which one
// it is and how many there are, because a page that does not say so is a page
// somebody stops collecting after the first. The budget is far below the
// engine ceiling on purpose: the ceiling is where writing fails, and a rescue
// page also has to open, on whatever machine or phone is to hand, years from
// now. Twelve megabytes opens everywhere. Five hundred does not.
//
// A single picture larger than the budget still gets a page to itself. The
// budget decides how pictures are grouped; it never decides which are written.
const RESCUE_PAGE_BYTES = 12_000_000;

function rescuePages(pictures) {
  const sheets = [[]];
  let bytes = 0;
  for (const pic of pictures) {
    // the markup around a figure is small and not nothing, and the budget has
    // to hold for the file rather than for the pictures inside it
    const cost = pic.dataURL.length + 400;
    const here = sheets[sheets.length - 1];
    if (here.length && bytes + cost > RESCUE_PAGE_BYTES) { sheets.push([]); bytes = 0; }
    sheets[sheets.length - 1].push(pic);
    bytes += cost;
  }
  return sheets.map((sheet, i) => rescuePage(sheet, i + 1, sheets.length, pictures.length));
}

function rescuePage(pictures, page, pages, total) {
  const day = fmtDate(new Date().toISOString());
  const many = total !== 1;
  const of = pages > 1 ? ` (${page} of ${pages})` : '';
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Photographs from Resonate${esc(of)}</title>
<style>
  body { margin: 0 auto; padding: 7vh 6vw 14vh; max-width: 860px;
         background: #f4f1ea; color: #17140d;
         font: 16px/1.55 ui-serif, Georgia, "Times New Roman", serif; }
  h1 { margin: 0 0 0.7em; font-size: 1.5rem; font-weight: 500; letter-spacing: 0.01em; }
  p { max-width: 62ch; margin: 0 0 1em; }
  figure { margin: 3.5rem 0 0; }
  img { display: block; width: 100%; height: auto; background: #e3ded3; }
  figcaption { margin-top: 0.6em; color: #6d6757;
               font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; }
</style>
<h1>Photographs from Resonate${esc(of)}</h1>
<p>${esc(day)}. ${many ? `These ${total} pictures were` : 'This picture was'} kept by Resonate in a browser on one device.</p>
<p>${pages > 1
  ? `One file could not hold them all, so they are written across ${pages} pages and this is number ${page}. Keep every page: this one holds ${pictures.length}.`
  : `${many ? 'They are' : 'It is'} inside this file: no network, no app, opens anywhere.`}</p>
<p>To keep ${many ? 'one' : 'it'}, use your browser's own save image.</p>
${pictures.map((pic, i) => {
    const cap = pictureCaption(pic);
    return `<figure>
  <img src="${esc(pic.dataURL)}" alt="${esc(cap || `Photograph ${i + 1}`)}">
  ${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}
</figure>`;
  }).join('\n')}
`;
}

// The evening stands over everything on the way in, and a damaged atlas has
// the floor before this does. Every ask in the app is the same one box, so a
// notice raised while another question is standing would write itself into
// that question's markup and neither would be answerable. This waits for the
// floor instead. It is a courtesy and not a countdown: a person who leaves a
// surface open all afternoon is simply not interrupted, and nothing is
// recorded, so the notice comes back on the next visit.
//
// A place being named counts. It is a panel rather than a dialog and holds no
// surface, so modalUp() says nothing about it, and the notice used to open
// straight over a half typed name: the person's attention went, and the one
// Escape that waved the notice away threw the place away with it.
function theFloorIsFree() {
  return $('#intro')?.hidden !== false && !modalUp() && !state.pendingAdd;
}

// `wait` is the difference between a notice and an answer. Raised at boot it
// waits for the evening and for whatever else is standing. Reached from a
// pressed word under `you`, the person is looking straight at it and the
// surface they pressed it on is exactly what waiting would wait for.
async function offerTheFarewell(n, { wait = true } = {}) {
  if (wait) {
    // The wait can be a whole afternoon long, and what was true when it began
    // is only a guess by the time it ends. The door under `you` is open the
    // entire time, so a person can take their pictures or let them go while
    // this is still standing in the hall: it used to come out anyway, with the
    // count it was handed at boot, offering to write out photographs that were
    // already deleted, and then telling them the browser would not read them
    // back. So the situation is read again here, at the moment of speaking,
    // and the count that is read is the count that is said: a deletion that
    // only half succeeded leaves the offer standing, and what is left of it
    // has to be named accurately.
    //
    // A database that will not answer counts as nought, and the notice stands
    // down for this visit. That is the same answer the gate at boot already
    // gives, and it is the kinder one: on a browser refusing its own storage
    // the rescue page could not have been written anyway. Nothing is recorded,
    // the door stays under `you`, and it is offered again next visit.
    for (;;) {
      while (!theFloorIsFree()) await new Promise(r => setTimeout(r, 700));
      if (alreadyTold()) return undefined;
      const held = await photoStore.photographCount();
      // asking the database takes a moment, and a moment is long enough for
      // somebody to have started naming a place. round again rather than
      // opening over them.
      if (!theFloorIsFree()) continue;
      if (!held) return undefined;
      n = held;
      break;
    }
  }
  const count = n === 1 ? 'one photograph' : `${n} photographs`;
  const word = await ask(
    `Your photographs are leaving Resonate. This device is holding ${count}. A phone already keeps a photo library, and a second one inside a browser is the part most likely to go when the browser tidies up.\n\n`
    + 'Nothing has been deleted. What is here stays here until you say otherwise, and this offer stays in your room for as long as anything is here.\n\n'
    + 'A page can be written now holding every picture on this device. It opens in any browser, on any computer, with nothing installed, and every picture can be saved out of it. Keep it somewhere that is not this browser.\n\n'
    + 'Dropping a photograph on the map still makes a place. The app reads the location saved in the file and keeps nothing of the picture itself.',
    { yes: 'take my photographs', also: 'let them go', no: 'leave them here' });
  // Escape resolves the way "leave them here" does, and that is the whole
  // reason nothing is recorded on this branch.
  //
  // It used to record the telling here, and the boot gate is "unless already
  // told", so one reflex keypress on the way past a dialog retired the only
  // route those photographs had out of this browser, permanently and in
  // silence. A dismissal now costs nothing: the notice comes back on the next
  // visit, and the way in from `you` stands whatever is pressed. Only the
  // two words that resolve the situation write the marker, and they write it
  // where the situation is actually resolved.
  if (word === true) return writeThePictures();
  if (word === 'also') return letThePicturesGo(n);
  return undefined;
}

async function writeThePictures() {
  toast('reading them out of this browser');
  const { pictures, unread } = await photoStore.everyPhotograph();
  if (!pictures.length) {
    toast('this browser would not read them back. nothing was written, and nothing was deleted', 7000);
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  let sheets;
  try { sheets = rescuePages(pictures); }
  catch {
    toast('this browser could not write that file. nothing was deleted', 7000);
    return;
  }
  // A second file arriving in the same instant is a file some browsers drop
  // without telling anybody, so the pages are handed over one at a time with a
  // breath between them.
  let written = 0;
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets.length === 1
      ? `resonate-photographs-${day}.html`
      : `resonate-photographs-${day}-${i + 1}-of-${sheets.length}.html`;
    try { download(name, sheets[i], 'text/html'); written += 1; }
    catch { /* counted below, and named */ }
    if (i < sheets.length - 1) await new Promise(r => setTimeout(r, 600));
  }
  if (!written) {
    toast('this browser could not write that file. nothing was deleted', 7000);
    return;
  }
  if (written < sheets.length) {
    toast(`${written} of ${sheets.length} pages were written. some of your pictures are not in them, and nothing was deleted`, 9000);
    return;
  }
  // A page short of somebody's photographs is not the page they asked for, and
  // it is worse than none because it looks like one. It is still handed over,
  // because what could be read is theirs, but the telling is not recorded: a
  // browser that is busy or short of room often answers on the second ask, and
  // the offer has to still be there for them to take it.
  if (unread) {
    toast(`${unread} picture${unread === 1 ? '' : 's'} could not be read and ${unread === 1 ? 'is' : 'are'} not in that page. the rest are, and nothing was deleted`, 9000);
    return;
  }
  rememberTelling();
  toast(sheets.length === 1
    ? 'every picture on this device is in that page. keep it somewhere that is not this browser'
    : `every picture on this device is across those ${sheets.length} pages. keep all of them somewhere that is not this browser`, 7000);
}

async function letThePicturesGo(n) {
  const count = n === 1 ? 'one photograph' : `${n} photographs`;
  const sure = await ask(
    `Delete ${count} from this device? Nothing else holds a copy unless you have already written one out. This cannot be undone, and Resonate cannot bring back what it deletes.`,
    { yes: n === 1 ? 'delete it' : 'delete them', no: 'stop', danger: true });
  // stop means stop at the deleting, not at the question: the offer to take
  // them is put back rather than spent
  if (!sure) return offerTheFarewell(n, { wait: false });
  const said = await photoStore.releasePhotographs();
  if (said === 'refused') {
    toast('this browser would not do it. nothing was deleted', 7000);
    return undefined;
  }
  // nothing on screen may outlast what a person deleted
  const shown = state.selectedId ? placeById(state.selectedId) : null;
  if (shown && !$('#plate').hidden) renderPlate(shown);
  renderAll();
  paintKept('#setKept');
  paintKept('#statKept');
  // The pictures are in two places and either can refuse. A person told
  // "gone" while some are still here would believe it and stop looking, so a
  // half deletion is named as one and the offer is left standing.
  if (said === 'partly') {
    const left = await photoStore.photographCount();
    const device = $('#deviceSettings');
    if (device) device.dataset.photographs = String(left);
    paintDeviceState();
    toast(`some went and ${left} did not. this browser refused the rest, and the offer in your room still stands`, 9000);
    return undefined;
  }
  const device = $('#deviceSettings');
  if (device) delete device.dataset.photographs;
  const photoWay = $('#photoWay');
  if (photoWay) photoWay.hidden = true;
  const photoWaySub = $('#photoWaySub');
  if (photoWaySub) {
    photoWaySub.hidden = true;
    photoWaySub.textContent = '';
  }
  paintDeviceState();
  rememberTelling();
  toast('the photographs are gone from this device. your places, paths and notes are exactly as they were', 7000);
  return undefined;
}

// ---------- the way back in ----------
//
// An import is three steps in this order: read, decide, commit.
//
// It was four for as long as an archive could carry photographs, and before
// that it was two in the wrong order. Every picture in the file was decoded
// and written into a store of its own first, and whatever came out was handed
// to the validator afterwards. Storage happened before validation, which cost
// three things. A file that was then refused had already spent the room, and
// nothing ever gave it back. The same file imported twice minted fresh blobs,
// then discovered every record id was already held and kept none of them, so
// the pictures sat there with nothing pointing at them. And a file nobody had
// checked yet was decoded on the strength of the person having selected it,
// which is not the same as it being safe.
//
// A staging step answered all three, and then the pictures left the records
// and the stage had nothing left to hold. What the stage was really for
// survives it: nothing is written until the whole archive has been read and
// the mutation is known.

// how many photographs a file carried that this build keeps none of. The
// schema hands back one entry per place; a person is owed the total.
function photographsSetAside(list) {
  return (list || []).reduce((n, e) => n + (e.given || 0), 0);
}

// Read, decide, commit. Returns
//   { ok, added, why, lost, setAside, was, now }
// where `why` is one of 'unreadable' | 'lossy' | 'refused', `lost` names
// every record and field the file could not hand over exactly, and `setAside`
// names every place whose photographs this build has no place for. A loss
// stops the atlas at the door. A set-aside field does not, because the file
// is untouched and still holds every picture: it is said, and then the atlas
// comes home.
//
// It keeps `async` with nothing left to wait for. All five callers await it
// from inside a run of real awaits, so the keyword costs nothing and its
// absence would read, in the middle of the club chain, as an oversight.
async function bringHome(parsed, { replace = false } = {}) {
  const read = store.readOwn(parsed);
  if (!read.value) return { ok: false, why: 'unreadable', lost: [], setAside: [] };
  if (read.lost.length) return { ok: false, why: 'lossy', lost: read.lost, setAside: read.setAside };

  // Merge and restore read the archive a second time, through the same door,
  // and that door begins by asking a file what it is. `read.value` is the
  // records alone: readAtlas never puts the marks back on them. So the file's
  // own two are carried across here, or the second read refuses the exact file
  // the first one accepted, and both words of import answer "this device
  // refused the write, so nothing changed" for every archive ever written.
  // The marks are the file's, not this build's, because the second read is
  // reading the same file and a v4 archive must go on saying it is one.
  const marks = { app: parsed?.app, version: parsed?.version };

  // No sweep on either side of this any more, and that is the whole of it.
  // The sweep deleted every picture no record pointed at, which was right
  // while a record could point at one. A record cannot now, so a sweep here
  // would take every photograph on the device, on the first import after the
  // update, without a word. What is held is held until the person says
  // otherwise.
  if (replace) {
    const r = store.restore({ ...marks, ...read.value });
    if (!r.ok) return { ok: false, why: r.reason, lost: r.lost || [], setAside: read.setAside };
    return { ok: true, added: r.now.places + r.now.routes, was: r.was, now: r.now, lost: [], setAside: read.setAside };
  }
  const added = store.merge({ ...marks, ...read.value }, { own: true });
  if (added === null) return { ok: false, why: 'refused', lost: store.lastLost || [], setAside: read.setAside };
  return { ok: true, added, lost: [], setAside: read.setAside };
}

// Something on this device will not read, and the app is not going to pretend
// otherwise. Nothing has been written over: the damaged bytes are still here,
// a copy is set aside, and the person chooses what happens next.
const KEY_NAMES = {
  'resonate.places.v1': 'your places',
  'resonate.routes.v1': 'your paths',
  'resonate.tags.v1': 'your tags',
  'resonate.folios.v1': 'your collections',
  'resonate.correspondents.v1': 'your people',
  'resonate.settings.v1': 'your settings',
  // Named like the rest, because this key became one the store can seal on the
  // day it started holding an identity, and a table that has not caught up
  // hands a person the storage key itself. The words are the surface's own:
  // this is what voices calls the second half of itself.
  'resonate.letters.v1': 'your letters',
  // the ledger of letters dealt with. named because a sealed key here means a
  // letter thrown away can arrive again, which is a thing a person can be told
  'resonate.post.v1': 'which letters you have finished with',
};

async function tellAboutDamage(damaged) {
  // say which part, and what is wrong with it: "your places" alone leaves a
  // person guessing whether the file is gone or merely refused
  const named = damaged
    .map(d => `${KEY_NAMES[d.key] || d.key}${d.why ? ` (${d.why})` : ''}`)
    .join('\n');
  const go = await ask(
    `Something on this device will not read: ${named}.\n\n`
    + 'It has not been thrown away and it has not been written over. A copy of the exact bytes is set aside on this device, and nothing will be saved into this part of your atlas until you choose.\n\n'
    + 'The rest of your atlas still works. Export what you can read before anything else, and keep that file.',
    { yes: 'export what still reads', also: 'start this part fresh', no: 'leave it for now' });
  if (go === true) {
    download('resonate-rescued.json', store.exportJSON(), 'application/json');
    return toast('what could be read is in that file. keep it somewhere safe', 6000);
  }
  if (go === 'also') {
    const sure = await ask(
      'Start these parts fresh? The set aside copy stays on this device, so this is not a deletion; it means this app stops waiting and begins writing again.',
      { yes: 'start fresh', no: 'stop' });
    if (!sure) return;
    damaged.forEach(d => releaseUnreadable(d.key));
    store.savePlaces(); store.saveTags(); store.saveRoutes();
    store.saveFolios(); store.saveCorrespondents(); store.saveSettings();
    renderAll();
    toast('writing again. the unreadable copy is still on this device', 5000);
  }
}

// A file the person chose is still a file. It is read whole into a string and
// parsed on the thread that draws the field, so the only honest place to say
// no is before any of that begins. Above this the tab simply stops answering
// for a few seconds, and past a browser's own string limit the read comes
// back empty and the app used to call a perfectly good archive "not a
// resonate export".
const ARCHIVE_BYTES = 96 * 1024 * 1024;

// The sentence used to end by naming two ways round it, and neither exists.
// "A smaller export" was written when a person could leave the photographs
// out of one; there is one export now and it is the whole atlas, so there is
// no lever to pull. "The club" refuses anything over sixteen million bytes,
// which is a sixth of what is being refused here. Telling somebody holding a
// file this size to try either is sending them somewhere that will turn them
// away again, so the sentence stops at the truth it can keep.
function readArchiveFile(file, onParsed) {
  if (file.size > ARCHIVE_BYTES) {
    const mb = n => `${(n / (1024 * 1024)).toFixed(0)} MB`;
    return ask(
      `That file is ${mb(file.size)}, and this build reads up to ${mb(ARCHIVE_BYTES)} in one go.\n\n`
      + 'It is not refused because anything is wrong with it. Reading it here would stop this tab answering for several seconds and could still end with the browser refusing to keep the result, which is a worse way to find out.',
      { yes: 'i see', no: '' });
  }
  const reader = new FileReader();
  reader.onerror = () => toast('this device could not read that file. nothing changed');
  reader.onload = async () => {
    const text = String(reader.result || '');
    if (!text) {
      return toast('that file could not be read whole on this device. nothing changed', 6000);
    }
    let parsed = null;
    try { parsed = JSON.parse(text); }
    catch { return toast('that file isn’t a resonate export'); }
    await onParsed(parsed);
  };
  reader.readAsText(file);
  return null;
}

// ---------- a file arrives, and is asked what it is ----------
//
// One door, several kinds of file, and the kind decided before any reader
// runs. This used to be a single question: is this a private archive? Anything
// else was told it was not a resonate export, which was untrue of the file
// this app hands a person when a link is too long to send. That file had no
// reader anywhere. It was offered as the way around a long link and there was
// nothing at the other end of it.
//
// The two kinds are kept apart deliberately rather than folded together. An
// archive is a person's own atlas coming home and may replace everything they
// hold. A handover is somebody else's material and may replace nothing: it
// opens as a visit, exactly as the same atlas would if it had arrived as a
// link, and nothing is written until the person takes a record.
async function openResonateFile(parsed) {
  const { kind, value } = classifyFile(parsed);

  if (kind === 'private_archive') return openArchive(value);

  // the same object a link carries, so it opens the same way. arriving as a
  // file rather than in an address bar changes the carrier and nothing else.
  if (kind === 'human_handover') return openReport(value);

  if (kind === 'assistant_copy') {
    const open = await ask(
      'This is a copy made for an assistant to read. It is not a backup: it holds what you would hand a friend, '
      + 'and nothing of your people, collections, or settings. Restoring from it would leave you with less than you have.\n\n'
      + 'The atlas inside it is an ordinary handover, and it can be opened as one.',
      { yes: 'open what is inside', no: 'never mind' });
    if (open) openReport(value);
    return null;
  }

  if (kind === 'ambiguous') {
    return toast('that file answers to two descriptions at once, and this build will not guess which. nothing changed', 7000);
  }
  if (kind === 'unreadable') {
    return toast('that file is from resonate, but nothing in it is a shape this build can read', 6500);
  }
  return toast('that file isn’t a resonate export');
}

// ---------- an archive arrives ----------
//
// Two operations, named, because they were never one operation.
//
// "Bring in what is missing" adds records this atlas does not have and
// touches nothing it does. "Make this atlas the file" replaces. Import used
// to be only the first, under a word that promised the second: a backup could
// not bring back an older note, an earlier name, an earlier shape of a way,
// or an atlas edited by mistake. It could only ever
// add, and a person restoring a backup had no way to learn that.
//
// The counts are shown before either word is pressed, because replacing is
// not undoable by the app and a person is owed the size of it first.
async function openArchive(parsed) {
  const seen = store.compare(parsed);
  if (!seen) return toast('that file isn’t a resonate export');
  if (seen.lost.length) return sayWhatWasLost(seen.lost);

  // every kind a replace touches, because the sentence below sets this count
  // against the file's, and the file's now spans all five kinds
  const held = store.places.length + store.routes.length + store.tags.length
    + store.folios.length + store.correspondents.length;
  // A file written before photographs left a record still carries them. They
  // are counted here, in the panel that is read before either word is
  // pressed, rather than after the write or not at all. Nothing is destroyed
  // by reading a file, so this is a sentence and not a refusal.
  const nPics = photographsSetAside(seen.setAside);
  // The counts are said by kind now, because the comparison finally sees
  // every kind. "4 records it has, differently" cannot tell a person whether
  // a note changed or a folio lost half its places; "1 changed path, 1
  // changed folio" can. The settings a restore would change are the quietest
  // and most surprising replacement of all, so they get a sentence too.
  const kindWord = { places: 'place', paths: 'path', tags: 'tag', folios: 'collection', books: 'book', voices: 'person' };
  const perKind = (field, adj) => Object.entries(seen.byKind)
    .filter(([, k]) => k[field].length)
    .map(([kind, k]) => `${k[field].length} ${adj} ${kindWord[kind]}${k[field].length === 1 ? '' : 's'}`);
  const SETTING_WORDS = { authorName: 'the sharing name', theme: 'the look', hue: 'the look', split: 'the look', words: 'the labels' };
  const settingNames = [...new Set(seen.settings.changed.map(k => SETTING_WORDS[k]).filter(Boolean))];
  const lines = [
    ...(seen.fresh ? perKind('fresh', 'new') : ['nothing this atlas does not have']),
    ...perKind('changed', 'changed'),
    seen.identical ? `${seen.identical} already the same` : '',
    seen.onlyHere ? `${seen.onlyHere} here that the backup file does not have` : '',
    settingNames.length ? `${settingNames.join(' and ')} differ${settingNames.length === 1 ? 's' : ''}: replacing sets the backup file's` : '',
    nPics ? `${nPics} photograph${nPics === 1 ? '' : 's'} this version does not keep. your backup file still has them` : '',
  ].filter(Boolean).join('\n');

  const word = await ask(
    `This backup file and this atlas, side by side:\n\n${lines}\n\n`
    + 'Bring in what is missing, and nothing you already have changes. '
    + `Make this atlas the file, and the ${held} record${held === 1 ? '' : 's'} here are replaced by the ${seen.fresh + seen.differ + seen.identical} in it. `
    + 'A snapshot is taken first either way.',
    { yes: 'bring in what is missing', also: 'make this atlas the file', no: 'never mind' });
  if (!word) return;

  // whichever way this goes, the atlas as it stands is written down first
  try { await photoStore.snapshotPut(store.recordsJSON()); await photoStore.snapshotPrune(3); }
  catch { /* a device with no room for a snapshot still gets the choice */ }

  if (word === 'also') {
    const sure = await ask(
      `Replace ${held} record${held === 1 ? '' : 's'} with what is in this file? `
      + `${seen.onlyHere} record${seen.onlyHere === 1 ? '' : 's'} here that the file does not have will be gone. `
      + 'The snapshot just taken is on this device, in your room, and can be brought back.',
      { yes: 'replace this atlas', no: 'stop', danger: true });
    if (!sure) return;
  }

  const r = await bringHome(parsed, { replace: word === 'also' });
  if (!r.ok) {
    if (r.why === 'lossy') return sayWhatWasLost(r.lost, { verb: word === 'also' ? 'replace this one' : 'bring in' });
    if (r.why === 'unreadable') return toast('that file isn’t a resonate export');
    return toast('this device would not save it, so nothing changed');
  }
  renderSettings(); renderAll();
  if (store.places.length) mapView.fitAll(store.places);
  if (word === 'also') {
    toast(`this atlas now matches the backup file. ${r.now.places} place${r.now.places === 1 ? '' : 's'}, ${r.now.routes} path${r.now.routes === 1 ? '' : 's'}`, 5000);
  } else {
    toast(r.added ? `${r.added} record${r.added === 1 ? '' : 's'} came in` : 'nothing in that file this atlas lacks');
  }
}

// the map a person actually uses: their platform's own, then the web's
function directionsURL(lat, lng, name = '') {
  const ua = navigator.userAgent;
  const q = encodeURIComponent(name || `${lat},${lng}`);
  if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return `https://maps.apple.com/?daddr=${lat},${lng}&q=${q}`;
  if (/Android/.test(ua)) return `geo:${lat},${lng}?q=${lat},${lng}(${q})`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// ---------- the house asks, rather than the browser ----------
//
// A native confirm escapes the focus trap, ignores the inert background, and
// wears the operating system's clothes in an app that has none. These do not.

// One dialog serves every question in this app, so anything a question turns on
// has to be turned off again by the next one. textContent and not innerHTML:
// what goes in here is computed from keys and addresses, and the day something
// else is handed to it this is not the line that should decide it is markup.
function showSaid(said) {
  const el = $('#askSaid');
  el.textContent = said || '';
  el.hidden = !said;
}

// true, false, or the third word when one is offered. A question with two
// real answers and a way out needs three words, not a `no` doing both jobs:
// "replace everything" must never be the button that also means "never mind".
//
// `said` is for the one string this app asks somebody to read out character by
// character. It gets its own element rather than a line inside the question,
// because a question is prose and a mark is not, and the two cannot share a
// paragraph without the mark losing.
function ask(question, {
  yes = 'yes', no = 'no', also = '', said = '', danger = false, dangerAlso = false,
} = {}) {
  const box = $('#askBox');
  box.classList.toggle('danger', danger);
  box.classList.toggle('danger-also', dangerAlso);
  $('#askWhat').textContent = question;
  showSaid(said);
  $('#askInput').hidden = true;
  $('#askGo').textContent = yes;
  // a statement a person can only acknowledge gets one word, not a refusal
  $('#askNo').textContent = no;
  $('#askNo').hidden = !no;
  const third = $('#askAlso');
  third.textContent = also;
  third.hidden = !also;
  return new Promise((resolve) => {
    const done = (v) => {
      $('#askGo').onclick = null; $('#askNo').onclick = null; third.onclick = null;
      box.onkeydown = null;
      box.classList.remove('danger');
      box.classList.remove('danger-also');
      delete box.dataset.initialFocus;
      third.hidden = true;
      $('#askNo').hidden = false;
      dropDialog(box);
      resolve(v);
    };
    $('#askGo').onclick = () => done(true);
    $('#askNo').onclick = () => done(false);
    third.onclick = () => done('also');
    // The keypress is answered here and goes no further. It used to stop only
    // the browser's default, so it went on bubbling to the app's own Escape,
    // which reaches past everything by design: one press, and the dialog was
    // dismissed and the place being named behind it was thrown away too. A key
    // that answers the thing in front of you must not also answer the thing
    // behind it.
    box.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    };
    // The label carries the mark as well as the question. raiseDialog writes
    // aria-label, which is the whole accessible name of the dialog, and the
    // mark used to be inside the question text: moving it into its own element
    // for sighted readers would otherwise have taken it away from the one
    // person who cannot read it off the screen at all.
    raiseDialog(box, said ? `${question} ${said}` : question, {
      role: danger || dangerAlso ? 'alertdialog' : 'dialog',
    });
    // A destructive answer is never where Enter lands by default. The words
    // still keep their deliberate reading order, but the safe way out gets
    // the keyboard and switch-control focus when the question first arrives.
    //
    // On a short phone the longest notice is taller than the glass. Focusing
    // its answer used to make the browser scroll the question to the bottom
    // before it had been read, cutting off its opening with no visible clue.
    // Begin every question at its beginning, and hand focus to the answer only
    // when that answer is already on screen. Otherwise the dialog itself keeps
    // focus; the first Tab reaches the answer and scrolls there deliberately.
    box.scrollTop = 0;
    const firstAnswer = (danger || dangerAlso) && !$('#askNo').hidden ? $('#askNo') : $('#askGo');
    const answerRect = firstAnswer.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    if (answerRect.top >= boxRect.top && answerRect.bottom <= boxRect.bottom) {
      delete box.dataset.initialFocus;
      firstAnswer.focus();
    } else {
      // WebKit does not reliably walk forward from a tabindex=-1 scroll
      // container. The shared trap reads this one deliberate next stop rather
      // than letting the first Tab fall through to BODY. For a destructive
      // question it is the safe answer, exactly as it is on a taller screen.
      box.dataset.initialFocus = firstAnswer.id;
    }
  });
}

// A link arriving here was made somewhere else, by a build that may have had
// other bounds, so this is deliberately far above the longest link this app
// will make. Anything that ever hit it was not a link.
const PASTED_LINK_MAX = 64_000;

// `max` is not decoration. The field carries maxlength="200" in the markup,
// which is right for a name and silently wrong for a link: a browser truncates
// a paste at the attribute without a word, so a person who pasted an atlas link
// into `open one sent to me` handed over the first two hundred characters of it
// and was told it was not a link. The bound belongs to the question, so the
// question sets it, and every door that takes a link says so.
function askText(question, { value = '', yes = 'keep', no = 'never mind', placeholder = '', max = 200 } = {}) {
  const box = $('#askBox');
  const input = $('#askInput');
  $('#askWhat').textContent = question;
  showSaid('');
  input.hidden = false;
  input.maxLength = max;
  input.value = value;
  input.placeholder = placeholder;
  $('#askGo').textContent = yes;
  $('#askNo').textContent = no;
  return new Promise((resolve) => {
    const done = (v) => {
      $('#askGo').onclick = null; $('#askNo').onclick = null; box.onkeydown = null;
      input.hidden = true;
      dropDialog(box);
      resolve(v);
    };
    $('#askGo').onclick = () => done(input.value.trim());
    $('#askNo').onclick = () => done(null);
    // answered here, and no further: the same rule as ask() above
    box.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(input.value.trim()); }
    };
    raiseDialog(box, question);
    input.focus(); input.select();
  });
}

// ---------- a place arrives from elsewhere ----------
//
// A share sheet, a pasted link, a set of coordinates. One surface answers all
// of them: what we understood, one choice, one press. Nothing is demanded
// that the source did not already carry.

const INBOX_KEY = 'resonate.inbox.v1';
const SHARE_DB = 'resonate-share';

function openShareDB() {
  return new Promise((resolve) => {
    let req;
    let settled = false;
    const answer = (value) => {
      if (settled) { try { value?.close?.(); } catch { /* a late open after a block */ } return; }
      settled = true;
      resolve(value);
    };
    try { req = indexedDB.open(SHARE_DB, 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { autoIncrement: true });
    };
    req.onsuccess = () => answer(req.result);
    req.onerror = () => answer(null);
    req.onblocked = () => answer(null);
  });
}

// What the service worker caught, one item at a time.
//
// This used to read everything and clear the store inside the same
// transaction. The transaction committed, and only then did the app try to do
// anything with what it held: a crash, a reload, or a closed tab in that gap
// took the shares with it, and the person who had just shared a place from
// their phone had no way to know it was gone. An item is taken only after the
// app has said it has it.
async function peekShared() {
  const db = await openShareDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('shared', 'readonly');
      const s = tx.objectStore('shared');
      const keys = s.getAllKeys();
      const vals = s.getAll();
      tx.oncomplete = () => { db.close(); resolve((keys.result || []).map((k, i) => ({ key: k, item: (vals.result || [])[i] }))); };
      tx.onabort = tx.onerror = () => { db.close(); resolve([]); };
    } catch { db.close(); resolve([]); }
  });
}

function forgetShared(key) {
  return new Promise(async (resolve) => {
    const db = await openShareDB();
    if (!db) return resolve(false);
    try {
      const tx = db.transaction('shared', 'readwrite');
      tx.objectStore('shared').delete(key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onabort = tx.onerror = () => { db.close(); resolve(false); };
    } catch { db.close(); resolve(false); }
  });
}

// A strict snapshot for a cross-store erase. Unlike the ordinary inbox read,
// null means the database refused; an erase may not turn that into an empty
// inbox and continue over state it never managed to preserve.
async function sharedForErase() {
  const db = await openShareDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('shared', 'readonly');
      const store = tx.objectStore('shared');
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () => {
        db.close();
        resolve((keys.result || []).map((key, i) => ({ key, item: (values.result || [])[i] })));
      };
      tx.onabort = tx.onerror = () => { db.close(); resolve(null); };
    } catch { db.close(); resolve(null); }
  });
}

function restoreSharedForErase(entries) {
  return new Promise(async (resolve) => {
    const db = await openShareDB();
    if (!db) return resolve(false);
    try {
      const tx = db.transaction('shared', 'readwrite');
      const store = tx.objectStore('shared');
      for (const { key, item } of entries || []) store.put(item, key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onabort = tx.onerror = () => { db.close(); resolve(false); };
    } catch { db.close(); resolve(false); }
  });
}

// Erase the inbox with one ordinary transaction. Deleting the database itself
// cannot be cancelled after `onblocked`: it may delete later, after the atlas
// has already rolled back. Clearing the sole store commits atomically and an
// open/error/abort is therefore an honest false.
function wipeShareDB() {
  return new Promise(async (resolve) => {
    const db = await openShareDB();
    if (!db) return resolve(false);
    try {
      const tx = db.transaction('shared', 'readwrite');
      tx.objectStore('shared').clear();
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onabort = tx.onerror = () => { db.close(); resolve(false); };
    } catch { db.close(); resolve(false); }
  });
}

async function rollbackPreparedErase(shared, { reload = true } = {}) {
  // Try every restoration even if one store refuses: each is independently
  // idempotent, and the durable local journal stays until all three are back.
  const photos = await photoStore.rollbackClear();
  const inbox = Array.isArray(shared) ? await restoreSharedForErase(shared) : true;
  const atlas = store.rollbackClearAll({ reload });
  if (!(photos && inbox && atlas)) return false;
  return store.finishClearAll();
}

async function recoverInterruptedErase() {
  const pending = store.pendingClearAll();
  if (!pending) return true;
  const shared = pending.context?.shared;
  if (pending.state === 'prepared') {
    return rollbackPreparedErase(shared, { reload: false });
  }
  // `committed` is written only after the atlas, inbox and photo stores have
  // all cleared. Finish removing the reversible copies; a refusal leaves the
  // marker in place so the next visit retries rather than resurrecting half.
  if (!await wipeShareDB()) return false;
  if (!await photoStore.commitClear()) return false;
  return store.finishClearAll();
}

function inboxRead() {
  try { return JSON.parse(localStorage.getItem(INBOX_KEY) || '[]'); } catch { return []; }
}
function inboxWrite(list) {
  try { localStorage.setItem(INBOX_KEY, JSON.stringify(list.slice(-20))); return true; }
  catch { return false; }
}

function inspectShared(raw) {
  try { return readShared(raw); } catch { return null; }
}

async function receiveShared(raw, inspected = undefined) {
  const found = inspected === undefined ? inspectShared(raw) : inspected;
  if (!found) return toast('nothing in that to keep');
  // the worker bounds what it keeps, and says when it had to. a shortened
  // share is still a share; it is not silently a whole one.
  if (raw?.shortened) toast('that share was long. the beginning of it was kept', 5000);

  const held = alreadyHeld(found, allPlaces());
  if (held) {
    selectPlace(held.id, { fly: true });
    return toast('already in your atlas');
  }

  // coordinates in hand: propose it on the field, as any found place
  if (found.at) {
    const named = found.name || 'this point';
    proposePlace({ name: named, lat: found.at.lat, lng: found.at.lng,
      sub: found.address || found.source, address: found.address || '', url: found.url || '' });
    if (!found.name || !found.address) {
      // the world can fill in what the link did not carry, once
      reverseGeo(found.at.lat, found.at.lng).then(g => {
        if (!g || !state.proposal) return;
        state.proposal = { ...state.proposal, city: g.city, country: g.country,
          countryCode: g.countryCode, address: state.proposal.address || g.address };
        $('.plate-sub') && ($('.plate-sub').textContent = [g.city, g.country].filter(Boolean).join(' · '));
      }).catch(() => { /* offline is fine; the point stands */ });
    }
    return;
  }

  // A link that parsed to nothing is not a name for anything. It reaches here
  // from a share with no title and from a link pasted into the bar, and putting
  // its hostname in the command line makes the next press a search for a
  // hostname. Say what is true and offer the one thing that can open it: the
  // page itself, which is where the place actually is.
  if (found.opaque) {
    return toast('that link keeps its place behind it. open it, then bring the name or the coordinates back here', 9000,
      safeUrl(found.url) ? { word: 'open it', run: () => window.open(found.url, '_blank', 'noopener') } : null);
  }

  // A name and no point. The page promises that the world is asked only when
  // a person presses for it, so a share does not quietly become a search:
  // the name is put in the command line, and the press is theirs. A hostname
  // is not a name, and the block above turned that away already.
  openPalette();
  palette.input.value = found.name;
  renderPaletteResults(found.name);
  toast('press to ask openstreetmap where this is');
}

// what waited for a network, offered when there is one
async function drainInbox() {
  const waiting = inboxRead();
  if (!waiting.length || !navigator.onLine) return;
  toast(`${waiting.length} share${waiting.length === 1 ? '' : 's'} waiting to be placed`, 5000, {
    word: 'place them',
    run: async () => {
      const item = waiting[0];
      const found = inspectShared(item);
      // Read before taking it out of the inbox. A malformed address must stay
      // available for a fixed parser rather than disappear on the strength of
      // a parser exception or an empty answer.
      if (!found) return toast('that share could not be read, so it was left in the inbox', 7000);
      await receiveShared(item, found); // one at a time, gently
      const rest = waiting.slice(1);
      if (!inboxWrite(rest)) toast('that share was placed, but this device could not update its inbox', 7000);
    },
  });
}

// ---------- the world: hue engine ----------

const rootStyle = document.documentElement.style;

// One rule holds the whole palette together: on the field, colour means a
// mark and the tag it belongs to. Nothing else moves. The interface wears
// a single tone, the one you chose, and it stays where you put it — a chrome
// that changed with every selection was colour saying nothing at all.
const FIELD_TONES = [
  { name: 'plum', hue: 300 },
  { name: 'iris', hue: 265 },
  { name: 'sea', hue: 228 },
  { name: 'moss', hue: 152 },
  { name: 'olive', hue: 116 },
  { name: 'amber', hue: 74 },
  { name: 'clay', hue: 40 },
  { name: 'rose', hue: 12 },
];

function fieldTone() {
  const h = Number(store.settings.hue);
  return FIELD_TONES.find(t => t.hue === h) || FIELD_TONES[0];
}

function applyWorldState() {
  rootStyle.setProperty('--hue', fieldTone().hue);
}

// pressing the tone word walks the wheel, and the word is the only label
function turnField() {
  const i = FIELD_TONES.indexOf(fieldTone());
  const next = FIELD_TONES[(i + 1) % FIELD_TONES.length];
  store.settings.hue = next.hue;
  store.saveSettings();
  applyWorldState();
  renderFieldWord();
}

function renderFieldWord() {
  const b = $('#fieldWord');
  if (!b) return;
  const name = fieldTone().name;
  b.textContent = name;
  b.setAttribute('aria-label', `Interface colour: ${name}. Press to change.`);
  b.title = 'change interface colour';
}

// ---------- theme ----------

const media = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme() {
  const t = store.settings.theme;
  return t === 'auto' ? (media.matches ? 'dark' : 'light') : t;
}

function applyTheme() {
  const resolved = resolvedTheme();
  document.documentElement.dataset.theme = resolved;
  mapView.setBasemap(resolved);
  // The browser's own bar follows the app's chosen theme too, not only the
  // operating system setting the initial markup could see.
  $$('meta[name="theme-color"]').forEach(m => {
    m.content = resolved === 'dark' ? '#110D18' : '#F7F3EE';
  });
  const w = $('#themeWord');
  if (w) {
    const mode = store.settings.theme;
    w.textContent = mode === 'auto' ? `auto · ${resolvedTheme() === 'dark' ? 'night' : 'day'}` : mode === 'dark' ? 'night' : 'day';
    w.setAttribute('aria-label', `Light and dark: ${w.textContent}. Press to change.`);
    w.title = 'day, night, or follow this device';
  }
}

function setTheme(mode) {
  store.settings.theme = mode;
  store.saveSettings();
  applyTheme();
}

media.addEventListener('change', () => { if (store.settings.theme === 'auto') applyTheme(); });

// ---------- surfaces ----------

const surfaces = [];
const surfaceEl = id => $(`#${id}`);

// The floor of the poster band, matching `.poster` in css/style.css. A poster
// opened onto the stack is lifted to POSTER_Z plus its depth, so the one you
// pressed for is the one you get. The ceiling is `.report` at 70, which is not
// a surface and is not on this stack: it is raised and dropped on its own and
// is meant to stand over everything here, which leaves fourteen deep before
// the two bands could meet. Three is what the walk that found this measured:
// the index board, `you` over it, and the club room over that.
const POSTER_Z = 55;
// The longest interactive surface motion is 480ms in the shared CSS tempo.
// Keep the transient class only through that motion, then leave the room at
// rest so a reopened surface never inherits stale choreography.
const SURFACE_OPEN_MS = 500;

// a surface is a dialog: it announces itself, takes the focus, keeps it while
// it stands, and hands it back to whatever summoned it
const returnFocus = new Map();

// a one-shot hook for a surface that must hand the floor back when it closes
let onHowClosed = null;
// the same one shot, for the room the fourth door opens: the first run
// question is not answered until that room closes and says whether anything
// came home
let onClubClosed = null;
// Set by an open composer. It receives the continuation that would leave the
// composer, and either runs it immediately for an untouched composition or
// holds it behind the app's own save / discard / keep-editing decision.
let onFolioClosed = null;

// the name waits in the middle of the field only until the field is used.
// summoning anything at all counts as using it.
let leaveHero = () => {};
function setHeroExit(fn) { leaveHero = fn; }

// the first-run door, reachable from anywhere that needs to offer it again
let openThreshold = () => {};
function setThresholdOpener(fn) { openThreshold = fn; }

// reading the opening again: the same words, without the first-run choices,
// since the choosing is long done
function showOpening() {
  const th = $('#threshold');
  // A second reading hides the three choices, because they have been made. The
  // way back therefore has to be a control of its own: escape is not a key a
  // phone has, and without one this screen had no exit at all.
  const again = store.places.length > 0 || !!store.settings.chosen;
  th.classList.toggle('revisited', again);
  $('#thBack').hidden = !again;
  openThreshold();
  if (again) {
    const back = $('#thBack');
    th.scrollTop = 0;
    const buttonRect = back.getBoundingClientRect();
    const roomRect = th.getBoundingClientRect();
    if (buttonRect.top >= roomRect.top && buttonRect.bottom <= roomRect.bottom) {
      delete th.dataset.initialFocus;
      back.focus({ preventScroll: true });
    } else {
      // Keep the opening visible on a short screen. The first Tab intentionally
      // walks to Back and lets the browser bring that control into view.
      th.dataset.initialFocus = back.id;
      th.focus({ preventScroll: true });
    }
  }
}

// the plate stands beside a living map and must never deaden it: you go on
// tapping marks while it is open. only a surface that covers the field
// takes the field out of reach.
const NON_MODAL = new Set(['plate']);
const STANDALONE_DIALOGS = ['askBox', 'nameAsk', 'threshold', 'reportOverlay', 'answerBar', 'handBar'];
const dialogReturnFocus = new WeakMap();
const dialogStack = [];

function modalUp() {
  if (STANDALONE_DIALOGS.some(id => {
    const el = document.getElementById(id);
    return el && !el.hidden;
  })) return true;
  return surfaces.some(id => !NON_MODAL.has(id));
}

// while anything covers the field, it is not reachable by tab, by screen
// reader, or by pointer
function setBackgroundInert(on) {
  // the plate is a sibling of the field, not a child: a modal has to reach
  // both, or a column left standing behind it stays clickable
  [$('#app'), $('#plate')].forEach(el => {
    if (!el) return;
    if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
    else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  });
}

// a dialog that does not live on the surface stack still behaves like one
function raiseDialog(el, label, { role = 'dialog' } = {}) {
  if (el.hidden) dialogReturnFocus.set(el, document.activeElement);
  const held = dialogStack.indexOf(el);
  if (held >= 0) dialogStack.splice(held, 1);
  dialogStack.push(el);
  el.setAttribute('role', role);
  if (label) el.setAttribute('aria-label', label);
  el.hidden = false;
  el.setAttribute('tabindex', '-1');
  syncModalLayers();
  el.focus?.();
}

function dropDialog(el) {
  const back = dialogReturnFocus.get(el);
  dialogReturnFocus.delete(el);
  const held = dialogStack.indexOf(el);
  if (held >= 0) dialogStack.splice(held, 1);
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.hidden = true;
  el.removeAttribute('aria-modal');
  el.removeAttribute('inert');
  el.removeAttribute('aria-hidden');
  syncModalLayers();
  if (back && document.contains(back) && !back.closest('[inert]')) back.focus?.();
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function focusables(el) {
  // offsetParent is null for anything position: fixed, which the closes and
  // the bars all are: measure the box instead, or the trap loses them
  return [...el.querySelectorAll(FOCUSABLE)]
    .filter(n => n.getClientRects().length > 0 || n === document.activeElement);
}

// whichever dialog is in front holds the focus: the surface stack, or a
// report or prompt raised beside it
function frontDialog() {
  // Standalone dialogs can open over one another: a share card can rise from
  // a report, and a copy fallback can ask over that card. DOM order and a
  // fixed priority cannot describe which act happened last, so follow the
  // same explicit stack the poster surfaces use.
  for (let i = dialogStack.length - 1; i >= 0; i -= 1) {
    const el = dialogStack[i];
    if (el && !el.hidden) return el;
  }
  // Defensive fallback for a restored document whose hidden state changed
  // outside raiseDialog; ordinary app paths are all represented above.
  for (const id of STANDALONE_DIALOGS) {
    const el = document.getElementById(id);
    if (el && !el.hidden) return el;
  }
  for (let i = surfaces.length - 1; i >= 0; i--) {
    if (!NON_MODAL.has(surfaces[i])) return surfaceEl(surfaces[i]);
  }
  return null;
}

// Several rooms deliberately stay open beneath the one reached from them, so
// closing `club` returns to `you`, and closing `you` returns to the index. A
// visual stack is not an accessibility stack: only its front room may call
// itself modal or remain reachable. Keep every visible layer beneath it inert
// and hidden from the accessibility tree, then restore the next one the moment
// the front closes.
function syncModalLayers() {
  const front = frontDialog();
  setBackgroundInert(!!front);
  const roots = [
    ...STANDALONE_DIALOGS.map(id => document.getElementById(id)),
    ...surfaces.map(surfaceEl),
  ];
  for (const el of new Set(roots.filter(Boolean))) {
    if (el.hidden || NON_MODAL.has(el.id)) continue;
    if (el === front) {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
      el.setAttribute('aria-modal', 'true');
    } else {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('aria-modal');
    }
  }
  if (!toastEl.hidden) dockToastWithDialog(front);
}

function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const el = frontDialog();
  if (!el) return;
  const items = focusables(el);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const atRoot = active === el;
  if (e.shiftKey && (atRoot || active === first || !el.contains(active))) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && (atRoot || !el.contains(active))) {
    const asked = document.getElementById(el.dataset.initialFocus || '');
    const entry = asked && el.contains(asked) ? asked : first;
    e.preventDefault(); entry.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault(); first.focus();
  }
}
document.addEventListener('keydown', trapFocus, true);

function openSurface(id, onShow) {
  leaveHero();
  if ((id === 'indexOverlay' && topSurface() === 'plate') ||
      (id === 'plate' && topSurface() === 'indexOverlay')) popSurface();
  if (surfaces.includes(id)) return;
  returnFocus.set(id, document.activeElement);
  surfaces.push(id);
  const el = surfaceEl(id);
  el.hidden = false;
  // Every poster carries the same z-index, so between two open posters the
  // painting order is the DOM order, and the DOM order is the order they
  // happen to be written in index.html: statsOverlay, then clubOverlay, then
  // settingsOverlay. Two of the three ways onward out of `you` are written
  // above it in that file, so `the whole story` and `the travellers club` each
  // opened *underneath* the poster you pressed them on. (`how this works`, the
  // third, joined them on 2026-08-19 and happens to be written below, so it
  // paints in front on file order alone. That is luck, not design, and the lift
  // set below is what actually holds all three.) The room was open, rendered,
  // focused and holding the keyboard, behind a sheet at 92 percent opacity
  // with a 20px blur, and the screen did not change. Measured in a browser:
  // elementFromPoint at the middle of the viewport answered #settingsOverlay
  // both times, and the club's `become a member` was under it at (64, 294).
  // The travellers club is the only door to the paid tier, so the paid tier
  // had no reachable door.
  //
  // A stacking order that follows the order surfaces were opened in is the
  // only one that can be right, because the order in the file is a fact about
  // the file and not about the evening. Set on the element rather than in the
  // stylesheet, which cannot know how deep the stack is.
  //
  // Posters only. The plate, the index and the command line carry 30, 40 and
  // 50: three deliberate numbers describing how those three sit against each
  // other and against a poster, and none of them collides with anything. The
  // ties are all inside the poster band, and so is the fix.
  if (el.classList.contains('poster')) el.style.zIndex = String(POSTER_Z + surfaces.length);

  const modal = !NON_MODAL.has(id);
  el.setAttribute('role', modal ? 'dialog' : 'complementary');
  if (!modal) el.removeAttribute('aria-modal');
  syncModalLayers();
  el.classList.add('opening');
  setTimeout(() => el.classList.remove('opening'), SURFACE_OPEN_MS);
  onShow?.();
  if (modal && id !== 'paletteOverlay' && frontDialog() === el) {
    el.setAttribute('tabindex', '-1');
    el.focus?.();
  }
}

function restoreFocus(id) {
  const back = returnFocus.get(id);
  returnFocus.delete(id);
  syncModalLayers();
  // The focus may not be left inside a surface that has just been hidden.
  //
  // It is unreachable there, and it is still what the page believes is
  // focused, so every shortcut afterwards is read as typing into a field
  // nobody can see. Press a command in the command line and then press slash
  // again: the bar swallows the very keystroke that opens it, because the
  // input it swallows it with is hidden behind the surface the person just
  // left. The same holds for a note on a plate closed with Escape, and the
  // plate is worse, because a plate hands nothing back on purpose.
  //
  // Restoring the focus did not settle this. `back` is usually the body,
  // and the body takes no focus unless something made it focusable, so
  // `back.focus()` is a call that quietly does nothing and leaves the stale
  // focus exactly where it was.
  const el = surfaceEl(id);
  if (el && el.contains(document.activeElement)) document.activeElement.blur();
  // the plate never stole the focus, so it never hands it back
  if (NON_MODAL.has(id)) return;
  if (back && document.contains(back)) back.focus();
}

function clearPlatePlaceSelection() {
  const selected = state.selectedId ? placeById(state.selectedId) : null;
  state.selectedId = null;
  state.foreign = null;
  state.proposal = null;
  mapView.clearPreview();
  // Closing a place changes one marker's selected ring, not the atlas. Keep
  // every route and every unrelated marker layer and DOM node alive instead
  // of rebuilding the whole field for that single visual change.
  if (selected) mapView.refreshMarkerIcon(selected, tagById, false);
  applyWorldState();
}

function popSurface() {
  // a surface closing is a moment ending: anything half written goes down now
  flushWrites();
  const id = surfaces[surfaces.length - 1];
  if (!id) return false;
  if (id === 'folioOverlay' && onFolioClosed) {
    onFolioClosed(() => popSurface());
    return true;
  }
  surfaces.pop();
  surfaceEl(id).hidden = true;
  surfaceEl(id).style.zIndex = '';   // the lift belongs to the visit, not to the room
  if (id === 'howOverlay') onHowClosed?.();
  if (id === 'clubOverlay') onClubClosed?.();
  if (id === 'plate') {
    clearPlatePlaceSelection();
    // A closed plate is emptied, not merely hidden.
    //
    // Hiding leaves the last place's name, address, note and distance sitting
    // in the document, which is a copy of a record nobody is looking at, kept
    // for no reason. It also makes the plate useless as evidence: a test that
    // presses a row and then counts what is on the plate is answered by the
    // plate before it if the press did nothing, and one of them was. Every
    // road to an open plate writes it first, so there is nothing here to keep.
    surfaceEl(id).innerHTML = '';
    delete surfaceEl(id).dataset.pid;
  }
  if (id === 'paletteOverlay') palette.remoteAbort?.abort();
  restoreFocus(id);
  return true;
}

function closeSurface(id, after = null) {
  flushWrites();
  const i = surfaces.indexOf(id);
  if (i === -1) return false;
  if (id === 'folioOverlay' && onFolioClosed) {
    onFolioClosed(() => closeSurface(id, after));
    return true;
  }
  surfaces.splice(i, 1);
  surfaceEl(id).hidden = true;
  surfaceEl(id).style.zIndex = '';
  if (id === 'howOverlay') onHowClosed?.();
  if (id === 'clubOverlay') onClubClosed?.();
  if (id === 'plate') clearPlatePlaceSelection();
  restoreFocus(id);
  after?.();
  return true;
}

function topSurface() { return surfaces[surfaces.length - 1]; }

// ---------- rendering: count, index ----------

function renderCount() {
  const n = allPlaces().length;
  const w = allRoutes().length;
  const k = allBooks().length;
  const total = n + w + k;
  $('#placeCount').textContent = total || '';
  $('#ixN').textContent = total;
  const small = $('.index-count small');
  if (small) small.textContent = total === 1 ? 'thing kept' : 'things kept';
  // The tally counts. It used to end with the byline, bare and uppercase with
  // nothing in front of it, which read as a word nobody could place: it sat
  // there unlabelled long enough that the person who wrote it had to ask what
  // it meant. Naming it ("kept by ada") only moved the problem, since the
  // words are wide enough at this letterspacing to wrap and orphan the name
  // on a narrow screen. The truth is it was never earning the room. This is
  // your index, showing your atlas; you know whose it is. A byline is for
  // what leaves, and it is on all of that already: the plate, the hand-over
  // panel, the printed sheet, and every link and file you give away.
  //
  // The spaces here are the kind that do not break, and there are two sorts of
  // them. A box keeps a wrap off the margin but it cannot keep `14` on one line
  // and `books` on the next, and a number parted from its noun is the same
  // fault at a smaller size. The separator is glued the other way, forward onto
  // the item it introduces, so the only place this can break is in front of a
  // dot: a line ending `1 path` and the next opening `· 14 books` reads as one
  // list continuing, where a line ending on its own dot reads as a mistake.
  const rest = [
    `${n}\u00a0place${n === 1 ? '' : 's'}`,
    `${w}\u00a0path${w === 1 ? '' : 's'}`,
    `${k}\u00a0book${k === 1 ? '' : 's'}`,
  ];
  const ways = $('#ixWays');
  if (ways) { ways.textContent = rest.join(' \u00b7\u00a0'); ways.hidden = false; }
  paintAtlasControls();
}

function recordsForKind(kind = state.filters.kind) {
  if (kind === 'place') return allPlaces();
  if (kind === 'path') return allRoutes();
  if (kind === 'book') return allBooks();
  return [...allPlaces(), ...allRoutes(), ...allBooks()];
}

// Places, paths, and books are three doors into one atlas. The stored states
// remain deliberately small; only the words change so each kind tells the
// truth in its own language.
function paintAtlasControls() {
  const kind = state.filters.kind;
  const kinds = $('#kindSeg');
  if (kinds && !kinds.children.length) {
    kinds.innerHTML = `
      <button data-kind="all" aria-pressed="true">all <sup id="kindAllN">0</sup></button>
      <button data-kind="place" aria-pressed="false">places <sup id="kindPlaceN">0</sup></button>
      <button data-kind="path" aria-pressed="false">paths <sup id="kindPathN">0</sup></button>
      <button data-kind="book" aria-pressed="false">books <sup id="kindBookN">0</sup></button>`;
  }
  const counts = {
    place: allPlaces().length,
    path: allRoutes().length,
    book: allBooks().length,
  };
  counts.all = counts.place + counts.path + counts.book;
  for (const [word, n] of Object.entries(counts)) {
    const el = $(`#kind${word[0].toUpperCase()}${word.slice(1)}N`);
    if (el) el.textContent = n;
  }
  $$('#kindSeg [data-kind]').forEach(button => button.setAttribute(
    'aria-pressed', String(button.dataset.kind === kind),
  ));

  const labels = kind === 'place'
    ? ['all', stateLabel('place', 'visited'), stateLabel('place', 'wishlist')]
    : kind === 'path'
      ? ['all', stateLabel('path', 'visited'), stateLabel('path', 'wishlist')]
      : kind === 'book'
        ? ['all', stateLabel('book', 'visited'), stateLabel('book', 'wishlist')]
        : ['all states', 'experienced', 'want'];
  const [all, done, want] = [$('#statusAll'), $('#statusDone'), $('#statusWant')];
  if (all) all.textContent = labels[0];
  if (done) done.textContent = labels[1];
  if (want) want.textContent = labels[2];
  const sort = $('#sortWord');
  if (sort) sort.hidden = kind !== 'all' && kind !== 'place';
  const list = $('#listView');
  if (list) list.setAttribute('aria-label', kind === 'all'
    ? 'Things in your atlas'
    : `${kind === 'path' ? 'Paths' : `${kind[0].toUpperCase()}${kind.slice(1)}s`} in your atlas`);
}

// The index is for finding a place again. It opened with three rows of
// controls above the first record: every tag you own, wrapped over three
// lines, and four ways to sort, and the field's colour and the time of day.
// On a phone the records began below the fold. The controls a person changes
// once a month are behind a word now; the words they change often are not,
// and any tag actually filtering stays in sight so nothing is hidden while
// it is doing something.
function renderChips() {
  const wrap = $('#filterChips');
  const on = state.filters.tags.size;
  const word = $('#filterWord');
  if (word) {
    word.textContent = on ? `tags · ${on}` : 'tags';
    word.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const records = recordsForKind();
  wrap.innerHTML = allTags().map(t => {
    const n = records.reduce((count, record) => count + (record.tags.includes(t.id) ? 1 : 0), 0);
    const on = state.filters.tags.has(t.id);
    const h = Number(t.hue);
    return `<button data-tag="${esc(t.id)}" aria-pressed="${on}"${Number.isFinite(h) ? ` style="--mk-hue:${h}"` : ''}>${esc(t.name)}<sup>${n}</sup></button>`;
  }).join('') + `<button class="edit-tags" id="editTags">edit</button>`;
  $('#editTags').addEventListener('click', () => {
    closeSurface('indexOverlay');
    openSurface('tagsOverlay', renderTags);
  });
  $$('[data-tag]', wrap).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.tag;
    state.filters.tags.has(id) ? state.filters.tags.delete(id) : state.filters.tags.add(id);
    renderChips(); renderList(); syncMarkers(); applyWorldState();
  }));
  // a tag that is filtering stays visible whether the row is open or not:
  // a filter nobody can see is a list that looks wrong for no reason
  wrap.hidden = !wrap.dataset.open && !state.filters.tags.size;
}

// a word that shows the row it names, and says so to a screen reader
function revealRow(wordId, rowId) {
  const word = $(wordId);
  const row = $(rowId);
  if (!word || !row) return;
  word.addEventListener('click', () => {
    const open = row.dataset.open === '1';
    if (open) { delete row.dataset.open; } else { row.dataset.open = '1'; }
    row.hidden = open && !(rowId === '#filterChips' && state.filters.tags.size);
    word.setAttribute('aria-expanded', String(!open));
  });
}

// The cities of the last drawing, kept where the one listener on the list can
// reach them. The listener outlives every render, so it cannot close over a
// grouping that a later render has replaced.
let listCities = null;

// A list does not rewrite itself under a finger.
//
// Every drawing replaces every row, and a press that began before one and
// ended after it is delivered nowhere at all: the node it started on has been
// thrown away, and there is nothing left for the browser to fire a click at.
// Moving the listener up to the list does not save it either, which was worth
// finding out. So nothing happens, and on a phone a tap that does nothing
// cannot be told from a tap the screen never felt: the second one is harder,
// and the third is a complaint.
//
// The rewrites that do this are not rare. A fix arriving reorders the list,
// and so does the map settling three hundred milliseconds after it flew
// somewhere, which is the ordinary state of the screen right after a place
// was opened. So the drawing waits for the finger to come up and goes ahead
// then, a frame later than it wanted and with every row still where the hand
// left it.
let listPressed = false;
let listOwed = false;

// The gathering has to arrive where the eye already is.
//
// A press on a city ended with `$('#listView').scrollTop = 0`, and #listView is
// not a scroll container: the poster is the scroller. So the line went nowhere.
// Deep in a long atlas that meant every visible row was silently replaced by
// places from somewhere else, while the sentence saying what had happened, and
// the word that undoes it, sat thousands of pixels above the fold. The idiom
// promises that what was pressed comes to the top; this is the part that shows
// it.
//
// The stop is under the tools rather than at the top of the poster, because the
// tools are sticky and would otherwise cover the one line we scrolled to. A bar
// already standing in view is left alone: pressing a word while at the top of
// the index should not scroll the count out of the way to prove it worked.
function bringGatheringIntoView() {
  const sc = $('#indexOverlay');
  const wrap = $('#listView');
  if (!sc || !wrap) return;
  // nothing gathered means it was just let go of: the top of the list answers
  const mark = wrap.querySelector('.ix-gathered') || wrap;
  const tools = sc.querySelector('.index-tools');
  const stop = tools ? tools.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
  const top = mark.getBoundingClientRect().top;
  if (top >= stop && top <= sc.getBoundingClientRect().bottom) return;
  sc.scrollTop += top - stop;
}

function renderList({ force = false } = {}) {
  const wrap = $('#listView');
  // Most atlas changes happen while the board is closed. Do not build a hidden
  // copy after every edit; the next actual opening always draws the live store.
  if ($('#indexOverlay')?.hidden && !force) {
    return;
  }
  if (listPressed) { listOwed = true; return; }
  const places = filteredPlaces();
  const ways = filteredRoutes();
  const shelf = filteredBooks();
  const atlasSize = allPlaces().length + allRoutes().length + allBooks().length;
  const kindEmpty = state.filters.kind !== 'all'
    && recordsForKind().length === 0
    && state.filters.status === 'all'
    && !state.filters.tags.size;
  // an arrangement answered only by ways is not nothing
  if (!places.length && !ways.length && !shelf.length) {
    wrap.innerHTML = atlasSize === 0
      ? `<div class="ix-empty"><div class="ix-empty-law">Your atlas is ready for its first thing.</div>
          <p><button class="word-btn" id="emptyAdd">Keep a place, path, or book</button>, or
          <button class="word-btn quiet" id="emptyDemo">explore an example without adding it</button>.</p>
        </div>`
      : kindEmpty
        ? `<div class="ix-empty"><div class="ix-empty-law">No ${state.filters.kind === 'path' ? 'paths' : `${state.filters.kind}s`} here yet.</div>
            <p><button class="word-btn" id="emptyKind">Keep a ${state.filters.kind}</button>.</p>
          </div>`
      : `<div class="ix-empty"><div class="ix-empty-law">nothing answers this arrangement.</div>
          <p><button class="word-btn quiet" id="emptyClear">clear the filters</button></p>
        </div>`;
    $('#emptyDemo')?.addEventListener('click', () => {
      closeSurface('indexOverlay');
      previewDemo();
    });
    $('#emptyAdd')?.addEventListener('click', () => {
      closeSurface('indexOverlay');
      openKeepChooser();
    });
    $('#emptyKind')?.addEventListener('click', () => {
      const kind = state.filters.kind;
      closeSurface('indexOverlay');
      if (kind === 'book') addBookByHand();
      else if (kind === 'path') $('#gpxFile').click();
      else openKeepChooser();
    });
    $('#emptyClear')?.addEventListener('click', clearFilters);
    return;
  }
  const nos = accessionMap();
  const center = measuringFrom();
  // The metadata leaves the button.
  //
  // A city that can be pressed has to be something a keyboard can reach, and a
  // button inside a button is neither valid nor agreed upon by any two engines.
  // So the row became a container: the name is the button that opens the place,
  // and each word under it is its own small button that gathers its own kind.
  // The border and the spacing moved to the container, so the row looks exactly
  // as it did.
  const gathering = (kind, value) => !!(state.gather
    && state.gather.kind === kind
    && oneSpelling(state.gather.value) === oneSpelling(value));
  const word = (kind, value, shown) => `<button class="ix-g" data-gk="${esc(kind)}"
    data-gv="${esc(value)}" aria-pressed="${gathering(kind, value)}">${esc(shown)}</button>`;
  const row = (p) => {
    const datum = fmtDistance(haversineKm(center, p));
    const prov = p.provenance ? `<span class="prov">after ${nameDoor(p.provenance.name)}</span>` : '';
    return `<div class="ix-row">
      <button class="ix ${p.status === 'wishlist' ? 'wish' : ''} ${p.id === state.selectedId ? 'selected' : ''}"
        data-id="${esc(p.id)}">
        <span class="ix-l1">
          <span class="ix-no">${fmtNo(nos.get(p.id))}</span>
          <span class="ix-name">${esc(p.name)}</span>
          <span class="ix-datum">${datum}</span>
        </span>
      </button>
      <div class="ix-meta">
        ${p.city ? word('city', p.city, p.city) : ''}
        ${p.country ? word('country', p.country, p.country) : ''}
        ${p.tags.map(id => tagById(id)).filter(Boolean)
          .map(t => word('tag', t.id, t.name)).join('')}
        ${p.status === 'wishlist' ? '<span>want to go</span>' : ''}
        ${p.thanks?.length ? `<button class="ix-thanks" data-thanks="${esc(p.id)}"
          aria-expanded="false" title="who thanked you for this">\u2665 ${p.thanks.length}</button>` : ''}
        ${prov}
      </div>
      ${p.thanks?.length ? `<div class="ix-roll" hidden>${thanksRoll(p.thanks)}</div>` : ''}
    </div>`;
  };

  // ---------- arranged by city, a city is something you can hold ----------
  //
  // The city arrangement already put the cities in order and gathered the
  // placeless at the end. All it lacked was a line saying where one city ended
  // and the next began, and a word on that line.
  //
  // The word composes from what is on the screen, filters and all, which is
  // the only thing the app could not express before: my Lisbon places tagged
  // food that I still want to go to is a folio now, and it was three separate
  // thoughts with no way to join them.
  //
  // The placeless band is a heading and nothing more. A folio needs a title,
  // and off the map is not a city anyone asked for.
  const byCity = state.sort === 'city' ? [...groupByCity(places).entries()] : null;
  if (byCity) {
    wrap.innerHTML = byCity.map(([label, list], gi) => `
      <div class="ix-band mono"><span>${esc(label.toLowerCase())}</span>${label === PLACELESS ? ''
        : `<button class="ix-fol" data-cg="${gi}">create a collection</button>`}</div>
      ${list.map(row).join('')}`).join('');
  } else {
    wrap.innerHTML = places.map(row).join('');
  }
  if (places.length && state.filters.kind === 'all') {
    wrap.insertAdjacentHTML('afterbegin', `<div class="ix-band mono">places · ${places.length}</div>`);
  }
  // A gathering says so, and says how to stop. Otherwise a person who pressed a
  // word once meets an atlas in an order they did not choose and cannot undo.
  if (state.gather) {
    const g = state.gather;
    const said = g.kind === 'tag' ? (tagById(g.value)?.name || g.value) : g.value;
    wrap.insertAdjacentHTML('afterbegin',
      `<div class="ix-gathered mono"><span>${esc(said.toLowerCase())} first</span>`
      + '<button id="ixLetGo">let go</button></div>');
    $('#ixLetGo').addEventListener('click', () => {
      state.gather = null;
      renderList();
      bringGatheringIntoView();
    });
  }

  // ways stand after the marks: same list, plainly told apart
  if (ways.length) {
    const heading = state.filters.kind === 'all' ? `<div class="ix-band mono">paths · ${ways.length}</div>` : '';
    wrap.insertAdjacentHTML('beforeend', heading + ways.map((r, i) => {
      // The same word does the same thing wherever it stands.
      //
      // A path's city, country and tag were spans, and the identical words on a
      // place row one band above were buttons that gather. Nothing on the screen
      // told them apart, so a person who had learnt what a small word does
      // pressed one here and got nothing back. They gather now, which is why the
      // row had to become a container: these are buttons, and a button inside a
      // button is neither valid nor agreed on by any two engines.
      //
      // The locale was one joined string and is two words, because a city and a
      // country are two things to gather.
      return `<div class="ix-row">
        <button class="ix way ${r.status === 'wishlist' ? 'wish' : ''} ${r.id === state.selectedRouteId ? 'selected' : ''}"
          data-rid="${esc(r.id)}" style="--i:${i}">
          <span class="ix-l1">
            <span class="ix-no">${r.loop ? '◯' : '⟋'}</span>
            <span class="ix-name">${esc(r.name)}</span>
            <span class="ix-datum">${esc(fmtKm(r.km))}</span>
          </span>
        </button>
        <div class="ix-meta">
          ${r.city ? word('city', r.city, r.city) : ''}
          ${r.country ? word('country', r.country, r.country) : ''}
          ${r.tags.map(id => tagById(id)).filter(Boolean)
            .map(t => word('tag', t.id, t.name)).join('')}
          ${Number.isFinite(r.ascent) ? `<span>${r.ascent} m up</span>` : ''}
          <span>${esc(fmtHours(r.hours))}</span>
          ${r.status === 'wishlist' ? '<span>want to walk</span>' : ''}
        </div>
      </div>`;
    }).join(''));
  }

  // books stand last, because they are the one kind that is not on the field.
  // A row that cannot be pressed to fly anywhere sits after every row that can.
  if (shelf.length) {
    const heading = state.filters.kind === 'all' ? `<div class="ix-band mono">books \u00b7 ${shelf.length}</div>` : '';
    wrap.insertAdjacentHTML('beforeend', heading
      + shelf.map((b) => {
        // The title is a door now, like every other name in this index. The
        // row used to be type on the argument that a book has nothing to fly
        // to, and the argument confused flying with opening: it left books
        // the one kind in the atlas with no plate, no way to be corrected,
        // marked read, untied or removed, and updateBook sat in the store
        // with no caller. The note moved onto the plate with the rest of the
        // record; the place and the tags keep their own small doors here.
        const at = b.placeId ? placeById(b.placeId) : null;
        const prov = b.provenance ? `<span class="prov">after ${nameDoor(b.provenance.name)}</span>` : '';
        return `<div class="ix-row book ${b.status === 'wishlist' ? 'wish' : ''}">
          <button class="ix" data-bid="${esc(b.id)}">
            <span class="ix-l1">
              <span class="ix-no">\u00b6</span>
              <span class="ix-name">${esc(b.title)}</span>
              <span class="ix-datum">${esc(b.year)}</span>
            </span>
          </button>
          <div class="ix-meta">
            ${b.author ? `<span>${esc(b.author)}</span>` : ''}
            ${at ? `<button class="ix-at" data-bat="${esc(at.id)}">${esc(at.name)}</button>` : ''}
            ${b.tags.map(id => tagById(id)).filter(Boolean)
              .map(t => word('tag', t.id, t.name)).join('')}
            ${b.status === 'wishlist' ? '<span>want to read</span>' : ''}
            ${prov}
          </div>
        </div>`;
      }).join(''));
  }

  // Pressing a word gathers its kind. Pressing the one already gathered lets go,
  // because a control that only ever does one thing is a door with no handle on
  // the inside.
  listCities = byCity;

  // One listener on the list, and none on the rows: rows are replaced on every
  // drawing, and a listener that has to be put back each time is a listener
  // that can be missing. It is attached once, because `renderList` runs on
  // every change and one added per drawing would answer a single press as
  // many times as the list had ever been drawn.
  if (!wrap.dataset.rowsBound) {
    wrap.dataset.rowsBound = '1';
    wrap.addEventListener('pointerdown', () => { listPressed = true; });
    // on the window, because a finger may well come up somewhere else, and a
    // press that ended off the list still ended. The drawing owed is taken a
    // task later, so that it lands after the click and not between the two.
    const letGo = () => {
      if (!listPressed) return;
      listPressed = false;
      if (!listOwed) return;
      listOwed = false;
      setTimeout(renderList, 0);
    };
    addEventListener('pointerup', letGo);
    addEventListener('pointercancel', letGo);

    wrap.addEventListener('click', (e) => {
      // Pressing a word gathers its kind. Pressing the one already gathered
      // lets go, because a control that only ever does one thing is a door
      // with no handle on the inside.
      const g = e.target.closest('.ix-g');
      if (g) {
        const kind = g.dataset.gk;
        const value = g.dataset.gv;
        const already = state.gather
          && state.gather.kind === kind
          && oneSpelling(state.gather.value) === oneSpelling(value);
        state.gather = already ? null : { kind, value };
        renderList();
        bringGatheringIntoView();
        return;
      }

      // the place a book was read at, pressed: the same act as pressing the
      // place itself, from a row that is not the place
      const at = e.target.closest('.ix-at');
      if (at) {
        closeSurface('indexOverlay');
        selectPlace(at.dataset.bat, { fly: true });
        return;
      }
      const fol = e.target.closest('.ix-fol');
      if (fol) {
        const [label, list] = listCities?.[Number(fol.dataset.cg)] || [];
        if (!label) return;
        closeSurface('indexOverlay');
        composeForCity(label, list, { whole: false });
        return;
      }

      // A count is not an answer. Somebody went where you sent them and came
      // back to say so, and the one thing worth knowing is who: the heart
      // opens onto the names and the days they arrived, and closes again on
      // the same press.
      const th = e.target.closest('[data-thanks]');
      if (th) {
        const roll = th.closest('.ix-row')?.querySelector('.ix-roll');
        if (!roll) return;
        roll.hidden = !roll.hidden;
        th.setAttribute('aria-expanded', String(!roll.hidden));
        return;
      }

      const b = e.target.closest('.ix');
      if (!b) return;
      closeSurface('indexOverlay');
      if (b.dataset.rid) selectRoute(b.dataset.rid, { fly: true });
      else if (b.dataset.bid) selectBook(b.dataset.bid);
      else selectPlace(b.dataset.id, { fly: true });
    });
  }

  // the name on a row, and every name in a roll behind a heart
  bindNameDoors(wrap);
}

function syncMarkers() {
  mapView.renderMarkers(filteredPlaces(), tagById, state.selectedId);
  mapView.renderRoutes(filteredRoutes(), tagById, state.selectedRouteId);
}

// ways obey the same filters the marks do
function allRoutes() { return store.routes; }
function allBooks() { return store.books; }
function routeById(id) { return allRoutes().find(r => r.id === id); }

function filteredRoutes() {
  if (!['all', 'path'].includes(state.filters.kind)) return [];
  return allRoutes().filter(r => {
    if (state.filters.status !== 'all' && recordState(r, 'path') !== state.filters.status) return false;
    if (state.filters.tags.size && !r.tags.some(t => state.filters.tags.has(t))) return false;
    return true;
  });
}

// The shelf, held to the same two filters as everything else.
//
// A book has no distance and no city of its own, so it does not answer the
// arrangement words: sorting an atlas by what is nearest cannot put a novel
// anywhere, and pretending otherwise would mean inventing a coordinate for it.
// Alphabetical by title is the one order a shelf has always had.
//
// `visited` reads as read here. The word a person sees changes; the word the
// filters read does not, which is why the status segment keeps working across
// three kinds of record without knowing there are three.
function filteredBooks() {
  if (!['all', 'book'].includes(state.filters.kind)) return [];
  return store.books.filter(b => {
    if (state.filters.status !== 'all' && recordState(b, 'book') !== state.filters.status) return false;
    if (state.filters.tags.size && !b.tags.some(t => state.filters.tags.has(t))) return false;
    return true;
  }).sort((a, b) => a.title.localeCompare(b.title));
}

function renderAll() {
  renderCount();
  renderChips();
  renderList();
  syncMarkers();
}

function openIndex() {
  paintAtlasControls();
  renderList({ force: true });
  paintSort();
  openSurface('indexOverlay');
  if (!store.settings.indexSeen) {
    store.settings.indexSeen = true;
    store.saveSettings();
    $('#fmHint').hidden = true;
  }
}

function clearFilters() {
  state.filters.tags.clear();
  state.filters.status = 'all';
  state.filters.kind = 'all';
  state.gather = null;
  $$('#statusSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === 'all')));
  paintAtlasControls();
  renderChips(); renderList(); syncMarkers(); applyWorldState();
}

// ---------- selection & the plate ----------

function selectPlace(id, { fly = false, edit = false, quiet = false } = {}) {
  const prev = state.selectedId;
  state.selectedId = id;
  state.foreign = null;
  const place = placeById(id);
  if (!place) return;
  if (prev && placeById(prev)) mapView.refreshMarkerIcon(placeById(prev), tagById, false);
  mapView.refreshMarkerIcon(place, tagById, true);
  // quiet: mark it on the field, but raise no plate behind whatever stands in front
  if (quiet) return;
  applyWorldState();
  mapView.rippleWhenSettled(place.lat, place.lng);
  if (fly) mapView.flyToPlace(place);
  renderPlate(place, { edit });
  openSurface('plate');
}

// The line under the name of a place: where it is, in as few words as say it.
//
// This was `[address, city, country].filter(Boolean).slice(0, 2)`, and a
// geocoder's address usually ends in the town, so the most-read line in the
// app said `Baselstrasse 101, 4125 Riehen · Riehen`. It was not a rare shape
// either: the same doubling landed on the Fondation Beyeler, and any record
// whose street line carries a postal town does it. The city is dropped when
// the address already names it, and the country moves up into the space,
// which is the fact a reader did not already have.
//
// A plain lowercase containment, because the two strings come from one
// geocoder and match exactly when they match at all; anything cleverer would
// be guessing at a language this does not know it is reading.
// How far this place is from where you are standing, and nothing at all if
// nobody has been asked.
//
// It is deliberately not the distance from the middle of the field. The index
// prints that one, because a list has to be ordered by something and the view
// is what the app knows for free. A plate is a single place being looked at,
// and "two kilometres" on it will be read as two kilometres from the reader.
// So it says nothing rather than saying it from a point the reader is not at.
function farFromYou(place) {
  const from = hereNow();
  if (!from) return '';
  return ` <span class="plate-far">· ${esc(fmtDistance(haversineKm(from, place)))} from you</span>`;
}

function placeSub(place) {
  const addr = place.address || '';
  const town = (place.city || '').trim();
  const said = town && addr.toLowerCase().includes(town.toLowerCase());
  return [addr, said ? '' : town, place.country].filter(Boolean).slice(0, 2).join(' · ');
}

function renderPlate(place, { edit = false, foreign = null } = {}) {
  const wrap = $('#plate');
  wrap.setAttribute('aria-label', foreign ? 'Shared place' : 'Place');
  // re-rendering the same card must not throw the reader back to the top
  const sameRecord = wrap.dataset.pid === place.id;
  const keepScroll = sameRecord ? wrap.scrollTop : 0;
  const tagsWereOpen = sameRecord && !!wrap.querySelector('.plate-tags')?.open;
  wrap.dataset.pid = place.id;
  const ro = !!foreign;
  const no = ro ? null : accessionMap().get(place.id);
  const wornTags = place.tags.map(id => tagById(id)?.name).filter(Boolean);
  const tagWords = allTags().map(t => `
    <button data-dtag="${esc(t.id)}" aria-pressed="${place.tags.includes(t.id)}" ${ro ? 'disabled' : ''}>${esc(t.name)}</button>`).join('');

  // What was read here. Absent when there is nothing, because a section head
  // over an empty space is the app telling somebody they are missing
  // something. A foreign plate never shows one: no book travels in a handover
  // yet, so a shelf on a stranger's place could only be your own books
  // appearing under their name.
  const shelf = ro ? [] : store.booksForPlace(place.id);
  const shelfHtml = shelf.length ? `
      <div class="plate-sec">
        <div class="plate-sec-head"><span>read here</span></div>
        ${shelf.map(b => `<button class="shelf-row" data-bopen="${esc(b.id)}">
          <span class="shelf-l1"><span class="shelf-t">${esc(b.title)}</span><span class="shelf-y">${esc(b.year)}</span></span>
          ${b.author ? `<span class="shelf-a">${esc(b.author)}</span>` : ''}
          ${b.note ? `<span class="shelf-n">${esc(b.note)}</span>` : ''}
        </button>`).join('')}
      </div>` : '';

  wrap.innerHTML = `
    <div class="plate-eyebrow">
      <span>${ro ? `from ${esc(foreign.name)}’s atlas` : `№ ${fmtNo(no)}`}</span>
      <button id="pCoords" title="Copy coordinates" aria-label="Copy coordinates: ${esc(fmtDMS(place.lat, place.lng))}">${fmtDMS(place.lat, place.lng)}</button>
      <button id="pClose">close</button>
    </div>
    <h1 class="plate-name" id="pName" ${ro ? '' : 'contenteditable="plaintext-only" spellcheck="false" role="textbox" aria-label="The name of this place"'}>${esc(place.name)}</h1>
    <div class="plate-sub">${esc(placeSub(place))}${farFromYou(place)}</div>
    ${place.provenance ? `<div class="plate-prov prov">after ${nameDoor(place.provenance.name)}${place.provenance.chain?.length ? `, who had it from ${place.provenance.chain.map(h => esc(h.name)).reverse().join(', who had it from ')}` : ''} ${fmtDate(place.provenance.adoptedAt) ? `· saved ${fmtDate(place.provenance.adoptedAt)}` : ''}${place.provenance.name && !ro && mayLeave(place) ? ` · <button class="prov-do" id="pThank">send thanks</button>` : ''}</div>
    <div class="plate-acts road-row" id="pThankRow" hidden></div>` : ''}
    ${place.thanks?.length && !ro ? `<button class="plate-prov plate-thanks" id="pThanks" aria-expanded="false">\u2665 ${thanksSentence(place.thanks)}</button>
    <div class="ix-roll plate-roll" id="pRoll" hidden>${thanksRoll(place.thanks)}</div>` : ''}
    ${place.private && !ro ? '<div class="plate-prov held-back">Excluded from sharing</div>' : ''}

    ${ro ? `
      <div class="plate-words"><button aria-pressed="true" disabled>${esc(datumWord(place))}</button></div>
      ${place.note ? `<div class="plate-sec"><div class="plate-sec-head"><span>their note</span></div><p class="note-input" style="border-left-color:var(--counter)">${esc(place.note)}</p></div>` : ''}
      <div class="plate-acts">
        <button class="word-btn" id="pAdopt">save to my atlas</button>
        <button class="word-btn quiet" id="pDirections">directions ↗</button>
      </div>`
    : `
      <div class="plate-words" id="pStatus">
        <button data-st="visited" aria-pressed="${place.status === 'visited'}">been</button>
        <button data-st="wishlist" aria-pressed="${place.status === 'wishlist'}">want to go</button>
      </div>

      <div class="plate-acts plate-primary">
        <button class="word-btn" id="pDirections">directions ↗</button>
        ${mayLeave(place) ? '<button class="word-btn quiet" id="pHand">share</button>' : ''}
        <button class="word-btn quiet" id="pFolio">add to collection</button>
        ${safeUrl(place.url) ? `<a class="word-btn quiet" href="${esc(place.url)}" target="_blank" rel="noopener">website ↗</a>` : ''}
      </div>
      <div class="plate-acts road-row" id="pHandRow" hidden></div>

      <details class="plate-tags plate-sec"${tagsWereOpen ? ' open' : ''}>
        <summary><span>tags</span><span class="plate-tag-current">${esc(wornTags.join(' · ') || 'none')}</span><span class="plate-tag-edit" aria-hidden="true"></span></summary>
        <div class="plate-words" id="pTags">${tagWords}<button id="pNewTag">＋ new</button></div>
      </details>

      <div class="plate-sec">
        <div class="plate-sec-head"><span>notes</span></div>
        <textarea class="note-input" id="pNote" aria-label="Your note on this place" placeholder="What makes it worth remembering…">${esc(place.note)}</textarea>
      </div>

      <div class="plate-sec">
        <div class="plate-sec-head"><span>website</span></div>
        <input class="text-input" id="pUrl" type="url" inputmode="url" autocomplete="url" autocapitalize="off" aria-label="Website for this place" placeholder="https://…" value="${esc(place.url)}">
      </div>
      ${shelfHtml}

      <div class="plate-acts plate-secondary">
        <button class="word-btn quiet" id="pPlacePrivate">${place.private ? 'Include in sharing' : 'Exclude from sharing'}</button>
        <button class="word-btn quiet" id="pDelete">remove</button>
      </div>
      ${fmtDate(place.createdAt) ? `<div class="plate-foot">entered ${fmtDate(place.createdAt)}</div>` : ''}`}
  `;

  $('#pClose').addEventListener('click', () => closeSurface('plate'));
  $('#pCoords').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${place.lat}, ${place.lng}`); toast('coordinates copied'); }
    catch { toast('could not copy'); }
  });
  $('#pFolio')?.addEventListener('click', () => fileIntoFolio(place.id));
  $('#pPlacePrivate')?.addEventListener('click', () => {
    const now = !place.private;
    if (save({ private: now })) {
      toast(now ? SHARING_EXCLUSION_COPY : 'Included in sharing.');
      renderPlate(placeById(place.id));
    }
  });
  // a shelf row is the book's own door: the record, opened where it was read
  $$('[data-bopen]', wrap).forEach(b => b.addEventListener('click', () => selectBook(b.dataset.bopen)));
  // gratitude goes back the way the place came: a small link, handed through
  // whatever the device sends with. pid is the id this record wore in the
  // sender's atlas, kept at adoption; a heart with no pid still lands by
  // name and point.
  //
  // The road it takes is asked for rather than assumed. This plate knows a
  // byline and not a key, so the row of people stands under the word the same
  // way it stands under `hand it to`, and `a link` is still there for a person
  // who was thanked by somebody they have never introduced themselves to.
  const thanksFor = () => {
    const current = currentShareablePlace(place);
    if (!current) return null;
    return {
      // The word only renders when the record names who it came from, so the
      // addressee is known here and is said at all three places a person looks.
      to: String(current.provenance?.name || '').trim(),
      pid: current.provenance?.srcId || '',
      name: current.name,
      at: { lat: current.lat, lng: current.lng },
      recordId: current.id,
    };
  };
  $('#pThank')?.addEventListener('click', () => {
    const thanks = thanksFor();
    if (!thanks) return;
    roadsUnder($('#pThankRow'), {
      onPerson: (pair, b) => sendThanks(thanks, { pair, button: b }),
      onLink: () => sendThanks(thanks),
    });
  });
  // A name printed on this plate is a door to the person, and the road that
  // name stands on is the way to thank them. The word used to stand in the act
  // row, sixteenth of a column a reader scrolls to reach; it stands on the
  // provenance line now, where the sender is already named and where the line
  // under it has always been pressable.
  bindNameDoors(wrap);
  // the same door the index heart opens: the names, and the days they came
  $('#pThanks')?.addEventListener('click', () => {
    const roll = $('#pRoll');
    if (!roll) return;
    roll.hidden = !roll.hidden;
    $('#pThanks').setAttribute('aria-expanded', String(!roll.hidden));
  });
  $('#pDirections')?.addEventListener('click', () => {
    window.open(directionsURL(place.lat, place.lng, place.name), '_blank', 'noopener');
  });

  // One word, and what it does depends on who you have rather than on which
  // word you pressed. With nobody verified there is nothing to choose between,
  // so it hands over a link and asks nothing. With people, the names appear
  // under it beside the word `a link`, and one press sends.
  $('#pHand')?.addEventListener('click', () => roadsUnder($('#pHandRow'), {
    onPerson: (p, b) => sendPlaceTo(place, p, b),
    onLink: () => handPlaceOver(place),
  }));

  if (ro) {
    $('#pAdopt').addEventListener('click', () => {
      const c = store.correspondents.find(x => x.id === foreign.corrId) ||
        (state.visiting && state.visiting.id === foreign.corrId ? state.visiting : null);
      adoptPlace(place, foreign, c?.tags);
    });
    return;
  }

  // the store decides whether an edit happened; the view only reports it.
  // a write the device refused must never look like a write that succeeded.
  const save = (patch) => {
    const saved = store.updatePlace(place.id, { ...patch, sample: false });
    if (!saved) { renderPlate(placeById(place.id) || place, { edit: true }); return false; }
    mapView.refreshMarkerIcon(saved, tagById, true);
    renderCount(); renderChips();
    return true;
  };

  if (keepScroll) wrap.scrollTop = keepScroll;

  const nameEl = $('#pName');
  nameEl.addEventListener('blur', () => {
    const v = nameEl.textContent.trim();
    if (v && v !== place.name) save({ name: v });
    else nameEl.textContent = place.name;
  });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });

  $('#pStatus').addEventListener('click', (e) => {
    const st = e.target.closest('[data-st]');
    if (!st) return;
    save({ status: st.dataset.st });
    renderPlate(placeById(place.id)); renderList(); syncMarkers();
  });

  // `keep it off every link` stood here, fifth in a row of five, and it is gone
  // from the place plate by decision of 2026-08-16. The flag it set is not: a
  // record that carries `private` is still held out of every link, folio, file,
  // print and publish by `mayLeave` in the store, still says so on its plate,
  // and is still counted by name in the folio composer and at every handover.
  // The word survives on a path, where the plate has the room for it. What a
  // place loses is the way back: one already held back stays held back short of
  // editing the exported archive by hand and restoring it, and that cost was
  // named before the choice was made rather than discovered after.


  $('#pTags').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-dtag]');
    if (chip) {
      const id = chip.dataset.dtag;
      const tags = place.tags.includes(id) ? place.tags.filter(t => t !== id) : [...place.tags, id];
      save({ tags });
      applyWorldState();
      renderPlate(place); renderList(); syncMarkers();
      return;
    }
    if (e.target.closest('#pNewTag')) {
      const input = document.createElement('input');
      input.className = 'text-input';
      input.style.maxWidth = '140px';
      input.placeholder = 'tag name ↵';
      e.target.replaceWith(input);
      input.focus();
      const done = () => {
        const name = input.value.trim();
        if (name) {
          const station = TAG_STATIONS[store.tags.length % TAG_STATIONS.length];
          const tag = store.addTag(newTag({ name, hue: station.hue, color: station.hex }));
          if (tag) {
            save({ tags: [...place.tags, tag.id] });
            applyWorldState();
          }
        }
        renderPlate(place); renderChips(); renderList(); syncMarkers();
      };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(); if (ev.key === 'Escape') renderPlate(place); });
      input.addEventListener('blur', done);
    }
  });

  fitNoteInput($('#pNote'));
  writesLater($('#pNote'), `note:${place.id}`, (v) => save({ note: v }));
  $('#pUrl').addEventListener('change', (e) => { save({ url: asUrl(e.target.value) }); renderPlate(place); });

  $('#pDelete').addEventListener('click', async () => {
    const inFolios = store.folios.filter(f => f.placeIds.includes(place.id));
    const readHere = store.booksForPlace(place.id);
    const warn = inFolios.length
      ? ` ${inFolios.length === 1 ? 'One collection includes it and' : `${inFolios.length} collections include it and`} will stop showing it.`
      : '';
    // The question named the folios and said nothing about the shelf. A folio
    // forgets the place and keeps its own shape; a book read here is cut loose
    // from where it was read, which is the heavier of the two and the one the
    // person cannot see coming.
    const shelfWarn = readHere.length
      ? readHere.length === 1
        ? ' One book was read here and will lose its place.'
        : ` ${readHere.length} books were read here and will lose theirs.`
      : '';
    if (!await ask(`Remove “${place.name}” from your atlas?${warn}${shelfWarn} A link already sent keeps its copy.`, { yes: 'remove it', no: 'keep it', danger: true })) return;
    // The undo has to carry back everything the removal took. It kept the place
    // and its folio memberships and forgot the books, so `take it back` handed
    // back a place with an empty shelf while the toast said it was back where
    // it was. The ids are enough: removePlace clears the pointer and nothing
    // else, so the books themselves never left.
    const kept = { place: { ...place }, folioIds: inFolios.map(f => f.id), bookIds: readHere.map(b => b.id) };
    store.removePlace(place.id);
    closeSurface('plate');
    renderAll();
    toast('removed.', 9000, { word: 'take it back', run: () => {
      const back = store.addPlace(kept.place);
      if (!back) return toast('this browser refused to take it back');
      kept.folioIds.forEach(id => {
        const f = store.folioById(id);
        if (f && !f.placeIds.includes(back.id)) store.updateFolio(id, { placeIds: [...f.placeIds, back.id] });
      });
      // a book tied somewhere else while the toast still stood is not this
      // undo's to move: only the ones still answering to nobody are pointed
      // back, and a book removed in the meantime is simply not there
      kept.bookIds.forEach(id => {
        const b = store.bookById(id);
        if (b && !b.placeId) store.updateBook(id, { placeId: back.id });
      });
      renderAll();
      toast('back where it was');
    } });
  });

  if (edit && !raisesAKeyboard()) {
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ---------- a photograph, read for where it was taken ----------

// A photograph can tell you where you were when you cannot remember. This is
// the whole of what Resonate wants from one: the point the camera wrote into
// the file, which is a thing a person cannot look up afterwards and often
// cannot recall. The picture itself is read, used and let go in the same
// breath. It is not compressed, not stored, and not written anywhere. A phone
// already keeps a photo library, and the fix inside a photograph is the part
// that library will not give you back as a place on a map.
// The point is kept before the world is asked what stands on it. A fix a
// camera or a device wrote once cannot be asked for a second time; a name
// can. So the record goes down under its own coordinates, and openstreetmap's
// answer replaces them a moment later if the network allows.
//
// This used to live inside the photo path alone. Standing somewhere and
// photographing it are the same gesture at two removes, and the two keeps
// drifting apart would mean one of them quietly stopped naming the ground or
// stopped surviving offline.
async function keepFix(lat, lng, said) {
  const unnamed = fmtDMS(lat, lng);
  const place = store.addPlace(newPlace({
    name: unnamed, lat, lng, status: 'visited',
  }));
  if (!place) return toast('this browser refused to keep it');
  store.settings.seeded = true;
  store.saveSettings();
  renderAll();
  selectPlace(place.id, { fly: true, edit: true });
  toast(said);
  // the ground names itself when the network allows; the keep never waited
  try {
    const r = await reverseGeo(lat, lng);
    if (r) {
      const still = placeById(place.id);
      // the plate opened with the name selected: anything typed there in the
      // meantime is the person's own and outranks the world's
      if (still && still.name === unnamed) {
        store.updatePlace(place.id, {
          name: r.name || still.name, address: r.address || r.sub || '',
          city: r.city, country: r.country, countryCode: r.countryCode,
        });
        renderAll();
        if (state.selectedId === place.id) renderPlate(placeById(place.id), { edit: true });
      }
    }
  } catch { /* offline is fine; the fix stands */ }
  return place;
}

async function addFromPhoto(file) {
  toast('reading the photo…');
  const fix = await exifGPS(file);
  if (!fix) {
    toast('this photo has no location. Press and hold the place on the map instead');
    return;
  }
  await keepFix(fix.lat, fix.lng, 'kept by its own fix. the name is on its way');
}

// The nearest gesture of all: you are at the place. One press asks the device
// for its fix and keeps the ground under your feet; the name arrives the way
// it does for a photograph. Free, like every capture: the fix is the device's
// own work.
function standHere() {
  askWhereYouAre((at) => keepFix(at.lat, at.lng, 'kept where you stand. the name is on its way'));
}

// ---------- adding places ----------

// A tool may bring one disclosed record into view, but it must not take the
// shortcut through the ordinary plate. That plate is the owner's workbench:
// it also contains local dates, gratitude, private ties and editing controls.
// This plate is made afresh from store.outward(), the exact object the tool is
// allowed to read, and is deliberately read-only. The distinction matters to
// assistants that can see the page as well as consume a tool result.
function openAgentAtlasItem({ id, kind }) {
  const atlas = disclosureForAgent();
  const records = kind === 'place' ? atlas.places
    : kind === 'path' ? atlas.routes
      : kind === 'book' ? atlas.books : [];
  const record = records.find(r => r.id === id);
  if (!record) throw new TypeError('That item is not available to the assistant.');

  const tagNames = new Map((atlas.tags || []).map(t => [t.id, t.name]));
  const tags = (record.tags || []).map(tagId => tagNames.get(tagId)).filter(Boolean);
  const recommendationTrail = (Array.isArray(record.prov) ? record.prov : [])
    .map(step => String(step?.name || '').trim()).filter(Boolean);
  const name = kind === 'book' ? record.title : record.name;
  const location = [record.city, record.country].filter(Boolean).join(' · ');
  const status = kind === 'path'
    ? record.status === 'walked' ? 'walked' : 'want to walk'
    : kind === 'book'
      ? record.status === 'visited' ? 'read' : 'want to read'
      : record.status === 'visited' ? 'been' : 'want to go';
  const facts = [
    kind === 'place' && record.address ? ['address', record.address] : null,
    kind === 'place' ? ['point', fmtDMS(record.lat, record.lng)] : null,
    kind === 'path' && Number.isFinite(record.km) ? ['distance', fmtKm(record.km)] : null,
    kind === 'path' && Number.isFinite(record.ascent) ? ['ascent', `${record.ascent} m`] : null,
    kind === 'path' && Number.isFinite(record.descent) ? ['descent', `${record.descent} m`] : null,
    kind === 'path' && Number.isFinite(record.high) ? ['high point', `${record.high} m`] : null,
    kind === 'path' && Number.isFinite(record.hours) ? ['on foot', fmtHours(record.hours)] : null,
    kind === 'path' && record.loop ? ['shape', 'a loop'] : null,
    kind === 'book' && record.author ? ['author', record.author] : null,
    kind === 'book' && record.year ? ['year', record.year] : null,
    ['status', status],
  ].filter(Boolean);
  const kindWord = kind === 'path' ? 'path' : kind;
  const href = safeUrl(record.url) ? record.url : '';
  const wrap = $('#plate');
  wrap.setAttribute('aria-label', `Assistant ${kindWord}`);

  // Clear a workbench selection before drawing the disclosure-safe view. A
  // route is framed from the redacted path in `record`, never by selecting the
  // owner's original route (whose first and last stretch may be private).
  state.selectedId = null;
  state.selectedRouteId = null;
  state.foreign = null;
  state.proposal = null;
  syncMarkers();
  wrap.dataset.pid = `assistant:${kind}:${id}`;
  wrap.innerHTML = `
    <div class="plate-eyebrow">
      <span>assistant view · read only</span>
      <button id="aaiClose">close</button>
    </div>
    <h1 class="plate-name">${esc(name)}</h1>
    <div class="plate-sub">${esc([kindWord, location].filter(Boolean).join(' · '))}</div>
    <dl class="agent-proposal">
      ${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
      ${tags.length ? `<div><dt>filed under</dt><dd class="agent-proposal-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</dd></div>` : ''}
      ${recommendationTrail.length ? `<div><dt>recommended by</dt><dd>${recommendationTrail.map(esc).join(' → ')}</dd></div>` : ''}
      ${href ? `<div><dt>source</dt><dd><a href="${esc(href)}" target="_blank" rel="noopener">${esc(href)}</a></dd></div>` : ''}
      ${record.note ? `<div><dt>note</dt><dd class="agent-proposal-note">${esc(record.note)}</dd></div>` : ''}
    </dl>
    <p class="agent-proposal-caution">Shown from the same reviewed copy the assistant can read. This view cannot edit your atlas.</p>`;

  if (kind === 'place') {
    mapView.previewPin(record.lat, record.lng);
    mapView.flyToPlace(record);
  } else if (kind === 'path') {
    mapView.frameRoute(record);
  }
  openSurface('plate');
  $('#aaiClose').addEventListener('click', () => popSurface());
}

// An assistant may put a proposal on the glass and no farther. The fields are
// intentionally fewer than a place owns: there is no status, rating, privacy,
// provenance, or date to smuggle through. A human press below is the only line
// that constructs a record, and even then the place begins as want to go. An
// assistant has never been anywhere on its owner's behalf.
function openAgentPlaceProposal(proposal) {
  state.proposal = proposal;
  mapView.previewPin(proposal.lat, proposal.lng);
  mapView.flyToPlace(proposal);
  const wrap = $('#plate');
  wrap.setAttribute('aria-label', 'Assistant place proposal');
  const where = [proposal.address, proposal.city, proposal.country].filter(Boolean);
  const details = [
    proposal.address ? ['address', proposal.address] : null,
    proposal.city ? ['city', proposal.city] : null,
    proposal.country ? ['country', proposal.country] : null,
    ['point', fmtDMS(proposal.lat, proposal.lng)],
  ].filter(Boolean);
  wrap.innerHTML = `
    <div class="plate-eyebrow">
      <span>assistant proposal · not yet yours</span>
      <button id="apClose">close</button>
    </div>
    <h1 class="plate-name">${esc(proposal.name)}</h1>
    ${where.length ? `<div class="plate-sub">${esc(where.join(' · '))}</div>` : ''}
    <dl class="agent-proposal">
      ${details.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
      ${proposal.tags.length ? `<div><dt>file under</dt><dd class="agent-proposal-tags">${proposal.tags.map(t => `<span>${esc(t)}</span>`).join('')}</dd></div>` : ''}
      ${proposal.url ? `<div><dt>source</dt><dd><a href="${esc(proposal.url)}" target="_blank" rel="noopener">${esc(proposal.url)}</a></dd></div>` : ''}
      ${proposal.note ? `<div><dt>note</dt><dd class="agent-proposal-note">${esc(proposal.note)}</dd></div>` : ''}
    </dl>
    <p class="agent-proposal-caution">Nothing changes until you add it. It will begin as “want to go”; only you can say you have been.</p>
    <div class="plate-acts">
      <button class="word-btn" id="apKeep">Add to my atlas</button>
      <button class="word-btn quiet" id="apLater">not now</button>
    </div>`;
  openSurface('plate');

  const close = () => {
    state.proposal = null;
    mapView.clearPreview();
    closeSurface('plate');
  };
  $('#apClose').addEventListener('click', close);
  $('#apLater').addEventListener('click', close);
  $('#apKeep').addEventListener('click', () => {
    const created = [];
    const tagIds = [];
    const tagWord = value => String(value || '').trim().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const name of proposal.tags) {
      let tag = allTags().find(t => tagWord(t.name) === tagWord(name));
      if (!tag) {
        const station = TAG_STATIONS[store.tags.length % TAG_STATIONS.length];
        tag = store.addTag(newTag({ name, hue: station.hue, color: station.hex }));
        if (tag) created.push(tag.id);
      }
      if (!tag) {
        created.forEach(id => store.removeTag(id));
        return toast('this browser refused to keep the proposed filing words');
      }
      tagIds.push(tag.id);
    }
    const place = store.addPlace(newPlace({
      name: proposal.name, lat: proposal.lat, lng: proposal.lng,
      address: proposal.address, city: proposal.city, country: proposal.country,
      url: proposal.url, note: proposal.note, tags: tagIds,
      status: 'wishlist', sample: false,
    }));
    if (!place) {
      created.forEach(id => store.removeTag(id));
      return toast('this browser refused to keep it');
    }
    state.proposal = null;
    mapView.clearPreview();
    store.settings.seeded = true;
    store.saveSettings();
    renderAll();
    selectPlace(place.id, { fly: false, edit: true });
    toast('Added as Want to go.');
  });
}

// a found place is opened, not taken: you decide on the plate
function proposePlace(r) {
  state.proposal = r;
  mapView.previewPin(r.lat, r.lng);
  mapView.flyToPlace(r);
  const wrap = $('#plate');
  wrap.setAttribute('aria-label', 'Place suggestion');
  wrap.innerHTML = `
    <div class="plate-eyebrow">
      <span>found. not yet yours</span>
      <span>${fmtDMS(r.lat, r.lng)}</span>
      <button id="ppClose">close</button>
    </div>
    <h1 class="plate-name">${esc(r.name)}</h1>
    <div class="plate-sub">${esc(r.sub || r.address || '')}</div>
    <div class="plate-acts">
      <button class="word-btn" id="ppKeep">Add to my atlas</button>
      <button class="word-btn quiet" id="ppDirections">directions ↗</button>
    </div>`;
  openSurface('plate');
  const settle = () => { mapView.clearPreview(); state.proposal = null; };
  $('#ppClose').addEventListener('click', () => { settle(); closeSurface('plate'); });
  $('#ppKeep').addEventListener('click', () => {
    settle();
    if (addPlaceFromResult(r)) toast('Added as Want to go.');
  });
  $('#ppDirections').addEventListener('click', () => {
    window.open(directionsURL(r.lat, r.lng, r.name), '_blank', 'noopener');
  });
}

function addPlaceFromResult(r) {
  const place = store.addPlace(newPlace({
    name: r.name, lat: r.lat, lng: r.lng,
    address: r.address || r.sub || '', city: r.city, country: r.country, countryCode: r.countryCode,
    status: 'wishlist',
  }));
  if (!place) { toast('this browser refused to keep it'); return null; }
  store.settings.seeded = true;
  store.saveSettings();
  renderAll();
  selectPlace(place.id, { fly: true });
  return place;
}

// A point the world has no name for is still a place: a trailhead, a bench, a
// door with no sign, a spring. The field is always there and always focused,
// so the interaction is one shape whether the world answers or not, and a
// keyboard can finish it. What the world finds only fills a field the person
// has not started typing into.
let markRequest = 0;
async function proposeAdd(lat, lng) {
  const request = ++markRequest;
  const el = $('#addConfirm');
  const input = $('#addConfirmInput');
  const status = $('#addConfirmStatus');

  state.pendingAdd = { lat, lng, name: '' };
  input.value = '';
  input.dataset.typed = '';
  status.textContent = 'asking openstreetmap what is here';
  $('#addConfirmCoords').textContent = fmtDMS(lat, lng);
  el.hidden = false;
  // the point is shown and gone to, so a person can see what they are naming
  mapView.previewPin(lat, lng);
  mapView.flyToMark(lat, lng);
  focusSoftly(input);

  let r = null;
  try { r = await reverseGeo(lat, lng); }
  catch { /* offline, or the world declined: the point is still good */ }

  // A late answer must never touch a newer mark.
  if (request !== markRequest || !state.pendingAdd) return;
  // What the world knows is kept either way: the address and the city belong
  // to the point, not to the sentence on screen.
  if (r) {
    Object.assign(state.pendingAdd, {
      address: r.address || r.sub || '', city: r.city, country: r.country, countryCode: r.countryCode,
    });
  }
  // Only the words wait. Press add with an empty name while the world is
  // still being asked, and the sentence telling you to give it a name used to
  // be replaced a moment later by the world's shrug, leaving no reason on
  // screen for why nothing had happened. The app does not talk over itself.
  if (state.pendingAdd.spoke) return;
  if (r?.name && !input.dataset.typed) {
    input.value = r.name;
    status.textContent = 'proposed name';
  } else if (!r?.name) {
    status.textContent = 'no name found here';
  } else {
    status.textContent = '';
  }
}

function cancelAdd() {
  markRequest += 1;
  state.pendingAdd = null;
  $('#addConfirm').hidden = true;
  mapView.clearPreview?.();
}

function commitAdd() {
  const p = state.pendingAdd;
  if (!p) return;
  // a place is never kept under a name nobody chose
  const typed = $('#addConfirmInput').value.trim();
  if (!typed) {
    $('#addConfirmStatus').textContent = 'give it a name, and it is yours';
    // the world's answer, if it is still coming, does not get to erase this
    p.spoke = true;
    $('#addConfirmInput').focus();
    return;
  }
  p.name = typed;
  markRequest += 1;
  state.pendingAdd = null;
  $('#addConfirm').hidden = true;
  // the proposal becomes a real mark a line below; two rings on one point
  // would read as two places
  mapView.clearPreview?.();
  const place = store.addPlace(newPlace({
    name: p.name,
    lat: p.lat, lng: p.lng,
    address: p.address || '', city: p.city || '', country: p.country || '', countryCode: p.countryCode || '',
    status: 'wishlist',
  }));
  if (!place) return toast('this browser refused to keep it');
  store.settings.seeded = true;
  store.saveSettings();
  renderAll();
  selectPlace(place.id, { fly: false, edit: true });
}

function seedDemo({ quiet = false } = {}) {
  const demo = demoData();
  demo.tags.forEach(t => store.addTag(t));
  // each record remembers that it arrived with the app rather than by a
  // person's own hand, which is what the word under `you` clears. it is not a
  // label and nothing draws it: these are real places from real people, and
  // they travel like any other record here
  demo.places.forEach(p => store.addPlace({ ...p, sample: true }));
  (demo.routes || []).forEach(r => store.addRoute({ ...r, sample: true }));
  (demo.books || []).forEach(b => store.addBook({ ...b, sample: true }));
  // the voices arrive only where none stand: a person who already keeps real
  // correspondents does not get demonstration people mixed among them
  if (!store.correspondents.length) {
    (demo.correspondents || []).forEach(c => store.addCorrespondent({ ...c, sample: true }));
  }
  store.settings.seeded = true;
  store.saveSettings();
  renderAll();
  closeSurface('indexOverlay');
  mapView.fitAll(store.places);
  if (!quiet) toast('ready-made atlas opened. edit anything to make it yours', 5500);
}

// The example is a letter laid open on the table, not a starter pack poured
// into somebody's private records. Every individual save remains available,
// and taking the whole example is a second, explicit act.
function previewDemo() {
  const demo = demoData();
  const payload = buildPayload('folio', {
    title: 'The example atlas',
    dedication: 'Places, paths, and books chosen to show what the atlas can hold.',
    author: 'Resonate',
    tags: demo.tags,
    places: demo.places,
    routes: demo.routes || [],
    books: demo.books || [],
  });
  openFolioReport(payload, { example: true });
}

// What arrived with the app can be sent away again, in one act.
//
// These records are real places from real people and they behave like any
// other record here, so the only thing the flag decides is this: whether a
// person can clear, in one word, everything they did not put here themselves.
// It is cleared the moment a record is edited, so this removes exactly what
// is still untouched and never anything a person has worked on.
function untouched() {
  return [
    ...store.places.filter(p => p.sample),
    ...store.routes.filter(r => r.sample),
    ...store.books.filter(b => b.sample),
    ...store.correspondents.filter(c => c.sample),
  ];
}

async function clearUntouched() {
  const loose = untouched();
  if (!loose.length) return toast('nothing here is untouched: every record is yours');
  const mine = (store.places.length + store.routes.length + store.books.length
    + store.correspondents.length) - loose.length;
  const go = await ask(
    `Clear the ${loose.length} record${loose.length === 1 ? '' : 's'} you have not touched? `
    + (mine ? `The ${mine} you made or edited stay.` : 'Nothing else is here, so the atlas will be empty.'),
    { yes: 'clear them', no: 'keep them', danger: true });
  if (!go) return;
  for (const p of store.places.filter(x => x.sample)) store.removePlace(p.id);
  for (const r of store.routes.filter(x => x.sample)) store.removeRoute(r.id);
  for (const b of store.books.filter(x => x.sample)) store.removeBook(b.id);
  for (const c of store.correspondents.filter(x => x.sample)) store.removeCorrespondent(c.id);
  renderAll();
  toast(mine
    ? 'untouched starter records removed. Your own things remain'
    : 'untouched starter records removed. Your atlas is ready');
}

// ---------- ways: the plate, and the ground drawn as a section ----------

function selectRoute(id, { fly = true } = {}) {
  const r = routeById(id);
  if (!r) return;
  state.selectedRouteId = id;
  state.selectedId = null;
  syncMarkers();
  if (fly) mapView.frameRoute(r);
  renderRoutePlate(r);
  openSurface('plate');
}

// the profile is not a chart. it is a section through the hill: a ridge over
// close hatching whose weight follows the steepness, so a wall reads as a wall.
function profileSVG(pf) {
  if (!pf) return '';
  const hatch = pf.hatch.map(h =>
    `<line class="pf-hatch" x1="${h.x.toFixed(1)}" y1="${h.y.toFixed(1)}" x2="${h.x.toFixed(1)}" y2="${pf.height}" style="--g:${h.w.toFixed(2)}"/>`
  ).join('');
  return `<svg class="pf" viewBox="0 0 ${pf.width} ${pf.height}" preserveAspectRatio="none" aria-hidden="true">
      <g class="pf-hatches">${hatch}</g>
      <path class="pf-ridge" d="${pf.ridge}"/>
      <circle class="pf-high" cx="${pf.high.x.toFixed(1)}" cy="${pf.high.y.toFixed(1)}" r="7"/>
      <line class="pf-rule" x1="0" y1="0" x2="0" y2="${pf.height}" hidden/>
    </svg>`;
}

function renderRoutePlate(route) {
  const wrap = $('#plate');
  wrap.setAttribute('aria-label', 'Path');
  const sameRecord = wrap.dataset.pid === route.id;
  const keepScroll = sameRecord ? wrap.scrollTop : 0;
  const tagsWereOpen = sameRecord && !!wrap.querySelector('.plate-tags')?.open;
  wrap.dataset.pid = route.id;
  const m = {
    km: route.km, ascent: route.ascent, descent: route.descent,
    high: route.high, low: route.low, hours: route.hours,
  };
  const pf = profile(route.path, { width: 1000, height: 200 });
  // A worn tag says so with aria-pressed, the same as on a place and on a
  // book. This row marked one with class="on", and no rule in the stylesheet
  // has ever known that word: the ink and the underline are laid under
  // [aria-pressed="true"] and nothing else. So the tags a path wore rendered
  // in exactly the grey of the ones it did not, a press saved and changed
  // nothing on the glass, and the second press a person naturally gives it
  // quietly took the tag back off again. A screen reader was told nothing.
  const tagWords = allTags().map(t =>
    `<button data-rtag="${esc(t.id)}" aria-pressed="${route.tags.includes(t.id)}">${esc(t.name)}</button>`).join('');
  const wornTags = route.tags.map(id => tagById(id)?.name).filter(Boolean);

  wrap.innerHTML = `
    <div class="plate-eyebrow mono">
      <span>${route.loop ? 'a loop' : 'a path'}</span>
      <span>${esc(effort(m))}</span>
      <button id="pClose">close</button>
    </div>
    <h1 class="plate-name" id="pRouteName" contenteditable="plaintext-only" spellcheck="false"
        role="textbox" aria-label="The name of this path">${esc(route.name)}</h1>
    
    <div class="plate-sub">${esc([route.city, route.country].filter(Boolean).join(' · '))}</div>
    ${route.provenance ? `<div class="plate-prov prov">after <b>${esc(route.provenance.name)}</b></div>` : ''}
    ${route.private ? '<div class="plate-prov held-back">Excluded from sharing</div>' : ''}
    ${!route.private && route.trimEnds ? '<div class="plate-prov held-back">Start and end hidden when shared</div>' : ''}

    <dl class="way-measure mono">
      <div><dt>distance</dt><dd>${esc(fmtKm(m.km))}</dd></div>
      ${Number.isFinite(m.ascent) ? `<div><dt>ascent</dt><dd>${m.ascent} m</dd></div>` : ''}
      ${Number.isFinite(m.descent) ? `<div><dt>descent</dt><dd>${m.descent} m</dd></div>` : ''}
      ${Number.isFinite(m.high) ? `<div><dt>high point</dt><dd>${m.high} m</dd></div>` : ''}
      <div><dt>on foot</dt><dd>${esc(fmtHours(m.hours))}</dd></div>
    </dl>

    ${pf ? `
    <div class="plate-sec">
      <div class="plate-sec-head"><span>the ground</span><span class="pf-read mono" id="pfRead"></span></div>
      <div class="pf-wrap" id="pfWrap" role="img"
        aria-label="Elevation along the path: ${Math.round(m.low)} to ${Math.round(m.high)} metres over ${esc(fmtKm(m.km))}">
        ${profileSVG(pf)}
      </div>
      <div class="pf-axis mono"><span>0</span><span>${esc(fmtKm(m.km))}</span></div>
    </div>` : ''}

    <div class="plate-words" id="pRouteStatus">
      <button data-rst="walked" aria-pressed="${route.status === 'walked'}">walked</button>
      <button data-rst="wishlist" aria-pressed="${route.status === 'wishlist'}">want to walk</button>
    </div>

    <details class="plate-tags plate-sec"${tagsWereOpen ? ' open' : ''}>
      <summary><span>tags</span><span class="plate-tag-current">${esc(wornTags.join(' · ') || 'none')}</span><span class="plate-tag-edit" aria-hidden="true"></span></summary>
      <div class="plate-words" id="pRouteTags">${tagWords}</div>
    </details>

    <div class="plate-sec">
      <div class="plate-sec-head"><span>notes</span></div>
      <textarea class="note-input" id="pRouteNote" aria-label="Your note on this path"
        placeholder="When to walk it, where to start, what it asks of you…">${esc(route.note)}</textarea>
    </div>

    <div class="plate-acts">
      <button class="word-btn" id="pRouteFolio">add to collection</button>
      <button class="word-btn quiet" id="pRouteGpx">export gpx</button>
      <button class="word-btn quiet" id="pRoutePrivate">${route.private ? 'Include in sharing' : 'Exclude from sharing'}</button>
      ${route.private ? '' : `<button class="word-btn quiet" id="pRouteTrim">${route.trimEnds ? 'Share full path' : 'Hide first and last 250 m when sharing'}</button>`}
      <button class="word-btn quiet" id="pRouteRemove">remove</button>
    </div>`;

  if (keepScroll) wrap.scrollTop = keepScroll;

  const save = (patch) => {
    const saved = store.updateRoute(route.id, { ...patch, sample: false });
    if (!saved) { renderRoutePlate(routeById(route.id) || route); return false; }
    syncMarkers(); renderCount(); renderList();
    return true;
  };

  const nameEl = $('#pRouteName');
  nameEl.addEventListener('blur', () => {
    const v = nameEl.textContent.trim();
    if (v && v !== route.name) save({ name: v });
    else nameEl.textContent = route.name;
  });
  // enter means the name is said, here as on a place and on a book. without it
  // the key did what it does in any contenteditable and put a line break in the
  // middle of the name, which blur then wrote down: trim reaches the ends and
  // not the middle, so the break travelled on into the gpx, the index row and
  // every folio saying this path, and the person who pressed enter meaning
  // done had damaged the record while believing they had confirmed it.
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
  $('#pClose').addEventListener('click', () => { state.selectedRouteId = null; popSurface(); syncMarkers(); applyWorldState(); });
  $$('#pRouteStatus [data-rst]').forEach(b => b.addEventListener('click', () => {
    if (save({ status: b.dataset.rst })) renderRoutePlate(routeById(route.id));
  }));
  $$('#pRouteTags button').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.rtag;
    const tags = route.tags.includes(id) ? route.tags.filter(t => t !== id) : [...route.tags, id];
    if (save({ tags })) renderRoutePlate(routeById(route.id));
  }));
  fitNoteInput($('#pRouteNote'));
  writesLater($('#pRouteNote'), `note:${route.id}`, (v) => save({ note: v }));
  $('#pRouteFolio').addEventListener('click', () => fileIntoFolio(route.id));
  $('#pRouteGpx').addEventListener('click', () => downloadGPX(route));
  $('#pRoutePrivate').addEventListener('click', () => {
    const now = !route.private;
    if (save({ private: now })) renderRoutePlate(routeById(route.id));
    toast(now ? SHARING_EXCLUSION_COPY : 'Included in sharing.');
  });
  $('#pRouteTrim')?.addEventListener('click', () => {
    const now = !route.trimEnds;
    if (save({ trimEnds: now })) renderRoutePlate(routeById(route.id));
    toast(now ? 'Start and end hidden when shared.' : 'Full path included when shared.');
  });
  $('#pRouteRemove').addEventListener('click', async () => {
    const wayFolios = store.folios.filter(f => f.routeIds.includes(route.id)).length;
    if (!await ask(`Remove “${route.name}” from your atlas?${wayFolios ? ` ${wayFolios === 1 ? 'One collection includes it' : `${wayFolios} collections include it`} and will stop showing it.` : ''} A link already sent keeps its copy.`, { yes: 'remove it', no: 'keep it', danger: true })) return;
    // A path is taken back the same way a place and a book are. This ended in
    // one word and no way back, under a question worded exactly like the one a
    // place asks, so the app taught that `remove it` is soft and then meant it
    // hard, on the record most likely to be the last copy of anything: a walk
    // imported from a gpx the phone that recorded it no longer holds.
    //
    // The folio ids are not kept, for the reason written over the book below:
    // removeRoute leaves them standing in the folio, dangling and filtered at
    // every read, so the same id coming back finds its folios still saying it.
    // It returns at the head of the index rather than where it stood, which is
    // what a book does too, and was accepted there.
    const kept = { ...route, path: [...route.path] };
    store.removeRoute(route.id);
    state.selectedRouteId = null;
    popSurface();
    renderAll();
    toast('removed.', 9000, { word: 'take it back', run: () => {
      const back = store.addRoute(kept);
      if (!back) return toast('this browser refused to take it back');
      renderAll();
      toast('back where it was');
    } });
  });

  if (pf) bindProfile(pf);
}

// a finger along the section puts a light on the hill, and says where it is
function bindProfile(pf) {
  const wrap = $('#pfWrap');
  const read = $('#pfRead');
  const rule = wrap.querySelector('.pf-rule');
  if (!wrap) return;

  const move = (clientX) => {
    const box = wrap.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    const at = pf.at(t * pf.total);
    rule.hidden = false;
    rule.setAttribute('x1', (t * pf.width).toFixed(1));
    rule.setAttribute('x2', (t * pf.width).toFixed(1));
    read.textContent = `${fmtKm(t * pf.total)} · ${Math.round(at.ele)} m`;
    mapView.setRouteCursor(at.lat, at.lng);
  };
  const leave = () => {
    rule.hidden = true;
    read.textContent = '';
    mapView.setRouteCursor(null);
  };

  // A mouse says what it wants by being a mouse: it presses to read the hill.
  // A finger has not said yet. So a touch is held until it has moved far enough
  // to mean something, and only a finger going more sideways than up walks the
  // light; one going up or down is let go, and the stylesheet hands the plate
  // its scroll. Without the hold, pan-y still lets the press through, and every
  // scroll that began on the drawing threw the crosshair across the map for the
  // frame before the browser cancelled it.
  let felt = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { felt = { x: e.clientX, y: e.clientY, meant: '' }; return; }
    wrap.setPointerCapture?.(e.pointerId);
    move(e.clientX);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (!felt) return;
      if (!felt.meant) {
        const dx = Math.abs(e.clientX - felt.x), dy = Math.abs(e.clientY - felt.y);
        if (dx < 8 && dy < 8) return;
        felt.meant = dx > dy ? 'trace' : 'scroll';
        if (felt.meant === 'trace') wrap.setPointerCapture?.(e.pointerId);
      }
      if (felt.meant !== 'trace') return;
    }
    move(e.clientX);
  });
  wrap.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') { felt = null; leave(); } });
  wrap.addEventListener('pointerleave', leave);
  wrap.addEventListener('pointercancel', () => { felt = null; leave(); });
}

// ---------- the book plate ----------
//
// The last kind to get one. A place opens onto a plate, a path opens onto a
// plate; a book stood in the index as type that answered nothing, so the one
// record a person could not correct, mark read, untie or remove was the one
// they were most likely to have adopted on somebody's word. The plate does
// not move the field: a book has no point, and the map underneath simply
// stays where it was.

function selectBook(id) {
  const b = store.bookById(id);
  if (!b) return;
  renderBookPlate(b);
  openSurface('plate');
}

function renderBookPlate(book) {
  const wrap = $('#plate');
  wrap.setAttribute('aria-label', 'Book');
  const sameRecord = wrap.dataset.pid === book.id;
  const keepScroll = sameRecord ? wrap.scrollTop : 0;
  const tagsWereOpen = sameRecord && !!wrap.querySelector('.plate-tags')?.open;
  wrap.dataset.pid = book.id;
  // a tie whose place is gone reads as no tie: removePlace clears ties on
  // this device, so a dangling id can only be a foreign one that never
  // re-landed, and offering to fly to it would be offering a door to a wall
  const at = book.placeId ? placeById(book.placeId) : null;
  const tagWords = allTags().map(t => `
    <button data-btag="${esc(t.id)}" aria-pressed="${book.tags.includes(t.id)}">${esc(t.name)}</button>`).join('');
  const wornTags = book.tags.map(id => tagById(id)?.name).filter(Boolean);

  wrap.innerHTML = `
    <div class="plate-eyebrow mono">
      <span>¶ a book</span>
      <button id="pClose">close</button>
    </div>
    <h1 class="plate-name" id="pBookTitle" contenteditable="plaintext-only" spellcheck="false"
        role="textbox" aria-label="The title of this book">${esc(book.title)}</h1>
    <div class="plate-sub book-line">
      <input class="bp-inline" id="pBookAuthor" aria-label="Who wrote it" placeholder="who wrote it" value="${esc(book.author)}">
      <input class="bp-inline bp-year" id="pBookYear" maxlength="60" aria-label="Year or edition" placeholder="year or edition" value="${esc(book.year)}">
    </div>
    ${book.provenance ? `<div class="plate-prov prov">after ${nameDoor(book.provenance.name)}${fmtDate(book.provenance.adoptedAt) ? ` · saved ${fmtDate(book.provenance.adoptedAt)}` : ''}</div>` : ''}
    ${book.private ? '<div class="plate-prov held-back">Excluded from sharing</div>' : ''}

    <div class="plate-words" id="pBookStatus">
      <button data-st="visited" aria-pressed="${book.status === 'visited'}">read</button>
      <button data-st="wishlist" aria-pressed="${book.status === 'wishlist'}">want to read</button>
    </div>

    <details class="plate-tags plate-sec"${tagsWereOpen ? ' open' : ''}>
      <summary><span>tags</span><span class="plate-tag-current">${esc(wornTags.join(' · ') || 'none')}</span><span class="plate-tag-edit" aria-hidden="true"></span></summary>
      <div class="plate-words" id="pBookTags">${tagWords}</div>
    </details>

    <div class="plate-sec">
      <div class="plate-sec-head"><span>notes</span></div>
      <textarea class="note-input" id="pBookNote" aria-label="Your note on this book"
        placeholder="Why it is worth someone's while…">${esc(book.note)}</textarea>
    </div>

    <div class="plate-sec">
      <div class="plate-sec-head"><span>read at</span></div>
      ${at ? `
      <div class="plate-words" id="pBookAtRow">
        <button id="pBookAt" aria-pressed="true">${esc(at.name)}</button>
        <button id="pBookUntie">untie</button>
      </div>` : `
      <input class="text-input" id="pBookAtFind" aria-label="Tie this book to a place of yours"
        placeholder="a place of yours…" autocomplete="off" spellcheck="false">
      <div class="plate-words" id="pBookAtMatches"></div>`}
    </div>

    <div class="plate-sec">
      <div class="plate-sec-head"><span>website</span></div>
      <input class="text-input" id="pBookUrl" type="url" inputmode="url" autocomplete="url" autocapitalize="off" aria-label="Website for this book" placeholder="https://…" value="${esc(book.url)}">
    </div>

    <div class="plate-acts">
      <button class="word-btn" id="pBookFolio">add to collection</button>
      ${safeUrl(book.url) ? `<a class="word-btn" href="${esc(book.url)}" target="_blank" rel="noopener">website ↗</a>` : ''}
      <button class="word-btn quiet" id="pBookPrivate">${book.private ? 'Include in sharing' : 'Exclude from sharing'}</button>
      <button class="word-btn quiet" id="pBookRemove">remove</button>
    </div>
    ${fmtDate(book.createdAt) ? `<div class="plate-foot">entered ${fmtDate(book.createdAt)}</div>` : ''}`;

  if (keepScroll) wrap.scrollTop = keepScroll;
  bindNameDoors(wrap);

  // the store decides whether an edit happened; the view only reports it.
  // editing what arrived with the app makes it fully yours, same as a place.
  const save = (patch) => {
    const saved = store.updateBook(book.id, { ...patch, sample: false });
    if (!saved) { renderBookPlate(store.bookById(book.id) || book); return false; }
    renderList(); renderCount();
    return true;
  };

  $('#pClose').addEventListener('click', () => closeSurface('plate'));

  const titleEl = $('#pBookTitle');
  titleEl.addEventListener('blur', () => {
    const v = titleEl.textContent.trim();
    if (v && v !== book.title) save({ title: v });
    else titleEl.textContent = book.title;
  });
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

  $('#pBookAuthor').addEventListener('change', (e) => save({ author: e.target.value.trim() }));
  $('#pBookYear').addEventListener('change', (e) => save({ year: e.target.value.trim() }));

  $('#pBookStatus').addEventListener('click', (e) => {
    const st = e.target.closest('[data-st]');
    if (!st) return;
    if (save({ status: st.dataset.st })) renderBookPlate(store.bookById(book.id));
  });

  $('#pBookTags').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-btag]');
    if (!chip) return;
    const id = chip.dataset.btag;
    const tags = book.tags.includes(id) ? book.tags.filter(t => t !== id) : [...book.tags, id];
    if (save({ tags })) renderBookPlate(store.bookById(book.id));
  });

  fitNoteInput($('#pBookNote'));
  writesLater($('#pBookNote'), `note:${book.id}`, (v) => save({ note: v }));
  $('#pBookUrl').addEventListener('change', (e) => {
    if (save({ url: asUrl(e.target.value) })) renderBookPlate(store.bookById(book.id));
  });

  // the tie: a door when it stands, an offer when it does not. the offer is
  // answered from your own places as you type, and nothing is asked of any
  // server: a book is tied to somewhere you already keep, or to nowhere.
  $('#pBookAt')?.addEventListener('click', () => selectPlace(book.placeId, { fly: true }));
  $('#pBookUntie')?.addEventListener('click', () => {
    if (save({ placeId: '' })) renderBookPlate(store.bookById(book.id));
  });
  const find = $('#pBookAtFind');
  find?.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    const row = $('#pBookAtMatches');
    if (!q) { row.innerHTML = ''; return; }
    const hits = store.places.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5);
    row.innerHTML = hits.map(p => `<button data-tie="${esc(p.id)}">${esc(p.name)}</button>`).join('');
    $$('[data-tie]', row).forEach(b => b.addEventListener('click', () => {
      if (save({ placeId: b.dataset.tie })) renderBookPlate(store.bookById(book.id));
    }));
  });

  $('#pBookFolio').addEventListener('click', () => fileIntoFolio(book.id));
  $('#pBookPrivate')?.addEventListener('click', () => {
    const now = !book.private;
    if (save({ private: now })) {
      toast(now ? SHARING_EXCLUSION_COPY : 'Included in sharing.');
      renderBookPlate(store.bookById(book.id));
    }
  });

  $('#pBookRemove').addEventListener('click', async () => {
    const inFolios = store.folios.filter(f => (f.bookIds || []).includes(book.id));
    const warn = inFolios.length
      ? ` ${inFolios.length === 1 ? 'One collection includes it and' : `${inFolios.length} collections include it and`} will stop showing it.`
      : '';
    if (!await ask(`Remove “${book.title}” from your atlas?${warn} A link already sent keeps its copy.`, { yes: 'remove it', no: 'keep it', danger: true })) return;
    // the folio ids are not kept: removeBook leaves them standing in the
    // folio, dangling and filtered at every read, so an undo that brings the
    // same id back finds its folios still saying it
    const kept = { ...book };
    store.removeBook(book.id);
    closeSurface('plate');
    renderAll();
    toast('removed.', 9000, { word: 'take it back', run: () => {
      const back = store.addBook(kept);
      if (!back) return toast('this browser refused to take it back');
      renderAll();
      toast('back where it was');
    } });
  });
}

// A title typed into the atlas is something to return to, not a claim that it
// has already been read. The plate makes that change explicit when it is true.
async function addBookByHand() {
  const title = await askText('What is the book?', { yes: 'keep it', placeholder: 'the title' });
  if (!title) return;
  const made = store.addBook(newBook({ title, status: 'wishlist' }));
  if (!made) return toast('this browser refused to keep it');
  renderAll();
  selectBook(made.id);
}

// ---------- taking a way in ----------

async function addFromGPX(file) {
  let text;
  try { text = await file.text(); } catch { return toast('could not read that file'); }
  const parsed = parseGPX(text);
  if (!parsed) return toast('that file has no track in it');

  const m = measure(parsed.points);
  const path = simplify(parsed.points, 0.012);
  const mid = path[Math.floor(path.length / 2)];
  const route = newRoute({
    name: parsed.name || file.name.replace(/\.gpx$/i, '') || 'Untitled path',
    path,
    km: m.km, ascent: m.ascent, descent: m.descent,
    high: m.high, low: m.low, hours: m.hours, loop: m.loop,
    walkedAt: parsed.walkedAt,
    status: parsed.walkedAt ? 'walked' : 'wishlist',
  });
  const made = store.addRoute(route);
  if (!made) return toast('this browser refused to keep it. a long walk is large; export and free some room');
  renderAll();
  selectRoute(made.id);
  toast(`${fmtKm(m.km)}${Number.isFinite(m.ascent) ? `, ${m.ascent} m up` : ''}. ${effort(m)}`);

  // the ground names itself, once, quietly
  try {
    const rev = await reverseGeo(mid.lat, mid.lng);
    if (rev) {
      // the one city in this app that is written after the record was made,
      // so it is spelled here the way newRoute would have spelled it
      store.updateRoute(made.id, { city: oneSpelling(rev.city), country: oneSpelling(rev.country) });
      if (state.selectedRouteId === made.id) renderRoutePlate(routeById(made.id));
    }
  } catch { /* the walk stands without a name for its valley */ }
}

// A gpx is a file, and a file is a door. Every other one in this app reads the
// two words on the record before it writes: the share json, the geojson, the
// kml, the csv, the markdown, the sheet. This one wrote whatever was on the
// plate, so a path marked never to leave went out of the browser in full, and
// a path the plate promises to hand over "without its first and last quarter
// kilometre" was written with both ends on it, under that promise.
//
// A refusal has to name the word that refused, because the person is standing
// on the plate that offers to take it off again.
function downloadGPX(r) {
  if (!loadLatestAtlas()) return false;
  const current = r?.id ? routeById(r.id) : null;
  if (!current || !mayLeave(current)) {
    return toast('Excluded from sharing. Choose Include in sharing to export GPX.');
  }
  const route = store.trimWay(current);
  if (!route) return toast('this path is too short to hide its start and end safely');
  const pts = route.path.map(p =>
    `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${Number.isFinite(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`
  ).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Resonate" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${esc(route.name)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
  const safe = route.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'path';
  download(`${safe}.gpx`, gpx, 'application/gpx+xml');
}

// ---------- correspondents ----------

function corrShaped(c) { return { tags: c.tags, places: c.places }; }

// The common ground, named rather than counted at.
//
// These places used to stand behind a press: the row showed the numbers and a
// person had to open them to learn which places they were. A number is not
// what anybody came for. The places are the answer, so they are simply there,
// with the city after each name, because two people can both keep a Septime
// and they are not the same dinner.
//
// The count stays, on the label, because it is the one number this app is
// allowed to say: the real one.
function commonPlaces(r, name) {
  const who = esc(name);
  // the comma is text rather than a CSS ornament: a name a person copies out
  // of here should read the way it reads on the screen
  const where = (p) => (p.city ? `<span class="cp-city">, ${esc(p.city)}</span>` : '');
  // the places are a group and are marked as one, which is not decoration:
  // wrapped onto a second line they used to return to the container's edge,
  // which is the label's edge, so eight equal things had two left margins and
  // the label stood level with the list it was heading
  const bucket = (label, pairs) => (pairs.length ? `
    <div class="cp-bucket">
      <span class="cp-label"><b>${pairs.length}</b> ${label}</span>
      <div class="cp-run">${pairs.map(pair => `<button class="cp-place" data-pid="${esc(pair.mine.id)}">${esc(pair.mine.name)}${where(pair.mine)}</button>`).join('')}</div>
    </div>` : '');
  return [
    bucket('you both went', r.common.filter(x => x.bothLove)),
    bucket('you both want to go', r.common.filter(x => x.bothWant)),
    bucket(`${who} went, you want to go`, r.common.filter(x => x.theyWent)),
    bucket(`you went, ${who} wants to go`, r.common.filter(x => x.youWent)),
  ].filter(Boolean).join('');
}
function myAtlas() { return { tags: store.tags, places: store.places }; }

function pushCorrespondentsToMap() {
  mapView.setCorrespondents(store.correspondents);
}

// a place keeps its tags when it changes hands: foreign tag names are
// matched to yours by name, and the ones you lack are adopted alongside it
function graftTags(foreignTagIds, foreignTags) {
  if (!Array.isArray(foreignTagIds) || !foreignTags) return [];
  const byId = new Map(foreignTags.map(t => [t.id, t]));
  const out = [];
  for (const fid of foreignTagIds) {
    const ft = byId.get(fid);
    if (!ft) continue;
    const name = String(ft.name || '').trim();
    if (!name) continue;
    const mine = store.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (mine) { out.push(mine.id); continue; }
    const made = store.addTag(newTag({ name, hue: ft.hue, color: ft.color }));
    if (made) out.push(made.id);
  }
  return [...new Set(out)];
}

// A place remembers its whole road, not only its last carrier. Ana handed it
// to Mira, who handed it to you: flattening that to "after Mira" loses the
// person who found it. Five hops are kept, oldest first.
function extendChain(prior, foreign, srcId = '') {
  const before = prior
    ? [...(prior.chain || []), { name: prior.name, at: prior.adoptedAt }].filter(h => h.name)
    : [];
  return {
    chain: before.slice(-4),
    name: foreign.name,
    sig: foreign.sig,
    adoptedAt: new Date().toISOString(),
    // the id this record wore in the sender's atlas, so a thanks sent back
    // can name the exact record it is for. local, like the rest of the road:
    // buildDisclosure never emits it.
    ...(srcId ? { srcId } : {}),
  };
}

// A place you adopt arrives as somewhere you want to go.
//
// It used to arrive with their status on it, so adopting a place Ada had marked
// been wrote "been" into your atlas about a place you have never stood in. Your
// plate then said so, and js/kinship.js:15 reads exactly that field as
// conviction, so her opinion was counted as your evidence in every comparison
// afterwards. A borrowed judgement laundered into a first-hand one, quietly,
// one adopt at a time. The app half knew: its own word for it is "make them
// true".
//
// The rule underneath is the one that matters as soon as anything that is not
// this person can put records here: an assertion nobody made about their own
// life is not a record of it. Only you can say you have been somewhere. Her
// having been there is hers, and it travels as provenance, which is where a
// thing somebody else knows belongs.
function adoptPlace(place, foreign, foreignTags = null) {
  const adopted = store.addPlace(newPlace({
    ...place,
    id: undefined,
    status: 'wishlist',
    tags: graftTags(place.tags, foreignTags || foreign.tags),
    provenance: extendChain(place.provenance, foreign, place.id),
  }));
  if (!adopted) { toast('this browser refused to keep it'); return null; }
  renderAll();
  // the report still stands in front: select quietly, do not raise a plate behind it
  if (topSurface() === 'plate') closeSurface('plate');
  const reportUp = !$('#reportOverlay').hidden;
  selectPlace(adopted.id, { fly: false, quiet: reportUp });
  toast(`saved to your atlas, after ${foreign.name}`);
  return adopted;
}

// A book is adopted the way a place is: as a recommendation, not a reading.
// The status resets to wishlist because only you can say you have read it,
// which is the same sentence adoptPlace stands on.
//
// The tie is the one part that cannot travel literally. The link names the
// place by the id it wore in the sender's atlas, and that id can mean
// something here on two roads. A copy taken whole ("begin with a copy of
// this atlas") keeps the sender's ids, so the id may simply be standing in
// this atlas. A place adopted one at a time is re-minted, but the copy
// remembers where it came from: adoptPlace records the sender's id as
// provenance.srcId, local bookkeeping that never leaves. So the tie re-lands
// by the id itself first, then by that memory, and a book whose place you
// did not take arrives free, which is what it is.
function adoptBook(book, foreign, foreignTags = null) {
  const tie = book.placeId
    ? (store.placeById(book.placeId)
      || store.places.find(pl => pl.provenance?.srcId === book.placeId))
    : null;
  const made = store.addBook(newBook({
    ...book,
    id: undefined,
    sample: false,
    status: 'wishlist',
    placeId: tie ? tie.id : '',
    tags: graftTags(book.tags || [], foreignTags || []),
    provenance: extendChain(book.provenance, foreign, book.id),
  }));
  if (!made) { toast('this browser refused to keep it'); return null; }
  renderAll();
  return made;
}

// Do I already hold this book? A book is told by its title and its author,
// both said the same careless way twice: proximity has no meaning on a shelf.
function holdBookAlready(b) {
  const t = String(b.title || '').trim().toLowerCase();
  const a = String(b.author || '').trim().toLowerCase();
  return store.books.some(mb =>
    String(mb.title || '').trim().toLowerCase() === t
    && String(mb.author || '').trim().toLowerCase() === a);
}

function openForeignPlate(corrId, placeId) {
  const c = store.correspondents.find(x => x.id === corrId) ||
    (state.visiting && state.visiting.id === corrId ? state.visiting : null);
  const p = c?.places.find(x => x.id === placeId);
  if (!c || !p) return;
  state.foreign = { corrId, name: c.name, sig: mapView.sigAngle(c.id), place: p };
  renderPlate(p, { foreign: state.foreign });
  openSurface('plate');
}

// ---------- letters: a room, not a panel ----------
//
// Voices is whose atlas you keep. This is who may put a place in your hands
// without a link in between, and the two are different lists on purpose:
// holding somebody's atlas is not being able to write to them, and being able
// to write to them is not holding their atlas.
//
// They were one surface for a day and it was the wrong shape. Voices is opened
// to read what somebody else likes. This is opened to reach somebody. Two
// errands, and the second was arriving as a panel underneath the first, where
// it was found by scrolling past people who have nothing to do with it.
//
// It is a room a person can only be in as a member. Not by politeness on this
// side: the club refuses every letterbox route to a key with no standing, and
// refuses posting and minting to one whose standing is not good, and a box
// whose paid-until has passed takes no delivery. What this file adds is that a
// person is never shown a door they cannot walk through. The word on the index
// board and this room both appear only for a device that holds an identity,
// which is a membership that has backed up at least once, which is the only
// moment an identity is minted. That is the whole shape of the club in one
// rule: the device is free, this is not.
//
// Two facts decide every row, and they are independent:
//   capId        you minted them an address on your box. they can write to you.
//   pub and cap  you hold their card. you can write to them, once the mark is
//                read aloud and matched.
// A mark needs both, because it binds both keys and both addresses: binding
// only the keys would leave swapping an address as an undetected way to cut
// two people off from each other.
function renderLetters() {
  const body = $('#lettersBody');
  // The room refuses itself rather than painting an empty one. Nothing routes
  // here without an identity, so this is the belt to the braces above, and it
  // is the sentence a person gets if they arrive by a road nobody has built
  // yet: a bookmark, a keyboard verb, a link from somewhere.
  if (!store.letters.jwk) {
    // Three states and not two, because the second one has been reading the
    // first one's sentence. A shut door cannot be joined, so a room that says
    // `join, back up once, and this room opens` is selling something nobody
    // can buy, which is the rule the how page is already bound to in
    // test/words.test.mjs. And a member who has joined and not yet sealed
    // anything arrived here and read `letters need a membership`, which they
    // have, which they paid for, and which is the one fact about any of this
    // they are certain of. The room asked them for the thing they had already
    // done and stayed silent about the thing they had not, so the backup was
    // left to be guessed at by the person who had just paid to be told.
    //
    // What is actually missing is the identity, and it is minted on the first
    // seal for the reason written at mintIfNone: two keys under one membership
    // is two people. So the law names the backup and the word leads to the room
    // that performs it, and both of them are the stranger's own sentence with
    // the clause this person has already earned taken out of it: `join, then
    // back up once` becomes `back up once`, and the shape they read before
    // paying is the shape they read after, one requirement shorter.
    //
    // The law is one line and has to stay one. It is set at 54px on the desk
    // against a 24ch measure, which fits about twenty-six characters, and the
    // first draft of this ran to thirty-eight: two lines broken after `your
    // first`, stranding an adjective from its noun at display size, which is
    // the fault this repository spent a day sweeping for elsewhere.
    const open = !!clubBase();
    const joined = !!store.settings.clubKey;
    body.innerHTML = `<section class="people-section" aria-labelledby="directConnectionsTitle">
      <h2 class="sec-head" id="directConnectionsTitle">direct connections</h2>
      <div class="corr-empty">
      <p class="ce-law">${joined
    ? 'Back up once to share.'
    : 'Join to share directly.'}</p>
      <p class="ce-how">${joined
    ? 'This creates this device’s secure identity.'
    : open
      ? 'Then back up once to create this device’s secure identity.'
      : 'Direct sharing is not available yet.'}</p>
      ${open ? `<div class="word-row">
        <button class="word-btn" id="lbClub">${joined ? 'back up now' : 'the travellers club'}</button>
      </div>` : ''}
      </div>
    </section>`;
    $('#lbClub')?.addEventListener('click', () => openSurface('clubOverlay', renderClub));
    return;
  }
  const rows = store.letters.pairs.map((p) => {
    const mine = !!p.capId;
    const theirs = !!(p.pub && p.cap);
    const stopped = p.state === PAIRING.withdrawn;
    const connected = maySend(p);
    const said = p.state === PAIRING.repair
      ? 'reply doesn’t match'
      : stopped ? 'removal unfinished'
        : connected ? 'connected'
          : p.state === PAIRING.verified ? 'connection incomplete'
          : mine && theirs ? 'verification needed'
            : theirs ? 'invitation received'
              : 'waiting for reply';
    // At most three, and never more, because a row that offers four ways to
    // act is a row nobody reads. What is possible here is at most two.
    const acts = p.state === PAIRING.repair || stopped ? ''
      : `${!mine ? '<button class="word-btn" data-mint>reply to invitation</button>' : ''}
         ${mine && !theirs ? '<button class="word-btn" data-open>open reply</button>' : ''}
         ${mine && theirs && p.state !== PAIRING.verified ? '<button class="word-btn" data-mark>compare codes</button>' : ''}
         ${maySend(p) ? '<button class="word-btn" data-ask>ask for a place</button>' : ''}`;
    return `<div class="pair-row" data-pid="${esc(p.id)}">
      <div class="pair-head">
        <h3 class="pair-name" contenteditable="plaintext-only" spellcheck="false" role="textbox" aria-multiline="false" aria-label="Name for this person">${esc(p.name)}</h3>
        <span class="pair-said">${said}</span>
      </div>
      <div class="corr-ctl">${acts}
        <button class="word-btn quiet" data-drop>${stopped ? 'finish removal' : p.state === PAIRING.repair ? 'clear' : connected ? 'remove' : mine ? 'cancel' : 'remove'}</button>
      </div>
    </div>`;
  }).join('');
  // What is waiting stands above the people, because it is the only thing here
  // that somebody else did and the only thing that will not wait.
  const post = waitingPost.map((w) => `<div class="pair-row" data-post="${esc(w.id)}">
      <div class="pair-head">
        <h3 class="pair-name">${w.bad ? 'a letter that will not open' : whatArrived(w)}</h3>
        <span class="pair-said">${w.bad ? esc(w.bad) : esc(fmtDate(w.at).toLowerCase())}</span>
      </div>
      <div class="corr-ctl">
        ${w.bad ? '' : '<button class="word-btn" data-read>open it</button>'}
        <button class="word-btn quiet" data-toss>throw away</button>
      </div>
    </div>`).join('');
  body.innerHTML = `<section class="corr-box" aria-labelledby="directConnectionsTitle">
    <h2 class="sec-head" id="directConnectionsTitle">direct connections</h2>
    ${post}
    <p class="cb-how">Connect once, compare a verification code, then send places directly.</p>
    <div class="word-row">
      <button class="word-btn" id="cbStart">invite someone</button>
      <button class="word-btn quiet" id="cbOpen">open invitation</button>
    </div>
    ${rows}
  </section>`;
  wireLetters(body);
}

// The one sentence a letter gets before anybody opens it, and it is a plain
// verb. It read `sent you a place` for every letter of every kind, which was
// true while a place was the only thing that could be sent and became a lie
// the moment three more things could: a heart came back saying somebody had
// sent you a place, and so did a question.
//
// A folio holding one place is a place. That is not a special case bolted onto
// the sentence, it is what the road is: there is no place-shaped payload in
// this protocol, so handing over one place seals a folio holding one, and
// telling its recipient they were sent a folio would be naming the envelope
// instead of the thing inside it.
function whatArrived(w) {
  const who = esc(w.name);
  const k = w.payload?.kind;
  if (k === 'thanks') return `${who} thanked you`;
  if (k === 'ask') return `${who} asked you for a place`;
  if (k === 'atlas') return `${who} sent you an atlas`;
  const places = (w.payload?.places || []).length;
  const rest = (w.payload?.routes || []).length + (w.payload?.books || []).length;
  return places === 1 && !rest ? `${who} sent you a place` : `${who} sent you a collection`;
}

// Names in People look like type because the whole app does, but they are
// fields: the underline and full touch target make that clear, while the
// keyboard follows the single-line field contract. A failed or empty edit
// never leaves an unnamed person painted over a name that is still in storage.
function wirePersonName(el, held, save, afterSave = () => {}) {
  let before = held;
  let cancelled = false;
  const restore = () => { el.textContent = before; };
  el.addEventListener('focus', () => {
    before = el.textContent.trim() || before;
    cancelled = false;
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelled = true;
      restore();
      el.blur();
    }
  });
  el.addEventListener('blur', () => {
    if (cancelled) { cancelled = false; return; }
    const name = el.textContent.trim();
    if (!name) {
      restore();
      toast('a name cannot be empty');
      return;
    }
    if (name === before) return;
    const saved = save(name);
    if (!saved) {
      restore();
      toast('that name could not be saved');
      return;
    }
    before = name;
    afterSave(saved);
  });
}

function wireLetters(body) {
  $$('[data-post]', body).forEach((row) => {
    const id = row.dataset.post;
    row.querySelector('[data-read]')?.addEventListener('click', () => {
      const w = waitingPost.find(x => x.id === id);
      if (w?.payload) openReport(w.payload, { pair: w.pid ? store.pairById(w.pid) : null });
    });
    row.querySelector('[data-toss]').addEventListener('click', () => throwLetterAway(id));
  });
  const start = $('#cbStart', body);
  if (!start) return;
  start.addEventListener('click', handOutIntroduction);
  $('#cbOpen', body).addEventListener('click', async () => {
    const url = await askText('Paste the invitation link you received.', { yes: 'open invitation', placeholder: 'https://resonate.select/#…', max: PASTED_LINK_MAX });
    const t = introIn(url);
    if (t) openIntroReport(t);
    else if (url) toast('that is not an invitation');
  });
  $$('.pair-row', body).forEach((row) => {
    const id = row.dataset.pid;
    const p = () => store.pairById(id);
    wirePersonName(row.querySelector('.pair-name'), p()?.name || '',
      name => store.updatePair(id, { name }));
    row.querySelector('[data-mint]')?.addEventListener('click', () => sendThemMine(id));
    row.querySelector('[data-open]')?.addEventListener('click', async () => {
      const url = await askText(`Paste the reply link from ${p()?.name || 'them'}.`, { yes: 'open reply', placeholder: 'https://resonate.select/#…', max: PASTED_LINK_MAX });
      const t = introIn(url);
      if (t) openIntroReport(t, { onto: p() });
      else if (url) toast('that is not a reply link');
    });
    row.querySelector('[data-mark]')?.addEventListener('click', () => readTheMark(id));
    row.querySelector('[data-ask]')?.addEventListener('click', (e) => askThem(id, e.currentTarget));
    const drop = row.querySelector('[data-drop]');
    drop?.addEventListener('click', async () => {
      drop.disabled = true;
      try { await withdrawFrom(id); }
      finally { if (drop.isConnected) drop.disabled = false; }
    });
  });
}

// ---------- one place, handed to one person ----------
//
// Two roads behind one word, and the word does not change between them: `hand
// it to`. A verified correspondent gets a letter, sealed to their key and
// posted to a box only the club can deliver to. Anybody else gets a link, which
// is what this app has always done and needs no membership at either end.
//
// What travels is a folio of one. There is no place-shaped payload in this
// protocol and there should not be: the recipient of a folio is offered the
// place with a word beside it, which is exactly the gesture, and adding a sixth
// kind would mean a version on the wire for a thing the fifth already carries.
//
// Nothing is written on either side without a press. A letter arriving does not
// put a place in anybody's atlas; it puts a row in a room, and the row opens the
// same report a link opens.

const hexOf = b => [...b].map(v => v.toString(16).padStart(2, '0')).join('');

// A folio of one, built by the one constructor that decides what leaves. The
// tags are only the ones this place wears: an atlas of tags a recipient will
// never see is a disclosure with nothing to show for it.
function placeAsFolio(place, from, { forLink }) {
  if (!mayLeave(place)) return null;
  const wears = new Set(place.tags || []);
  return buildPayload('folio', {
    title: place.name || 'a place',
    dedication: '',
    author: from,
    tags: store.tags.filter(t => wears.has(t.id)),
    places: [place],
    routes: [],
  }, { forLink });
}

function currentShareablePlace(place) {
  // Cross-tab storage events deliberately debounce the expensive repaint, so
  // in-memory state can be a quarter-second old. Every outward place action
  // rereads durable state here and therefore treats an exclusion written by
  // another tab as effective before that tab has had time to repaint.
  if (!loadLatestAtlas()) return null;
  const current = place?.id ? placeById(place.id) : place;
  if (current && mayLeave(current)) return current;
  toast('Excluded from sharing. Choose Include in sharing first.');
  return null;
}

// The link road. Unchanged from every other hand-over in this app, and it is
// the road a person with no club still has.
async function handPlaceOver(place) {
  const current = currentShareablePlace(place);
  if (!current) return false;
  const id = current.id;
  const askedAuthor = await ensureAuthor();
  if (askedAuthor === null) return false;
  const latest = currentShareablePlace({ id });
  if (!latest) return false;
  const from = authorNow();
  const payload = placeAsFolio(latest, from, { forLink: true });
  if (!payload) return false;
  handOver(packPayload(payload), 'the place', {
    title: latest.name || 'a place',
    text: from ? `${from} hands you ${latest.name}` : `${latest.name}, handed to you`,
  });
  return true;
}

// The letter road, and there is one of it. Sealed here, posted with the
// capability that correspondent minted for this device, and refused before it
// travels if it is too big for the box that would have to hold it.
//
// The kind and the payload belong to the caller. Everything else is the same
// for a place, a folio, an ask and a heart: the identity, the recipient's key,
// the id, the number the box will refuse, the sentence a failure gets. Keeping
// it in one function is the whole point of the function. Four copies would be
// four chances for the fourth kind to be sealed a little differently from the
// first three, and the difference would sit in the one part of this app nobody
// can read afterwards.
//
// `payload` may be a thunk, and the reason is the order of two asks. Building
// one costs a byline, and a byline is a question raised over the screen. A
// correspondent this device may not write to must be refused before anybody is
// asked to sign anything for a letter that was never going to leave.
async function sendLetterTo(pair, {
  kind, payload, noun = 'letter', told = (who) => `sent to ${who}`, stillAllowed = null,
}, button) {
  if (!maySend(pair)) { toast('verify the connection first'); return false; }
  const was = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'sealing…'; }
  try {
    const body = typeof payload === 'function' ? await payload() : payload;
    if (body === null) return false;
    const me = await identityFrom(store.letters.jwk);
    const to = await pubFrom(pair.pub);
    const id = newMsgId();
    const wire = await sealLetter({ kind, payload: body, to, from: me, msgId: id.bytes });
    // the client checks the number the box checks, so a letter that cannot be
    // delivered is refused where a person can still do something about it
    if (wire.length > LETTER_LIMITS.bytes) {
      toast(`that ${noun} is too big to send as a letter. hand it over as a link`);
      return false;
    }
    // The payload may have waited for a byline or for cryptography. Check the
    // source record once more immediately before the network call, against
    // durable state, so another tab can withdraw it during either wait.
    if (stillAllowed && !stillAllowed()) return false;
    // The relationship is a second capability boundary. A connection can be
    // withdrawn in another tab while a question, byline, or cryptographic seal
    // is open; never post with a captured capability after that withdrawal.
    if (!loadLatestAtlas()) return false;
    const currentPair = pair?.id ? store.pairById(pair.id) : null;
    const sameKey = currentPair && JSON.stringify(currentPair.pub) === JSON.stringify(pair.pub);
    if (!currentPair || !maySend(currentPair) || currentPair.cap !== pair.cap || !sameKey) {
      toast('This connection changed. Open People and try again.');
      return false;
    }
    await clubClient().postLetter(currentPair.cap, id.text, wire);
    // the sentence belongs to the caller, because there is no one preposition
    // that fits four verbs: a place is sent to somebody and a question is not
    toast(told(pair.name || 'them'));
    return true;
  } catch (e) {
    toast(sentenceForPost(e));
    return false;
  } finally {
    if (button) { button.disabled = false; button.textContent = was; }
  }
}

// An ask, to one person, sealed. The link road is untouched and is still the
// one anybody with no club has; this is the road that needs no clipboard and
// no second app to carry it.
//
// It lives on that person's own row because the row is the only surface in
// this app where `who` has already been answered. Everywhere else an ask would
// have to raise a list of people before it could raise the question, and a
// question asked after a list is a different gesture from a question asked of
// somebody.
//
// The field is bounded at the length the payload keeps. It was bounded at the
// input's default two hundred while buildPayload cut at eighty, so eighty one
// characters through, a person was typing into a field that had already
// stopped listening and said nothing about it.
async function askThem(pid, button) {
  const pair = store.pairById(pid);
  if (!pair) return;
  const q = await askText(`What recommendations would you like from ${pair.name || 'them'}?`,
    { yes: 'send request', placeholder: 'wine bars in lisbon', max: LIMITS.asking });
  if (!q || !q.trim()) return;
  const from = await ensureAuthor();
  if (from === null) return;
  await sendLetterTo(pair, {
    kind: 'ask', noun: 'request', told: (who) => `request sent to ${who}`,
    payload: buildPayload('ask', { from, q: q.trim() }),
    stillAllowed: () => loadLatestAtlas() && authorNow() === from,
  }, button);
}

async function sendPlaceTo(place, pair, button) {
  const current = currentShareablePlace(place);
  if (!current) return false;
  const id = current.id;
  let reviewedPayload = null;
  const gone = await sendLetterTo(pair, {
    kind: 'folio', noun: 'place',
    payload: async () => {
      const askedAuthor = await ensureAuthor();
      if (askedAuthor === null) return null;
      const latest = currentShareablePlace({ id });
      if (!latest) return null;
      reviewedPayload = placeAsFolio(latest, authorNow(), { forLink: false });
      return reviewedPayload;
    },
    stillAllowed: () => {
      const latest = currentShareablePlace({ id });
      if (!latest || !reviewedPayload) return false;
      const current = placeAsFolio(latest, authorNow(), { forLink: false });
      return disclosureFingerprint(current) === disclosureFingerprint(reviewedPayload);
    },
  }, button);
  // the plate closes behind a letter that went, so the next press cannot be
  // the same place sent twice by somebody who did not see the toast
  if (gone) closeSurface('plate');
}

// The row of roads, and it is the same row under every word that hands
// something over: the people this device may write to, and then a link, which
// is the road that needs nobody at either end.
//
// With nobody verified there is nothing to choose between, so the row is never
// raised and the link goes at once. That is not a shortcut, it is the rule the
// plate has always followed: a word that opens onto a list of one road is a
// word that asked a question with one answer.
function roadsUnder(row, { onPerson, onLink }) {
  const people = store.letters.pairs.filter(maySend);
  if (!people.length) return void onLink();
  const was = row.hidden;
  // At most one road row is ever open. A plate carries two of them, under two
  // different words, and they are the same three names in the same type: with
  // both open, `Marta` appeared twice on one plate and neither copy said which
  // word it was answering. Pressing either word now closes the other.
  $$('.road-row').forEach((r) => { r.hidden = true; r.innerHTML = ''; });
  if (!was) return;
  row.innerHTML = `${people.map(p => `<button class="word-btn" data-to="${esc(p.id)}">${esc(p.name || 'them')}</button>`).join('')}
      <button class="word-btn quiet" data-link>a link</button>`;
  row.hidden = false;
  $$('[data-to]', row).forEach((b) => b.addEventListener('click', () => {
    const p = store.pairById(b.dataset.to);
    if (p) onPerson(p, b);
  }));
  $('[data-link]', row).addEventListener('click', () => onLink());
}

// The club speaks in prose and the network does not speak at all: a fetch that
// never left the device rejects with a TypeError nobody here wrote. Both become
// one sentence, so a person is never shown a browser's word for a thing this
// app could have named.
function sentenceForPost(e) {
  const said = String(e?.message || '');
  if (e instanceof TypeError || /fetch|network/i.test(said)) return 'the club could not be reached';
  if (said === 'again') return 'that letter is already in their box';
  if (/fresh introduction|introduction has been withdrawn/i.test(said)) {
    return 'this connection no longer works. ask them to connect again';
  }
  return said || 'the club did not answer';
}

// ---------- the post: letters that have arrived ----------
//
// What is waiting is held here for the visit and nowhere else. The club is the
// copy that survives a closed tab, which is what the box is for, and a letter
// stays in it until the person throws it away. So there is no local slice full
// of other people's places to keep in step with a server, and no letter of any
// size competing for the same storage an atlas lives in.
//
// The one thing written down is the id of a letter already dealt with, and the
// order it is written in is the whole of the transaction: the ledger first, the
// club's copy second. A refused write leaves the letter where it is, and a
// person sees it once more rather than never again.
let waitingPost = [];
let lookingInTheBox = false;

// Who could have written this, by the fingerprint on the outside. Built once
// per look rather than per letter, so a box of fifty costs one pass over the
// correspondents instead of fifty.
async function correspondentsByKid() {
  const by = new Map();
  for (const p of store.letters.pairs) {
    // A returned introduction gives us enough key material to attempt an
    // authenticated open, but not enough authority to accept its contents.
    // The same maySend policy gates both directions of correspondence.
    if (!maySend(p)) continue;
    try {
      const pk = await pubFrom(p.pub);
      by.set(hexOf(await keyId(pk)), { pair: p, pk });
    } catch { /* a stored key of a shape this build cannot read names nobody */ }
  }
  return by;
}

// One letter, read or refused, and a refusal is a row rather than a silence. A
// letter that will not open is the one thing a person cannot debug and must
// still be able to clear, so it keeps its id and offers the word that throws it
// away.
async function readOneLetter(bytes, meta, who, me) {
  const spoiled = (why, name = '') => ({ id: meta.id, at: meta.at, name, bad: why });
  const indexed = who.get(senderOf(bytes));
  if (!indexed) return spoiled('not from a connected person');
  // The map is built before the network reads. Recheck the live pairing so a
  // withdrawal or repair during that await cannot race one last letter open.
  const found = store.pairById(indexed.pair.id);
  if (!maySend(found) || found.pub !== indexed.pair.pub) {
    return spoiled('not from a connected person', indexed.pair.name || '');
  }
  const name = found.name || 'someone';
  try {
    const opened = await openLetter(bytes, { me, from: indexed.pk });
    // Authenticated opening is asynchronous. Consent can be withdrawn while
    // HPKE is working, so the authority checked before it began must still be
    // the authority in hand before any plaintext is returned to a surface.
    const current = store.pairById(indexed.pair.id);
    if (!maySend(current) || current.pub !== indexed.pair.pub) {
      return spoiled('sender is no longer connected', current?.name || name);
    }
    // The id the club filed it under and the id inside the sealed header must
    // be the same sixteen bytes. They can differ only if the sender quoted one
    // id and sealed another, and the ledger keys on the club's, so a mismatch
    // would let one letter be thrown away and another arrive in its place.
    if (opened.msgId !== meta.id) return spoiled('filed under a name that is not its own', name);
    const payload = normPayload(opened.payload);
    if (!payload) return spoiled('it opened onto nothing this app can read', name);
    return { id: meta.id, at: meta.at, pid: current.id, name: current.name || name, state: current.state, payload };
  } catch (e) {
    return spoiled(String(e?.message || 'it will not open'), name);
  }
}

// The box, looked in. Quiet by default, because this runs at boot and on every
// return to the tab, and an app that announces an empty box four times a visit
// has taught its owner to ignore it.
async function lookInTheBox({ loud = false } = {}) {
  if (lookingInTheBox) return;
  if (!store.letters.jwk || !clubBase() || !store.settings.clubKey) return;
  if (!navigator.onLine) return void (loud && toast('this device is offline'));
  lookingInTheBox = true;
  try {
    const c = clubClient();
    const box = await c.box();
    const held = new Set(waitingPost.map(w => w.id));
    const fresh = box.letters.filter(l => !held.has(l.id) && !store.finishedWith(l.id));
    if (!fresh.length) return void (loud && toast('nothing waiting'));
    const who = await correspondentsByKid();
    const me = await identityFrom(store.letters.jwk);
    let came = 0;
    for (const l of fresh) {
      const got = await c.letter(l.id).catch(() => null);
      // gone between the list and the read is not an error: another device of
      // theirs, or another tab of this one, dealt with it first
      if (!got) continue;
      waitingPost.push(await readOneLetter(got.bytes, l, who, me));
      came += 1;
    }
    if (!came) return;
    if (!surfaceEl('contactsOverlay').hidden) renderContacts();
    const one = came === 1 ? waitingPost[waitingPost.length - 1] : null;
    toast(one && !one.bad ? `${one.name} sent you something` : `${came} letters waiting`, 7000,
      { word: 'letters', run: showContacts });
  } catch (e) {
    if (loud) toast(sentenceForPost(e));
  } finally {
    lookingInTheBox = false;
  }
}

// Done with one letter. The ledger is written before the club's copy is
// deleted, and a refused write stops the whole act: a device that cannot
// remember it dealt with this letter must not destroy the only other record
// that it exists.
async function throwLetterAway(id) {
  if (!store.finishWith(id)) return toast('this browser refused to write it down, so nothing was deleted');
  waitingPost = waitingPost.filter(w => w.id !== id);
  renderLetters();
  try { await clubClient().dropLetter(id); } catch { /* the ledger already holds it; the box tidies next look */ }
}

// An introduction out of a pasted link, or nothing. It is read through the same
// gate the hash router uses, because a link a person pastes has been through a
// mail client, a chat app and a clipboard, and none of those is this app.
function introIn(url) {
  const s = String(url || '');
  const at = s.indexOf('#m=');
  if (at < 0) return null;
  const t = readPayload(s.slice(at + 3));
  return t && t.kind === 'intro' ? t : null;
}

// Your own address, learned from your own capability. The route half of every
// capability this club mints for you is your box, so there is no second call to
// make and no second answer that could disagree with this one.
function noteMyRoute(cap) {
  const route = routeOf(cap);
  if (route) store.noteRoute(route);
  return route;
}

// The mark, recomputed from what is held right now rather than remembered from
// when it was first shown. It is stored so a row can be drawn without waiting
// for a digest, and it is written only when it has changed.
async function refreshMark(id) {
  const p = store.pairById(id);
  if (!p) return '';
  const mark = await markOf(
    { pub: store.letters.pub, route: store.letters.route },
    { pub: p.pub, route: routeOf(p.cap) });
  if (mark !== p.mark) store.updatePair(id, { mark });
  return mark;
}

// Going first. A capability is minted for this one person and nobody else, and
// the row is written down before the link leaves, so an address handed out is
// always an address that can be withdrawn. If the store refuses the row the
// capability is dropped again: a secret at the club that this device has no
// record of is an open door with no handle on this side.
async function handOutIntroduction() {
  const name = await askText('Who would you like to connect with? Their name stays on this device.',
    { yes: 'create invitation', placeholder: 'their name' });
  if (!name) return;
  const askedAuthor = await ensureAuthor();
  if (askedAuthor === null) return;
  let made;
  try { made = await clubClient().mintCap(); }
  catch (e) { return toast(e.message === 'the membership has lapsed' ? 'renewing lets you exchange again' : 'the club did not answer'); }
  if (!loadLatestAtlas()) {
    try { await clubClient().dropCap(made.id); } catch { /* no local row points at it */ }
    return;
  }
  const from = authorNow();
  noteMyRoute(made.cap);
  const p = store.addPair({ name, capId: made.id, state: PAIRING.introduced });
  if (!p) {
    try { await clubClient().dropCap(made.id); } catch { /* the row is what matters, and there is none */ }
    return toast('this browser refused to keep them, so nothing was handed out');
  }
  renderLetters();
  const handed = await handOver(makeIntroUrl({ from, pub: store.letters.pub, cap: made.cap }), 'the invitation', {
    title: 'connect on resonate',
    text: `${from || 'Someone'} would like to exchange private recommendations with you.`,
  });
  if (handed !== 'cancelled') return;

  // A canceled system sheet handed the capability to nobody. Record the safe
  // state before asking the club to revoke it, so a closed tab can never come
  // back calling an unfinished cancellation an active invitation.
  if (!store.updatePair(p.id, { state: PAIRING.withdrawn })) {
    return toast('the invitation was not sent, but this browser could not cancel it. use cancel on its row to try again', 8000);
  }
  renderLetters();
  try { await clubClient().dropCap(made.id); }
  catch { return toast('the invitation was not sent. finish removing it when the club is reachable', 8000); }
  if (!store.removePair(p.id)) return toast('the invitation is cancelled, but this browser could not clear its row');
  renderLetters();
  toast('invitation cancelled');
}

// Answering, or going first at somebody who went first at you. Same act either
// way: mint them an address of their own, and hand over the card that says
// where to post and which key to seal to.
async function sendThemMine(id) {
  const p = store.pairById(id);
  if (!p || p.capId) return;
  const askedAuthor = await ensureAuthor();
  if (askedAuthor === null) return;
  let made;
  try { made = await clubClient().mintCap(); }
  catch (e) { return toast(e.message === 'the membership has lapsed' ? 'renewing lets you exchange again' : 'the club did not answer'); }
  if (!loadLatestAtlas()) {
    try { await clubClient().dropCap(made.id); } catch { /* no local row points at it */ }
    return;
  }
  const from = authorNow();
  noteMyRoute(made.cap);
  const before = { capId: p.capId, mark: p.mark, state: p.state };
  if (!store.updatePair(id, { capId: made.id })) {
    try { await clubClient().dropCap(made.id); } catch { /* as above */ }
    return toast('this browser refused to write it down, so nothing was handed out');
  }
  await refreshMark(id);
  renderLetters();
  const handed = await handOver(makeIntroUrl({ from, pub: store.letters.pub, cap: made.cap }), 'your reply', {
    title: 'connect on resonate',
    text: `${from || 'Someone'} would like to exchange private recommendations with you.`,
  });
  if (handed !== 'cancelled') return;

  try { await clubClient().dropCap(made.id); }
  catch { return toast('your reply was not sent. remove this setup and try again when the club is reachable', 8000); }
  if (!store.updatePair(id, before)) return toast('your reply was cancelled, but this browser could not restore the invitation');
  renderLetters();
  toast('reply cancelled');
}

// The mark, read aloud. This is the whole of the trust and there is no second
// mechanism behind it: a name matching authorises nothing, because a name is
// what an impostor picks first.
async function readTheMark(id) {
  const p = store.pairById(id);
  if (!p) return;
  const mark = await refreshMark(id);
  if (!mark) return toast('reply to the invitation before comparing codes');
  const word = await ask(
    `Compare this code with ${p.name}, on a call or in person. Matching codes confirm that the connection is private. If they differ, do not continue.`,
    { said: mark, yes: 'codes match', no: 'not yet' });
  if (word !== true) return;
  // The version goes down beside the state, because what is being recorded is
  // not that this pairing is trusted but that a mark of this arithmetic was
  // read aloud. The day the arithmetic moves, that is the difference between a
  // pairing that has to read again and one that quietly does not.
  if (!store.updatePair(id, { state: PAIRING.verified, v: PAIRING_VERSION })) {
    return toast('this browser refused to write it down');
  }
  renderLetters();
  toast(`${p.name} is connected. you can send places directly`);
}

// Withdrawing takes back the address, and takes back nothing else. Letters
// already in the box are the recipient's, and revoking has never been a way to
// unsend. It cannot be undone because the secret is gone from the club, and the
// word says so before it is pressed.
async function withdrawFrom(id) {
  const p = store.pairById(id);
  if (!p) return;
  const held = !!p.capId;
  const finishing = p.state === PAIRING.withdrawn;
  const connected = maySend(p);
  const repair = p.state === PAIRING.repair;
  if (!finishing) {
    const question = connected
      ? `Remove the connection with ${p.name}? ${held ? 'They will no longer be able to send you anything. Anything already sent stays. ' : ''}Connecting again later requires a new invitation and verification code.`
      : repair
        ? `Clear ${p.name} and start again? ${held ? 'Their link to you will stop working. ' : ''}The details that did not match will not be used.`
        : held
          ? `Cancel setup with ${p.name}? Their link to you will stop working. Starting again requires a new invitation.`
          : `Remove the invitation from ${p.name}? You can connect again later with a new invitation.`;
    const yes = connected ? 'remove' : repair ? 'clear and start again' : held ? 'cancel setup' : 'remove invitation';
    const no = connected ? 'keep connection' : 'keep it';
    if (!await ask(question, { yes, no, danger: true })) return;
  }

  // Persist the tombstone before the network call. If the tab closes after
  // this write, the next visit offers only “finish removal”; it never paints a
  // remotely revoked capability as connected. A failed revoke rolls the state
  // back when storage permits, while a restored tombstone simply retries.
  if (held) {
    if (!finishing && !store.updatePair(id, { state: PAIRING.withdrawn })) {
      return toast('this browser could not begin removing it, so nothing changed');
    }
    renderLetters();
    try { await clubClient().dropCap(p.capId); }
    catch {
      const restored = !finishing && !!store.updatePair(id, { state: p.state });
      renderLetters();
      return toast(restored
        ? 'the club did not answer, so the connection was kept'
        : 'removal is unfinished. try again when the club is reachable');
    }
  }
  if (!store.removePair(id)) return toast('this browser refused to remove them');
  renderLetters();
  toast(connected ? `connection with ${p.name} removed`
    : repair ? `${p.name} cleared. create a new invitation to start again`
      : `setup with ${p.name} removed`);
}

// Letters, showing what it holds now. An introduction arrives both from outside
// the room and from a button inside it, and openSurface returns without a word
// when the surface is already up: a row written while the room was open would
// otherwise be a row nobody saw until they closed it and opened it again.
// One room, two sections, and the first exists only for a device that can
// actually write to somebody: a member who has backed up once, which is the
// moment an identity is minted. For everybody else this room is exactly what
// voices was, which is what it should be, because a person who cannot write to
// anybody is never shown a surface that says they can.
//
// The sections keep their own painters and their own ids, so nothing about
// what either one draws has changed. What changed is that there is one way in.
function renderContacts({ explain = false } = {}) {
  const post = $('#lettersBody');
  // `explain` is the one case where a device that cannot write to anybody is
  // shown the post section anyway, and it is not an upsell because it is not
  // offered: it is only reached by somebody who typed the word `letters`. The
  // reasoning under the verb table has held since letters existed, that a verb
  // which refuses to exist teaches a person they typed the wrong thing while a
  // room that says what it needs teaches them what this is. Merging the rooms
  // nearly deleted that sentence by accident. Nobody who pressed `contacts`
  // asked what a letter is, so nobody who pressed `contacts` is told.
  //
  // Three states, and the middle one has been reading the outer one's silence.
  // That argument is about a stranger and it was being applied to a member. A
  // person who has joined and has not sealed anything holds no identity yet,
  // so this painted nothing into the post section and handed them the room
  // voices used to be: `copy my atlas link`, `open one sent to me`, and not one
  // word about the thing they had just paid for. It is the same fault the index
  // board's own comment records against the old split, one room further in: the
  // section that says what direct exchange is, invisible to somebody who had
  // already bought it. Merging the rooms moved the word and left this line
  // where it was.
  //
  // So the gate is the membership rather than the identity. A stranger still
  // reads nothing here, which is the sentence above kept whole. A member reads
  // `letters need a backup`, which is true, which is one press away, and which
  // renderLetters has been able to say since the day it was written with
  // nothing in the app routing anybody to it.
  if (store.letters.jwk || store.settings.clubKey || explain) renderLetters();
  else if (post) post.innerHTML = '';
  renderVoices();
}

function showContacts({ explain = false } = {}) {
  const paint = () => renderContacts({ explain });
  if (surfaceEl('contactsOverlay').hidden) openSurface('contactsOverlay', paint);
  else paint();
  // and asks the box while the room is being painted, because opening this
  // room is a person saying they want to know.
  //
  // Nothing pushes and there is no timer, on purpose, so this ask is the whole
  // difference between a room that is current and a room showing what was
  // waiting the last time the tab came back. The verb table used to open the
  // surface directly and skip it, and two browser tests passed anyway because
  // the boot look four seconds in landed after the letter on a fast machine.
  // On a slow one it landed before, and the room stayed empty.
  lookInTheBox();
}

// An introduction, opened. It arrives two ways and this is both of them: a link
// tapped anywhere, which lands through the hash router, and a link pasted onto
// a row that is waiting for exactly this one.
//
// The severe branch is `repair`. A pairing whose key or whose address has moved
// is the exact shape of somebody standing in between, so nothing is adopted:
// the row says what happened and the only way on is a fresh introduction, read
// aloud again. Quietly taking the new card would be the whole attack.
async function openIntroReport(t, { onto = null } = {}) {
  clearShareHash();
  if (!store.letters.jwk) {
    return toast('join the club and make your first backup before connecting with someone', 7000);
  }
  if (t.pub === store.letters.pub) return toast('that invitation is your own');

  // A key outranks a row. If some row already holds this key then that row is
  // this person, whichever row the button was pressed on: a person is their key
  // here and never their name, and two rows under one key is one correspondent
  // who cannot tell which of them is them.
  let target = store.pairByPub(t.pub) || onto || null;
  if (!target) {
    // A person who went first has a row waiting with no key on it, and only
    // they can say which row this belongs to. One waiting row can be named in
    // the question; several cannot, and the honest answer is to send them to
    // the row rather than to guess on their behalf.
    const waiting = store.letters.pairs.filter(p => p.capId && !p.pub);
    if (waiting.length === 1) {
      const word = await ask(`${t.from || 'Someone'} sent this link. Is it ${waiting[0].name}’s reply?`,
        { yes: `yes, from ${waiting[0].name}`, also: 'no, a new invitation', no: 'not now' });
      if (word === true) target = waiting[0];
      else if (word !== 'also') return;
    } else if (waiting.length > 1) {
      if (!await ask(`${t.from || 'Someone'} sent this link. If it is a reply, add it from that person’s row so Resonate can match it safely.`,
        { yes: 'it is a new invitation', no: 'not now' })) return;
    }
  }

  const next = onIntroduction(target, { pub: t.pub, cap: t.cap });
  if (next === PAIRING.repair) {
    store.updatePair(target.id, { state: PAIRING.repair });
    showContacts();
    return toast(`${target.name || 'that person'} sent different connection details. for safety, nothing changed. clear this connection in People and start again`, 11000);
  }

  if (target) {
    if (!store.updatePair(target.id, { pub: t.pub, cap: t.cap, state: next })) {
      return toast('this browser refused to write it down');
    }
  } else {
    target = store.addPair({ name: t.from || 'someone', pub: t.pub, cap: t.cap, state: next });
    if (!target) return toast('this browser refused to keep them');
  }
  await refreshMark(target.id);
  showContacts();
  const p = store.pairById(target.id);
  toast(p.state === PAIRING.withdrawn
    ? `this connection was removed. finish removing it before connecting again`
    : maySend(p)
      ? `${p.name} is already connected`
      : p.state === PAIRING.verified
        ? `this connection is incomplete. remove it and start again`
        : p.capId
          ? `${p.name} replied. compare your codes to connect`
          : `${p.name} invited you. reply to their invitation to continue`, 8000);
}

function renderVoices() {
  const body = $('#corrBody');
  const doors = `<div class="word-row people-doors">
    <button class="word-btn" id="ceShare">share my atlas</button>
    <button class="word-btn quiet" id="ceImport">open atlas link</button>
  </div>`;
  const openAtlasLink = async () => {
    const url = await askText('Paste the atlas link you received.', {
      yes: 'open atlas', placeholder: 'https://resonate.select/#…', max: PASTED_LINK_MAX,
    });
    if (!url) return;
    // Everything this app mints carries `#m=`, so the test was the right one
    // and this door is wider than its word: a folio, an ask or an
    // introduction pasted here opens too, which is a kindness. What was
    // missing is the other half. Anything else closed the dialog and said
    // nothing at all, and the door one room over already answers `that is
    // not an introduction`. Silence is the one answer a door must not give.
    //
    // The payload is read here rather than trusted, through the same gate the
    // hash router uses, because a link cut short by a mail client still holds
    // `#m=` and used to be answered with a reload onto nothing.
    const at = url.indexOf('#m=');
    if (at < 0) return toast('That is not a Resonate link.');
    if (!readPayload(url.slice(at + 3))) return toast('That link is incomplete. Ask for it again.');
    location.href = url.slice(at);
    location.reload();
  };

  if (!store.correspondents.length) {
    body.innerHTML = `<section class="people-section" aria-labelledby="followedAtlasesTitle">
      <h2 class="sec-head" id="followedAtlasesTitle">atlases you follow</h2>
      <div class="corr-empty">
        <p class="ce-law">Share your atlas with someone you trust.</p>
        <p class="ce-how">Open theirs here to compare your tastes and explore what they recommend.</p>
        ${doors}
      </div>
    </section>`;
    $('#ceShare').addEventListener('click', shareMap);
    $('#ceImport').addEventListener('click', openAtlasLink);
    return;
  }
  const rows = store.correspondents.map(c => {
    const r = resonance(myAtlas(), corrShaped(c));
    const ev = evidenceLines(r, c.name);
    const sig = mapView.sigAngle(c.id);
    return `<details class="corr-row" data-cid="${esc(c.id)}" ${store.correspondents.length === 1 ? 'open' : ''}>
      <summary class="corr-summary">
        <svg class="corr-glyph" width="34" height="34" viewBox="0 0 30 30" style="--sig:${sig}deg">
          <circle class="corr-arcs" cx="15" cy="15" r="9" pathLength="360"/>
          <circle class="corr-pole" cx="15" cy="15" r="1.8"/>
        </svg>
        <span class="corr-summary-copy">
          <span class="corr-summary-name">${esc(c.name)}</span>
          <span class="corr-meta">${c.places.length} shared place${c.places.length === 1 ? '' : 's'}</span>
        </span>
        <span class="corr-more" aria-hidden="true"></span>
      </summary>
      <div class="corr-detail">
        <div class="corr-edit"><span class="sec-head">name</span><h3 class="corr-name" contenteditable="plaintext-only" spellcheck="false" role="textbox" aria-multiline="false" aria-label="This person's name">${esc(c.name)}</h3></div>
        <div class="corr-places">${commonPlaces(r, c.name)}</div>
        <div class="corr-ev">${(r.common.length ? ev.slice(1) : ev).map(l => `<div>${l}</div>`).join('')}</div>
        <div class="corr-ctl">
          ${c.visible === false ? '<button class="word-btn quiet" data-vis>show on my map</button>' : ''}
          <button class="word-btn quiet" data-part>remove person</button>
        </div>
      </div>
    </details>`;
  }).join('');
  body.innerHTML = `<section class="people-section" aria-labelledby="followedAtlasesTitle">
    <h2 class="sec-head" id="followedAtlasesTitle">atlases you follow</h2>
    ${doors}
    <div class="people-list">${rows}</div>
  </section>`;
  $('#ceShare').addEventListener('click', shareMap);
  $('#ceImport').addEventListener('click', openAtlasLink);

  $$('.corr-row', body).forEach(row => {
    const id = row.dataset.cid;
    const c = store.correspondents.find(x => x.id === id);
    row.addEventListener('toggle', () => {
      if (!row.open) return;
      $$('.corr-row', body).forEach(other => { if (other !== row) other.open = false; });
    });
    // and pressing a place stands on it. every pair in the common ground has a
    // copy of mine, so the name leads home rather than into somebody else's
    // list.
    row.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => {
      closeSurface('contactsOverlay');
      closeSurface('indexOverlay');
      selectPlace(b.dataset.pid, { fly: true });
    }));
    wirePersonName(row.querySelector('.corr-name'), c.name,
      name => store.updateCorrespondent(id, { name }), () => renderAll());
    // Two words stood here and only one of them was an act a person needed.
    // Hiding a voice and removing one are not the same thing, but the first
    // was a preference nobody expressed twice, and a row that offers two ways
    // to make somebody disappear makes the reader choose between them before
    // reading anything else. What is left is the act: remove the voice, keep
    // every place you adopted from them.
    //
    // The word comes back for a voice that is already hidden, because an atlas
    // carried over from a build that could hide one must have a way to undo it.
    // Nothing can put a voice into that state now.
    row.querySelector('[data-vis]')?.addEventListener('click', () => {
      store.updateCorrespondent(id, { visible: true });
      pushCorrespondentsToMap();
      renderVoices();
    });
    // Parting was named for something mutual and did something unilateral: it
    // is one person deleting one local record, and nothing of it reaches the
    // other. The word names the act now, in the app's own verb, and the
    // sentence says everything that goes rather than the two things that stay.
    //
    // And it can be undone, like removing a place. Their id comes back with
    // them, because the signature angle a voice wears on the field is drawn
    // from it: a voice restored under a fresh id would come back wearing
    // somebody else's mark.
    row.querySelector('[data-part]').addEventListener('click', async () => {
      const n = c.places.length;
      if (!await ask(`Remove ${c.name} from People? Their ${n} shared place${n === 1 ? '' : 's'} will leave your map, along with this comparison. Places you saved stay in your atlas and still say “after ${c.name}”.`,
        { yes: 'remove them', no: 'keep them', danger: true })) return;
      const gone = { ...c };
      if (!store.removeCorrespondent(id)) return toast('this browser refused to remove them');
      // The exchange is offered once per name, and the offer was spent for
      // good: a person removed and kept again years later arrived with the one
      // thing this app is for already crossed off. Removing them gives the
      // offer back, and taking the removal back takes the offer away again.
      const key = c.name.trim().toLowerCase();
      const spent = (store.settings.answered || []).includes(key);
      if (spent) {
        store.settings.answered = (store.settings.answered || []).filter(n => n !== key);
        store.saveSettings();
      }
      pushCorrespondentsToMap();
      renderVoices();
      toast(`${c.name} is no longer in People`, 9000, { word: 'take it back', run: () => {
        if (!store.restoreCorrespondent(gone)) return toast('this browser refused to take it back');
        if (spent) {
          store.settings.answered = [...(store.settings.answered || []), key];
          store.saveSettings();
        }
        pushCorrespondentsToMap();
        renderVoices();
        toast('back where they were');
      } });
    });
  });
}

// ---------- the resonance report ----------

// a visit ends by putting the borrowed marks away, not by reloading
// A visit ends two ways and only one of them is leaving.
//
// The bar's own word puts the borrowed marks away and gives the field back.
// The word beside it raises the letter again, which also ends the visit but
// must not clear the hash the letter is read from, must not refit a field the
// report is about to cover, and must not say that anything was put away. What
// both ways share is here.
function endVisit() {
  state.visiting = null;
  $('#visitBar').hidden = true;
  mapView.holdCorrMarks(false);
  pushCorrespondentsToMap();
}

function leaveVisit() {
  const example = state.visiting?.example;
  endVisit();
  clearShareHash();
  applyWorldState();
  renderAll();
  if (store.places.length) mapView.fitAll(store.places);
  else if (store.routes.length || store.books.length) openIndex();
  toast('preview closed. Your atlas is unchanged');
  if (example && !store.settings.chosen) openThreshold();
}

// leaving a report opens the atlas it was offered to, rather than reloading
// the page out from under the reader
// The strongest loop this app has is not publishing. It is: someone sends
// you places, you keep two, and you send three back. The ask is bounded on
// purpose. Three is a kindness; an open request is a chore.
function askForThree(author) {
  if (!author || author === 'no byline') return false;
  const asked = new Set(store.settings.answered || []);
  const key = author.toLowerCase();
  if (asked.has(key)) return false;
  // Raised only where three can actually be answered with. The gate read
  // `private` alone, so an atlas of loans, which is what the app's own first
  // suggestion leaves a person holding, was offered the exchange and spent its
  // one offer per correspondent before finding out it could hand over nothing.
  // The same two words the doors read, and the same refusal on a way whose
  // ends cannot be hidden, because a row that cannot arrive cannot be one of
  // the three.
  if (sharablePlaces().length + sharableRoutes().length < 3) return false;

  const bar = $('#answerBar');
  $('#answerWho').textContent = `answer with three, for ${author}`;
  const close = () => {
    bar.onkeydown = null;
    dropDialog(bar);
    store.settings.answered = [...asked, key];
    store.saveSettings();
  };
  $('#answerGo').onclick = () => {
    close();
    openFolioComposer({
      fresh: true, cap: 3,
      title: `three for ${author}`,
      dedication: `after yours`,
    });
  };
  $('#answerNo').onclick = close;
  bar.onkeydown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  raiseDialog(bar);
  return true;
}

function leaveReport(el, author = '') {
  clearShareHash();
  dropDialog(el);
  if (author && askForThree(author)) return;
  applyWorldState();
  state.visiting = null;
  mapView.holdCorrMarks(false);
  pushCorrespondentsToMap();
  renderAll();
  if (store.places.length || store.routes.length) {
    mapView.fitAll([...store.places, ...store.routes.flatMap(r => r.path)]);
    toast('your atlas');
  } else if (store.books.length) {
    openIndex();
    toast('your atlas');
  } else if (!store.settings.chosen) {
    openThreshold();
  } else {
    toast('your atlas is empty. Search or add below, or press and hold the map');
  }
}

// Putting a letter down is not the same as being thrown out of it.
//
// `leave` runs leaveReport, which opens the threshold for anyone who has not
// chosen yet. `close` did four fifths of that and stopped: it dropped the
// letter, cleared the hash it was read from, and left a first-time reader on
// an empty world holding two words, find or add and a question mark, with no
// copy of what was sent and nothing anywhere saying what this is. The word in
// the corner is the largest one on the surface, so it is the one a newcomer
// presses. It takes the same road now, and so does escape.
//
// Only for a reader who has not chosen. Anybody with an atlas behind the
// letter is put back on it, which is what close has always meant to them.
function closeReport() {
  dropDialog($('#reportOverlay'));
  applyWorldState();
  clearShareHash();
  if (!store.settings.chosen) openThreshold();
}

// ---------- a second collection from the same person ----------
//
// A voice used to be a snapshot nobody could update: a friend's second atlas
// made a second friend, and a folio never reached the shelf at all. Now the
// shelf is asked first. The same person is found by the name a handover
// carries, their places are matched by the ids that travel in every payload
// and by the same-place test the resonance engine already trusts, and
// nothing is ever removed by an arrival: an atlas may replace the slice
// whole, because an atlas is the whole of what a person hands over, and a
// folio only adds, because a folio is a gift and not a census.
function voiceByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return store.correspondents.find(c => c.name.trim().toLowerCase() === n) || null;
}

// ---------- a name is a door ----------
//
// Voices is the one surface where a person is whole: their places, the ground
// you share, the day they arrived. Every other surface said a name in passing,
// and saying it was all it did. A name pressed now opens voices and stands on
// that row.
//
// Only when exactly one voice answers to the name. Two people may hold one
// name here on purpose, because keeping both is offered by name when a second
// atlas arrives, and provenance carries nothing that tells them apart. A door
// that might open on the wrong person is worse than no door, so where the name
// is ambiguous it stays prose.
function soleVoiceNamed(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const hits = store.correspondents.filter(c => c.name.trim().toLowerCase() === n);
  return hits.length === 1 ? hits[0] : null;
}

// The markup for one of those doors, or the plain name when nothing answers.
function nameDoor(name) {
  return soleVoiceNamed(name)
    ? `<button class="name-door" data-voice="${esc(name)}">${esc(name)}</button>`
    : esc(name);
}

// Every surface that prints a name binds this one line.
function bindNameDoors(root, { dialog = null } = {}) {
  $$('[data-voice]', root).forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    showVoice(b.dataset.voice, { dialog });
  }));
}

function showVoice(name, { dialog = null } = {}) {
  const c = soleVoiceNamed(name);
  if (!c) return false;
  // a letter stands above every poster, so it comes down before the shelf
  // behind it can be seen at all
  if (dialog) { clearShareHash(); dropDialog(dialog); applyWorldState(); }
  closeSurface('plate');
  openSurface('contactsOverlay', renderContacts);
  standOnVoice(c.id);
  return true;
}

function standOnVoice(id) {
  const box = surfaceEl('contactsOverlay');
  const row = $$('.corr-row', box).find(r => r.dataset.cid === id);
  if (!row) return;
  row.open = true;
  // offsetTop, not scrollIntoView: the poster body is mid-animation on the
  // press that opens it, and a transform is not a layout the engines agree
  // how to scroll to. offsetTop is layout, and it is simply true afterwards.
  box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 3);
  row.setAttribute('tabindex', '-1');
  row.focus({ preventScroll: true });
  row.classList.add('sought');
  setTimeout(() => row.classList.remove('sought'), 1800);
}

// merge a letter's slice into a held voice: additions and refreshed copies,
// never a removal. returns what changed, so the toast can say the number.
function absorbIntoVoice(voice, theirs) {
  const places = voice.places.map(p => ({ ...p }));
  const byId = new Map(places.map(p => [p.id, p]));
  let added = 0;
  for (const p of theirs.places) {
    const hit = byId.get(p.id) || places.find(h => samePlace(h, p));
    if (hit) {
      // the letter's copy is newer than the shelf's: the note they wrote
      // for this folio, the word they moved. the held id stays.
      Object.assign(hit, { ...newPlace({ ...p }), id: hit.id });
    } else {
      const kept = newPlace({ ...p });
      places.push(kept);
      byId.set(kept.id, kept);
      added += 1;
    }
  }
  const tagIds = new Set(voice.tags.map(t => t.id));
  const tagNames = new Set(voice.tags.map(t => t.name.trim().toLowerCase()));
  const tags = [...voice.tags];
  for (const t of theirs.tags) {
    if (tagIds.has(t.id) || tagNames.has(t.name.trim().toLowerCase())) continue;
    tags.push(newTag(t));
  }
  return { places, tags, added };
}

// `came` is what is known about how this arrived, and it is empty for every
// road but one. A folio that came as a letter was opened with a key, so the
// person who sealed it is known exactly rather than by the byline they typed,
// and the heart beside a place in it can go back the way the folio came.
// Nothing else in a report needs it and nothing else is given it.
function openReport(payload, came = {}) {
  if (payload.kind === 'folio') return openFolioReport(payload, came);
  if (payload.kind === 'ask') return openAskReport(payload, came);
  if (payload.kind === 'thanks') return openThanksReport(payload);
  if (payload.kind === 'intro') return openIntroReport(payload);
  return openAtlasReport(payload);
}

// ---------- a heart arrives ----------
//
// The smallest payload this app carries, and the one that closes its loop: a
// friend was handed places, went, and came back to say one of them was worth
// the going. No overlay and no report; the field itself answers. The place is
// found, the heart settles onto the plate, and the record keeps who and when.
//
// Finding it: by the id the record wears here, which the thanks carries as
// pid when the road preserved it; then by name near the point; then by the
// point alone. A heart that lands on the wrong record would be worse than one
// that does not land, so the point-only match is tight.
function openThanksReport(t) {
  clearShareHash();
  const lower = t.name.trim().toLowerCase();
  const near = (p) => t.at && haversineKm(p, t.at) < 0.15;
  const match = (t.pid && placeById(t.pid))
    || allPlaces().find(p => p.name.trim().toLowerCase() === lower && (t.at ? near(p) : true))
    || (t.at ? allPlaces().find(near) : null);
  if (!match) {
    return toast(`a heart arrived for ${t.name}, and no place here answers to it`, 7000);
  }
  const held = match.thanks || [];
  const from = t.from || '';
  // the same link opened twice is one thanks, not two
  if (held.some(h => h.from === from && h.when === t.when)) {
    selectPlace(match.id, { fly: true });
    return toast('this heart is already on the record');
  }
  if (!store.updatePlace(match.id, { thanks: [...held, { from, when: t.when }] })) {
    return toast('this browser refused the write, so nothing changed');
  }
  renderAll();
  selectPlace(match.id, { fly: true });
  settleHeart(match, from);
  toast(from ? `a heart from ${from}, for ${match.name}` : `a heart, for ${match.name}`, 6500);
}

// ---------- the moment a heart lands ----------
//
// Distinct from the record, which is the line on the plate and the count in
// the index and stays forever. This is the half-second of being thanked, and
// it happens where it happened: over the place itself, on the field.
//
// It is drawn in the app's own figure. A voice in this atlas is a pole with
// arcs around it, and resonance is the word over the whole thing, so a heart
// arriving opens as rings from the point: the place answering. The heart is
// drawn rather than typed, in the counter colour, which is this palette's
// role for another person's mark and exactly what a thanks is. Then the name
// of whoever sent it, set in the display face, because the name is the gift.
//
// A device that asked for stillness gets the record without the moment, which
// is the same trade the evening makes.
const HEART_PATH = 'M50 86 C22 65, 6 48, 6 31 C6 16, 20 8, 33 12 C41 14, 47 20, 50 27 C53 20, 59 14, 67 12 C80 8, 94 16, 94 31 C94 48, 78 65, 50 86 Z';

function settleHeart(place, from) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!place) return;
  mapView.pointWhenSettled(place.lat, place.lng, (pt, container) => {
    container.querySelector('.heart-bloom')?.remove();
    // The place is what the moment is about, so the moment stands on it. When
    // the field has carried the place under a panel or off the edge, the
    // moment is held at the margin nearest it rather than drawn where nobody
    // can see it: still pointing at the place, still on the screen.
    const box = container.getBoundingClientRect();
    const at = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const x = at(pt.x, 110, Math.max(110, box.width - 110));
    const y = at(pt.y, 130, Math.max(130, box.height - 190));
    const el = document.createElement('div');
    el.className = 'heart-bloom';
    // the words are said once, by the toast, which speaks to a reader that
    // cannot see this. the drawing does not say them twice.
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `left:${x}px;top:${y}px`;
    el.innerHTML = `
      <div class="hb-wash"></div>
      <svg class="hb-rings" viewBox="0 0 120 120">
        ${[0, 1, 2, 3].map(i => `<circle class="hb-ring" style="--i:${i}" cx="60" cy="60" r="12" vector-effect="non-scaling-stroke"/>`).join('')}
      </svg>
      <svg class="hb-heart" viewBox="0 0 100 100"><path d="${HEART_PATH}"/></svg>
      ${from ? `<div class="hb-who">${esc(from)}</div>` : ''}`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  });
}

// The roll: every heart, by name and by the day it arrived, newest first.
//
// The sentence below says who, which is most of it. This says when as well,
// and it says each arrival separately rather than folding two into "twice",
// because a person who came back a second time came back on a second day and
// that is the part worth reading.
function thanksRoll(list) {
  return [...list]
    .sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')))
    .map(h => `<span class="ix-roll-one">${h.from ? nameDoor(h.from) : 'someone'}${fmtDate(h.when) ? `<span class="ix-roll-when">${esc(fmtDate(h.when))}</span>` : ''}</span>`)
    .join('');
}

// "thanked by Marta, and twice by Bruno." names and true counts, nothing
// invented: the sentence is the accumulation.
function thanksSentence(list) {
  const by = new Map();
  for (const h of list) {
    const name = h.from || 'someone';
    by.set(name, (by.get(name) || 0) + 1);
  }
  const parts = [...by.entries()].map(([name, n]) =>
    n === 1 ? `by ${esc(name)}` : n === 2 ? `twice by ${esc(name)}` : `${n} times by ${esc(name)}`);
  if (parts.length === 1) return `thanked ${parts[0]}`;
  return `thanked ${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

// The heart is pressed from two places: the plate of a place that was adopted,
// and a place standing in a folio somebody sent. Both compose the same link and
// both owe the same three sentences, so both come here rather than keeping two
// copies that drift.
//
// The sentences are the fix. A heart used to raise the plain byline ask, which
// talks about handing something over, and then a bar that said only `your
// thanks copied`. Nobody was named and nothing said the link had not gone
// anywhere, so it read as a like: pressed once, walked away from, and the
// sender never heard. The name is asked for now as the name they will read, the
// mail is addressed to them, and the bar says what still has to happen.
// `pair` is the road back, and it is only ever passed where the road back is
// known for certain: a folio that arrived as a letter knows which key sealed
// it. It is never guessed from a name. The name on a provenance line is a
// byline somebody typed and the name on a correspondent is your own word for
// them, and matching the two would post a place name and a coordinate to
// whichever verified person happened to be called the same thing. That is a
// leak, and it would be a quiet one, so where the road back is not known the
// heart asks whose it is rather than deciding.
async function sendThanks({ to, pid, name, at, recordId = '' }, { pair, button } = {}) {
  const askedAuthor = await ensureAuthor(to ? `Name shown to ${to} with your thanks. This is not an account.` : '');
  if (askedAuthor === null) return false;
  if (recordId) {
    const latest = currentShareablePlace({ id: recordId });
    if (!latest) return false;
    pid = latest.provenance?.srcId || '';
    name = latest.name;
    at = { lat: latest.lat, lng: latest.lng };
  } else if (!loadLatestAtlas()) {
    return false;
  }
  const from = authorNow();
  const when = new Date().toISOString();
  const reviewed = disclosureFingerprint({ from, pid, name, at });
  if (pair) {
    return sendLetterTo(pair, {
      kind: 'thanks', noun: 'thanks', told: (who) => `thanks sent to ${who}`,
      payload: buildPayload('thanks', { from, pid, name, at, when }),
      stillAllowed: () => {
        if (!recordId) return loadLatestAtlas()
          && disclosureFingerprint({ from: authorNow(), pid, name, at }) === reviewed;
        const latest = currentShareablePlace({ id: recordId });
        if (!latest) return false;
        return disclosureFingerprint({
          from: authorNow(),
          pid: latest.provenance?.srcId || '',
          name: latest.name,
          at: { lat: latest.lat, lng: latest.lng },
        }) === reviewed;
      },
    }, button);
  }
  const url = makeThanksUrl({ from, pid, name, at, when });
  handOver(url, 'your thanks', {
    title: `thanks for ${name}`,
    text: `${to ? `${to}, ` : ''}${from ? `thanks from ${from}` : 'thanks'} for ${name}. it lands on your own record of the place.`,
    road: `it reaches ${to || 'them'} only if you send it`,
  });
  return true;
}

// a folio arrives: an envelope, not a feed item
function openFolioReport(payload, came = {}) {
  const author = String(payload.author || '').trim() || 'unnamed sender';
  const places = (payload.places || [])
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map(p => newPlace({ ...p }));
  const ways = payload.routes || [];
  const shelf = (payload.books || []).map(b => newBook({ ...b }));
  const held = places.filter(holdAlready);
  const fresh = places.filter(p => !holdAlready(p));
  // Paths are counted the same way places are, because take-all takes them and
  // used to say it did not: "take all 1" on a folio of two places and two paths
  // took three records and reported one. A control that miscounts its own
  // action is worse than a control that is missing.
  const freshWays = ways.filter(r => !holdWayAlready(r));
  const freshBooks = shelf.filter(b => !holdBookAlready(b));
  const takes = fresh.length + freshWays.length + freshBooks.length;
  const sig = mapView.sigAngle(author);
  const atlasStarted = () => !!(store.settings.chosen
    || store.places.length || store.routes.length || store.books.length);
  const markExampleChosen = () => {
    if (!came.example || store.settings.chosen) return;
    store.settings.chosen = true;
    store.saveSettings();
    navigator.storage?.persist?.().catch?.(() => {});
    $('#rpLeave')?.replaceChildren(document.createTextNode('Open my atlas'));
  };

  // A collection is read summary first: the decision belongs before the
  // inventory, and the inventory keeps its real indexes even when the example
  // folds its long remainder into native disclosures.
  const placeRow = (p, i) => `
    <div class="rp-pick" data-report-place>
      <span class="no">${fmtNo(i + 1)}</span>
      <span class="nm">${esc(p.name)}</span>
      <span class="why">${esc(p.city || '')}</span>
      ${p.note ? `<p class="said">${esc(p.note)}</p>` : ''}
      <span class="rp-do">
        <a class="adopt quiet" href="${esc(directionsURL(p.lat, p.lng, p.name))}" target="_blank" rel="noopener">directions</a>
        ${holdAlready(p)
          ? '<span class="held">in your atlas</span>'
          : `<button class="adopt" data-adopt="${i}">save</button>`}
        ${came.example ? '' : `<button class="adopt rp-thank" data-thank="${i}" aria-label="send thanks for ${esc(p.name)}">\u2665 thanks</button>`}
      </span>
    </div>`;
  const wayRow = (r, i) => `
    <div class="rp-pick" data-report-path>
      <span class="no" aria-label="${r.loop ? 'a loop' : 'there and back'}">${r.loop ? '◯' : '⟋'}</span>
      <span class="nm">${esc(r.name)}</span>
      <span class="why">${esc(fmtKm(r.km))}${Number.isFinite(r.ascent) ? ` · ${r.ascent} m up` : ''}</span>
      ${r.note ? `<p class="said">${esc(r.note)}</p>` : ''}
      <span class="rp-do">
        ${holdWayAlready(r)
          ? '<span class="held">in your atlas</span>'
          : `<button class="adopt" data-adopt-way="${i}">save</button>`}
      </span>
    </div>`;
  const bookRow = (b, i) => `
    <div class="rp-pick" data-report-book>
      <span class="no" aria-label="a book">¶</span>
      <span class="nm">${esc(b.title)}</span>
      <span class="why">${esc([b.author, b.year].filter(Boolean).join(', '))}</span>
      ${b.note ? `<p class="said">${esc(b.note)}</p>` : ''}
      <span class="rp-do">
        ${holdBookAlready(b)
          ? '<span class="held">in your atlas</span>'
          : `<button class="adopt" data-adopt-book="${i}">save</button>`}
      </span>
    </div>`;
  const shownPlaces = came.example ? places.slice(0, 3) : places;
  const morePlaces = came.example ? places.slice(3) : [];
  const shownBooks = came.example ? shelf.slice(0, 3) : shelf;
  const moreBooks = came.example ? shelf.slice(3) : [];
  const standingVoice = voiceByName(author);

  const el = $('#reportOverlay');
  el.innerHTML = `
    <button class="rp-x" id="rpX">close</button>
    <div class="rp-folio-head">
      <div class="rp-eyebrow">${came.example ? 'an example atlas' : `a collection from ${nameDoor(author)}`}</div>
      <h1 class="rp-name">${esc(payload.title || 'untitled')}</h1>
      ${payload.dedication ? `<p class="rp-ded">“${esc(payload.dedication)}”</p>` : ''}
      <ul class="rp-evidence mono">
        <li><b>${places.length}</b> place${places.length === 1 ? '' : 's'}</li>
        ${ways.length ? `<li><b>${ways.length}</b> path${ways.length === 1 ? '' : 's'}</li>` : ''}
        ${shelf.length ? `<li><b>${shelf.length}</b> book${shelf.length === 1 ? '' : 's'}</li>` : ''}
        ${held.length ? `<li><b>${held.length}</b> already in your atlas</li>` : ''}
        ${fresh.length ? `<li><b>${fresh.length}</b> new to you</li>` : ''}
      </ul>
    </div>
    <div class="rp-lead">
      <p class="rp-safety">${came.example
        ? 'Nothing will be added until you choose.'
        : 'Nothing has been added. Preview it, or save only what you want.'}</p>
      <div class="rp-lead-actions">
        ${places.length ? `<button class="word-btn" id="rpField">${came.example ? 'Explore on map' : 'Preview on map'}</button>` : ''}
        ${came.example || takes ? `<button class="word-btn" id="rpTakeAll">${came.example ? 'Use as my atlas' : `Save all ${takes}`}</button>` : ''}
        <button class="word-btn quiet" id="rpLeave">${came.example
          ? atlasStarted() ? 'Open my atlas' : 'Start empty'
          : store.places.length || store.routes.length || store.books.length ? 'Open my atlas' : 'Start my atlas'}</button>
      </div>
    </div>
    <div class="rp-case rp-folio-case">
      ${places.length ? `
        <section class="rp-section" data-report-kind="places" aria-labelledby="rpPlacesTitle">
          <h2 class="rp-section-title" id="rpPlacesTitle">Places</h2>
          ${shownPlaces.map(placeRow).join('')}
          ${morePlaces.length ? `
            <details class="rp-more" data-report-more="places">
              <summary>View all ${places.length} places</summary>
              <div class="rp-more-rows">${morePlaces.map((p, i) => placeRow(p, i + 3)).join('')}</div>
            </details>` : ''}
        </section>` : ''}
      ${ways.length ? `
        <section class="rp-section" data-report-kind="paths" aria-labelledby="rpPathsTitle">
          <h2 class="rp-section-title" id="rpPathsTitle">Paths</h2>
          ${ways.map(wayRow).join('')}
        </section>` : ''}
      ${shelf.length ? `
        <section class="rp-section" data-report-kind="books" aria-labelledby="rpBooksTitle">
          <h2 class="rp-section-title" id="rpBooksTitle">Books</h2>
          ${shownBooks.map(bookRow).join('')}
          ${moreBooks.length ? `
            <details class="rp-more" data-report-more="books">
              <summary>View all ${shelf.length} books</summary>
              <div class="rp-more-rows">${moreBooks.map((b, i) => bookRow(b, i + 3)).join('')}</div>
            </details>` : ''}
        </section>` : ''}
    </div>
    ${standingVoice && places.length ? `
      <div class="rp-related">
        <button class="word-btn quiet" id="rpAbsorb">add to ${esc(standingVoice.name)}\u2019s shared places</button>
      </div>` : ''}
    <div class="rp-foot rp-folio-foot">
      <button class="word-btn quiet" id="rpGeo">Download GeoJSON</button>
      <button class="word-btn quiet" id="rpPrint">Print or save PDF</button>
    </div>`;
  // The overlay is reused. A previous long letter may have left its scroll at
  // the foot, but every new collection begins with its summary and choices.
  el.scrollTop = 0;
  raiseDialog(el, came.example ? 'Example atlas' : 'Shared collection');
  requestAnimationFrame(() => el.querySelector('.rp-name').style.setProperty('--rp-w', 650));

  bindNameDoors(el, { dialog: el });

  // The byline, and nothing standing in for it. `author` above is what the
  // eyebrow says out loud, and it says "no byline" when a folio carried none;
  // written onto a record that phrase becomes a person's name, and the plate
  // then offers to send thanks to it.
  const ref = { name: String(payload.author || '').trim(), sig };
  const foreignTags = payload.tags || [];
  // a way is adopted whole, with its provenance, like a place
  const adoptWay = (r) => {
    // and a walk you adopt is one you have not walked, for the same reason
    const made = store.addRoute(newRoute({
      ...r, id: undefined, sample: false,
      status: 'wishlist',
      tags: graftTags(r.tags || [], foreignTags),
      provenance: extendChain(r.provenance, { name: author, sig }),
    }));
    if (!made) { toast('this browser refused to keep it'); return null; }
    renderAll();
    return made;
  };
  $$('[data-adopt-way]', el).forEach(b => b.addEventListener('click', () => {
    const r = ways[parseInt(b.dataset.adoptWay, 10)];
    if (!r) return;
    if (adoptWay(r)) {
      markExampleChosen();
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'held', textContent: 'yours' }));
      toast(`path saved to your atlas, after ${author}`);
    }
  }));
  $$('[data-adopt]', el).forEach(b => b.addEventListener('click', () => {
    const p = places[parseInt(b.dataset.adopt, 10)];
    if (!p) return;
    if (adoptPlace(p, ref, foreignTags)) {
      markExampleChosen();
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'held', textContent: 'yours' }));
    }
  }));
  $$('[data-adopt-book]', el).forEach(b => b.addEventListener('click', () => {
    const bk = shelf[parseInt(b.dataset.adoptBook, 10)];
    if (!bk) return;
    if (adoptBook(bk, ref, foreignTags)) {
      markExampleChosen();
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'held', textContent: 'yours' }));
      toast(`book saved to your atlas, after ${author}`);
    }
  }));
  // gratitude, straight from the letter: the heart beside a place composes a
  // thanks addressed by the place's own id in the sender's atlas, and the
  // link goes back the way the folio came. pressing it before adopting is
  // fine; a person may be thanking for a recommendation they followed on
  // foot, not for a record they keep.
  $$('[data-thank]', el).forEach(b => b.addEventListener('click', () => {
    const p = places[parseInt(b.dataset.thank, 10)];
    if (!p) return;
    // `ref.name` is the folio's byline as it was typed, and empty when the
    // folio carried none. `author` is not it: that one reads `no byline` out
    // loud for the eyebrow, and a heart addressed to no byline is worse than a
    // heart addressed to nobody.
    // and when the folio came as a letter it goes back as one, to the key that
    // sealed it rather than to the name that signed it. `maySend` is asked
    // again here because a correspondent can be withdrawn between the letter
    // arriving and the heart being pressed.
    const pair = maySend(came.pair) ? came.pair : null;
    sendThanks({ to: ref.name, pid: p.id, name: p.name, at: { lat: p.lat, lng: p.lng } },
      { pair, button: b });
  }));
  // a folio from a person whose voice stands on the shelf can also speak to
  // the shelf: their slice gains what the letter carries and loses nothing,
  // because a folio is a gift and not a census
  $('#rpAbsorb')?.addEventListener('click', () => {
    const standing = voiceByName(author);
    if (!standing) return;
    const next = absorbIntoVoice(standing, { tags: payload.tags || [], places });
    const kept = store.updateCorrespondent(standing.id, {
      tags: next.tags, places: next.places, sample: false,
    });
    if (!kept) return toast('this browser refused the write, so nothing changed');
    pushCorrespondentsToMap();
    $('#rpAbsorb').replaceWith(Object.assign(document.createElement('span'),
      { className: 'held', textContent: next.added ? `${next.added} new for ${standing.name}` : 'nothing they had not said' }));
    toast(next.added
      ? `${standing.name} holds ${next.added} more place${next.added === 1 ? '' : 's'} now`
      : `${standing.name}\u2019s places already held all of this`);
  });
  $('#rpTakeAll')?.addEventListener('click', () => {
    if (came.example) {
      markExampleChosen();
      seedDemo({ quiet: true });
      clearShareHash();
      dropDialog(el);
      applyWorldState();
      leaveHero();
      mapView.fitAll(store.places);
      toast('the example is now yours. change or remove anything');
      return;
    }
    // whatever was taken one at a time is already yours: never take it twice
    const remaining = fresh.filter(p => !holdAlready(p));
    remaining.forEach(p => adoptPlace(p, ref, foreignTags));
    // Paths come along, and are counted and said. They used to come along
    // silently under a number that had only counted places.
    const takenWays = ways.filter(r => !holdWayAlready(r));
    takenWays.forEach(adoptWay);
    // books last, after the places: a book's tie re-lands on a place adopted
    // from the same hand, so the places must be home before the shelf asks
    const takenBooks = shelf.filter(b => !holdBookAlready(b));
    takenBooks.forEach(b => adoptBook(b, ref, foreignTags));
    renderAll();
    clearShareHash();
    dropDialog(el);
    applyWorldState();
    mapView.fitAll(store.places);
    const said = [
      remaining.length ? `${remaining.length} place${remaining.length === 1 ? '' : 's'}` : '',
      takenWays.length ? `${takenWays.length} path${takenWays.length === 1 ? '' : 's'}` : '',
      takenBooks.length ? `${takenBooks.length} book${takenBooks.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    toast(said
      ? `${said} saved to your atlas, after ${author}`
      : 'everything is already in your atlas');
    setTimeout(() => askForThree(author), 1400);
  });
  $('#rpField')?.addEventListener('click', () => {
    // their marks on a field of yours that is untouched: the visiting pattern
    state.visiting = { id: 'visit-' + Date.now(), name: author, hue: 278, visible: true,
      tags: foreignTags, places, letter: payload, example: !!came.example };
    mapView.setCorrespondents([...store.correspondents, state.visiting]);
    dropDialog(el);
    leaveHero();
    mapView.fitAll(places);
    // a visit is a view put there for one person's marks, so the floor stands
    // aside until the visit ends
    mapView.holdCorrMarks(true);
    const bar = $('#visitBar');
    bar.hidden = false;
    $('#visitWho').textContent = `visiting ${author}`;
    toast('previewing their places. Your atlas is unchanged');
  });

  $('#rpGeo').addEventListener('click', () => {
    const fc = {
      type: 'FeatureCollection',
      features: places.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { name: p.name, city: p.city, country: p.country, note: p.note, from: author },
      })),
    };
    download(`${(payload.title || 'folio').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.geojson`,
      JSON.stringify(fc, null, 2), 'application/geo+json');
  });

  $('#rpLeave').addEventListener('click', () => {
    if (!came.example) return leaveReport(el, author);
    if (atlasStarted()) return leaveReport(el);
    markExampleChosen();
    clearShareHash();
    dropDialog(el);
    applyWorldState();
    state.visiting = null;
    mapView.holdCorrMarks(false);
    pushCorrespondentsToMap();
    // Starting empty still needs the filing vocabulary, exactly as the first
    // visit's empty door does, but it takes none of the example records.
    if (!store.tags.length) {
      Object.values(baseTags()).forEach(t => store.addTag(t));
    }
    renderAll();
    leaveHero();
    openKeepChooser();
  });
  $('#rpPrint').addEventListener('click', () => {
    const theirTags = new Map((payload.tags || []).map(t => [t.id, t.name]));
    printSheet({
      title: payload.title || 'untitled',
      dedication: payload.dedication || '',
      author,
      places,
      routes: ways,
      books: shelf,
      tags: payload.tags || [],
      tagName: (id) => theirTags.get(id),
    });
  });
}

// an ask arrives: your atlas has already drafted the reply
// `came.pair` again, and here it changes a sentence rather than a road. The
// foot of this report has always said the link is the only copy of the
// question, which was true of the only road an ask had. A question that
// arrived as a letter has a copy sitting in the box until its reader throws it
// away, and telling that reader to keep a link they were never given would be
// the app describing a road they did not travel.
function openAskReport(payload, came = {}) {
  const from = String(payload.from || '').trim() || 'someone';
  const q = String(payload.q || '').trim();
  const matches = q ? queryMyAtlas(q) : { places: [], ways: [] };
  const found = matches.places.length + matches.ways.length;
  const mine = store.places.length + store.routes.length;

  // An ask that nothing answers used to be four lines and one door out, and the
  // door cleared the hash on its way. The person most likely to be standing
  // here is the one whose friend uses this and who does not: they read a count
  // they cannot act on, leave, and the question is gone. Nothing here can
  // answer for them, so what is owed is the two facts they do not have. What an
  // ask is, and that the link is the only copy of it.
  //
  // Two sentences, not one, because the two empty atlases are not the same
  // person: one has not begun, the other has begun and holds nothing that fits.
  // Written as separate blocks so each is met, and measured, on its own.
  const dead = found ? '' : `
    ${mine
      ? '<p class="rp-foot-note">Nothing in your atlas matches this request yet. Add matching places, then open the link again to make a collection.</p>'
      : '<p class="rp-foot-note">This request is answered only from your own atlas. Start your atlas, add places you love, then open the link again.</p>'}
    ${came.pair
    ? '<p class="rp-foot-note">The question is not kept here. It waits in your letters until you throw it away.</p>'
    : '<p class="rp-foot-note">The question is not kept here. This link is the only copy of it, so keep the link, or ask for it again.</p>'}`;

  const el = $('#reportOverlay');
  el.innerHTML = `
    <button class="rp-x" id="rpX">close</button>
    <div class="rp-eyebrow">a request from ${nameDoor(from)}</div>
    <h1 class="rp-name">${esc(q || 'anything')}</h1>
    <ul class="rp-evidence mono">
      <li>your atlas holds <b>${found}</b> answer${found === 1 ? '' : 's'}</li>
    </ul>
    <div class="rp-foot">
      ${found ? `<button class="word-btn" id="askCompose">create a collection for ${esc(from)}</button>` : ''}
      <button class="word-btn quiet" id="rpLeave">${mine ? 'open my atlas' : 'begin my own atlas'}</button>
    </div>${dead}`;
  raiseDialog(el, 'Recommendation request');
  requestAnimationFrame(() => el.querySelector('.rp-name').style.setProperty('--rp-w', 650));

  bindNameDoors(el, { dialog: el });

  $('#askCompose')?.addEventListener('click', () => {
    clearShareHash();
    dropDialog(el);
    applyWorldState();
    openFolioComposer({
      title: q,
      dedication: `for ${from}, who asked`,
      places: matches.places,
      ways: matches.ways,
    });
  });
  $('#rpLeave').addEventListener('click', () => leaveReport(el));
}

function openAtlasReport(payload) {
  const theirs = {
    tags: (payload.tags || []).map(t => newTag(t)),
    places: (payload.places || [])
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map(p => newPlace({ ...p })),
    books: (payload.books || []).map(b => newBook({ ...b })),
  };
  const theirWays = payload.routes || [];
  const name = String(payload.author || '').trim() || 'unnamed atlas';
  const r = resonance(myAtlas(), theirs);
  // no word, and no eyebrow claiming a yours, when the reader holds nothing:
  // kinship.js decides that and says why. this only stops printing an empty
  // element and stops the summary below pointing at a word that is not there.
  const v = verdict(r);
  const ev = evidenceLines(r, name);
  const picks = r.picks.slice(0, 7);
  const sig = mapView.sigAngle(name);

  const el = $('#reportOverlay');
  el.innerHTML = `
    <button class="rp-x" id="rpX">close</button>
    <div class="rp-eyebrow">an atlas from</div>
    <h1 class="rp-name">${esc(name)}</h1>
    ${v.word ? `<p class="rp-verdict">${v.word}</p>` : ''}
    <ul class="rp-evidence mono">${ev.map(l => `<li>${l}</li>`).join('')}</ul>
    <details class="rp-grounds">
      <summary>how this comparison was made</summary>
      <ul class="rp-evidence mono">
        ${grounds(r).map(g => `<li><b>${g.n}</b> ${esc(g.of)}${g.detail ? `: <i>${esc(g.detail)}</i>` : ''}</li>`).join('')}
      </ul>
      <p class="set-row-sub">This comparison is made on this device from your atlas and theirs. Nothing about it leaves. <a href="read.html?d=method">Read the comparison method.</a></p>
    </details>
    ${picks.length ? `<div class="rp-case">
      <div class="sec-head" role="heading" aria-level="2">places you may like</div>
      ${picks.map((pk, i) => `
        <div class="rp-pick" data-i="${i}">
          <span class="no">${fmtNo(i + 1)}</span>
          <span class="nm">${esc(pk.place.name)}</span>
          <span class="why">${pk.expands ? 'something different' : esc((pk.tagLabels[0] || '').toLowerCase())}</span>
          <button class="adopt" data-adopt="${i}">save</button>
        </div>`).join('')}
    </div>` : ''}
    ${theirWays.length ? `<div class="rp-case">
      <div class="sec-head" role="heading" aria-level="2">paths they shared</div>
      ${theirWays.map((r, i) => `
        <div class="rp-pick">
          <span class="no" aria-label="${r.loop ? 'a loop' : 'there and back'}">${r.loop ? '◯' : '⟋'}</span>
          <span class="nm">${esc(r.name)}</span>
          <span class="why">${esc(fmtKm(r.km))}${Number.isFinite(r.ascent) ? ` · ${r.ascent} m up` : ''}</span>
          ${r.note ? `<p class="said">${esc(r.note)}</p>` : ''}
          ${holdWayAlready(r)
            ? '<span class="held">in your atlas</span>'
            : `<button class="adopt" data-adopt-way="${i}">save</button>`}
        </div>`).join('')}
    </div>` : ''}
    ${theirs.books.length ? `<div class="rp-case">
      <div class="sec-head" role="heading" aria-level="2">books they shared</div>
      ${theirs.books.map((b, i) => `
        <div class="rp-pick">
          <span class="no" aria-label="a book">¶</span>
          <span class="nm">${esc(b.title)}</span>
          <span class="why">${esc([b.author, b.year].filter(Boolean).join(', '))}</span>
          ${b.note ? `<p class="said">${esc(b.note)}</p>` : ''}
          ${holdBookAlready(b)
            ? '<span class="held">in your atlas</span>'
            : `<button class="adopt" data-adopt-book="${i}">save</button>`}
        </div>`).join('')}
    </div>` : ''}
    <div class="rp-foot">
      ${store.places.length < 3 ? `<button class="word-btn" id="rpBegin">use this as my starting atlas</button>` : ''}
      <button class="word-btn ${store.places.length < 3 ? 'quiet' : ''}" id="rpKeep">keep ${esc(name)} in People</button>
      <button class="word-btn quiet" id="rpLook">preview on my map</button>
      <button class="word-btn quiet" id="rpLeave">${store.places.length || store.routes.length || store.books.length ? 'open my atlas' : 'begin my own atlas'}</button>
    </div>`;
  raiseDialog(el, 'Shared atlas');
  requestAnimationFrame(() => el.querySelector('.rp-name').style.setProperty('--rp-w', 650));

  const foreignRef = { name, sig };
  $$('[data-adopt-way]', el).forEach(b => b.addEventListener('click', () => {
    const r = theirWays[parseInt(b.dataset.adoptWay, 10)];
    if (!r) return;
    const made = store.addRoute(newRoute({
      ...r, id: undefined, sample: false,
      tags: graftTags(r.tags || [], theirs.tags),
      provenance: extendChain(r.provenance, { name, sig }),
    }));
    if (!made) return toast('this browser refused to keep it');
    renderAll();
    b.replaceWith(Object.assign(document.createElement('span'), { className: 'held', textContent: 'yours' }));
    toast(`path saved to your atlas, after ${name}`);
  }));
  $$('[data-adopt]', el).forEach(b => b.addEventListener('click', () => {
    const pk = picks[parseInt(b.dataset.adopt, 10)];
    if (!pk) return;
    adoptPlace(pk.place, foreignRef, theirs.tags);
    b.replaceWith(Object.assign(document.createElement('span'), { className: 'why', textContent: 'yours' }));
  }));
  $$('[data-adopt-book]', el).forEach(b => b.addEventListener('click', () => {
    const bk = theirs.books[parseInt(b.dataset.adoptBook, 10)];
    if (!bk) return;
    if (adoptBook(bk, foreignRef, theirs.tags)) {
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'held', textContent: 'yours' }));
      toast(`book saved to your atlas, after ${name}`);
    }
  }));
  $('#rpBegin')?.addEventListener('click', () => {
    // the copy keeps every id the payload carried, so a book that names its
    // place still finds it standing in the same atlas it was tied to
    const added = store.merge({ tags: theirs.tags, places: theirs.places, books: theirs.books });
    if (!added) return toast('this browser refused to keep them');
    store.settings.chosen = true;
    store.saveSettings();
    leaveReport(el);
    toast(`${added} items saved to your atlas. Review them when you are ready.`);
  });
  $('#rpKeep').addEventListener('click', async () => {
    const finalName = await askText('What would you like to call this person?', { value: name === 'unnamed atlas' ? '' : name, yes: 'save person' });
    if (finalName === null) return;
    // the shelf is asked before a second person with this name appears on
    // it. an atlas is the whole of what a person hands over, so replacing
    // the slice is the ordinary meaning of a second one; two people sharing
    // a name is real too, and stays one press away.
    const standing = voiceByName(finalName || name);
    let kept = null;
    if (standing) {
      const word = await ask(
        `${standing.name} is already in People with ${standing.places.length} shared place${standing.places.length === 1 ? '' : 's'}. Replace those places with this atlas, or keep both people?`,
        { yes: 'replace shared places', also: 'keep both people', no: 'never mind', danger: true });
      if (!word) return;
      if (word === true) {
        kept = store.updateCorrespondent(standing.id, {
          tags: theirs.tags.map(t => newTag(t)),
          places: theirs.places.map(pl => newPlace({ ...pl })),
          sample: false,
        });
        if (!kept) return toast('this browser refused the write, so nothing changed');
        pushCorrespondentsToMap();
        clearShareHash();
        dropDialog(el);
        applyWorldState();
        renderAll();
        // the same hold as the branch below: the count this toast reads out
        // has to be the count standing on the field it was just fitted to
        if (kept.places.length) { mapView.fitAll(kept.places); mapView.holdCorrMarks(true); }
        toast(`${standing.name} now has ${kept.places.length} shared place${kept.places.length === 1 ? '' : 's'} in People`);
        return;
      }
    }
    kept = store.addCorrespondent({ name: finalName || name, tags: theirs.tags, places: theirs.places });
    if (!kept) return toast('this browser refused to keep them');
    pushCorrespondentsToMap();
    clearShareHash();
    dropDialog(el);
    applyWorldState();
    renderAll();
    // fly to where their marks actually are, so the toast tells the truth, and
    // hold the field's zoom floor open while it stands there: an atlas that
    // spans continents fits below the floor, and the sentence underneath would
    // be read over an empty world
    if (kept.places.length) { mapView.fitAll(kept.places); mapView.holdCorrMarks(true); }
    toast(`${finalName || name} is now in People. these are their places`);
  });
  $('#rpLook').addEventListener('click', () => {
    state.visiting = { id: 'visit-' + Date.now(), name, hue: 278, visible: true, tags: theirs.tags, places: theirs.places, letter: payload };
    mapView.setCorrespondents([...store.correspondents, state.visiting]);
    dropDialog(el);
    mapView.fitAll(theirs.places);
    mapView.holdCorrMarks(true);
    const bar = $('#visitBar');
    bar.hidden = false;
    $('#visitWho').textContent = `visiting ${name}`;
    toast('previewing their places. Your atlas is unchanged');
  });
  $('#rpLeave').addEventListener('click', () => leaveReport(el));
}

// ---------- folios: the atomic recommendation ----------

// Do I already hold this walk?
//
// Places were guarded twice, at the row and inside take-all. Paths were guarded
// nowhere at all: the row offered adopt unconditionally, adoptWay called
// addRoute, and the store's add is a bare unshift. Reopening the same link and
// pressing twice gave back Hill loop, River path, Hill loop, River path. There
// was a second door too: one fresh place was enough to bring take-all back, and
// take-all re-adopted every path in one press.
//
// A walk is told by its name and by where it starts and ends. Two walks from
// one door are a real thing and they do not share both ends, so the ends alone
// would merge them; the name alone would merge a Sunday loop walked twice from
// different sides. Both, or it is not the same walk.
function holdWayAlready(r) {
  // A point on a way is { lat, lng, ele }, not a pair. Reading it as a pair
  // gave undefined to the distance, which answered NaN, which is not less than
  // fifty metres, so the guard said no to everything and looked like it worked.
  const ends = (w) => {
    const path = Array.isArray(w.path) ? w.path : [];
    const first = path[0];
    const last = path[path.length - 1];
    return (first && Number.isFinite(first.lat) && last && Number.isFinite(last.lat))
      ? [first, last] : null;
  };
  const mine = ends(r);
  if (!mine) return false;
  const name = String(r.name || '').trim().toLowerCase();
  return store.routes.some((mr) => {
    if (String(mr.name || '').trim().toLowerCase() !== name) return false;
    const theirs = ends(mr);
    if (!theirs) return false;
    return haversineKm(theirs[0], mine[0]) < 0.05 && haversineKm(theirs[1], mine[1]) < 0.05;
  });
}

function holdAlready(p) {
  // do I already hold this place? (proximity + name family)
  return store.places.some(mp => {
    if (haversineKm(mp, p) > 0.15) return false;
    const a = mp.name.toLowerCase(), b = p.name.toLowerCase();
    return a.includes(b) || b.includes(a) || haversineKm(mp, p) < 0.04;
  });
}

// a byline is asked for at the moment it is used, never at the door
// And asked once. "leave it out" used to write nothing down, so the same modal
// rose at the next door, and the one after that, for ever: a person who had
// already decided they wanted no byline was interrogated at every link, every
// file and every folio. The answer is kept now, whichever way it goes, and the
// place to change it later is the byline row under `you`, where a name is
// typed. Escape is not an answer, it is walking away from the question, so it
// writes nothing down and the next door may ask again.
// And the label says what the name is about to do. The standing sentence talks
// about handing something over, which is not what a person pressing a heart
// thinks they are doing: the name they type is the one the other person reads
// on the thanks. A caller that knows better passes its own sentence; everybody
// else passes nothing and gets the plain one back, which is why the plain one
// is kept on the element rather than in here.
function ensureAuthor(why = '') {
  // A settings storage event may still be queued in this tab. Read the same
  // durable state the eventual carrier will read before deciding that a name
  // is already known or that the question was already answered.
  if (!loadLatestAtlas()) return Promise.resolve(null);
  if (store.settings.authorName) return Promise.resolve(store.settings.authorName);
  if (store.settings.bylineAsked) return Promise.resolve('');
  const ask = $('#nameAsk');
  const input = $('#nameAskInput');
  const label = $('#nameAsk label');
  if (!label.dataset.plain) label.dataset.plain = label.textContent;
  label.textContent = why || label.dataset.plain;
  return new Promise((resolve) => {
    const done = (name, answered = true) => {
      go.removeEventListener('click', onGo);
      later.removeEventListener('click', onLater);
      ask.removeEventListener('keydown', onKey);
      const before = { ...store.settings };
      if (name) store.settings.authorName = name;
      if (answered) store.settings.bylineAsked = true;
      if ((name || answered) && !store.saveSettings()) {
        store.settings = before;
        dropDialog(ask);
        toast('that sharing name could not be saved');
        resolve(null);
        return;
      }
      if (name) renderCount();
      dropDialog(ask);
      resolve(store.settings.authorName || '');
    };
    const onGo = () => done(input.value.trim());
    const onLater = () => done('');
    // The press is answered here and it goes no further, and it is caught on
    // the sheet rather than in the field: the same rule ask() keeps a few
    // hundred lines up, for the same reason. On the field it missed twice. A
    // press made after Tab moved the focus to `use it` never reached this at
    // all, so the question went on standing; and a press made in the field was
    // answered here and then went on bubbling to the app's own Escape, which
    // pops whatever stands behind. So one Escape dismissed the byline question,
    // closed the plate that was being handed over, and let the hand-over finish
    // onto the clipboard the person had just tried to abort, with the place
    // gone from behind it. A second press took the index too, all of it
    // invisible under an aria-modal sheet.
    //
    // Enter stays the field's own key. On `leave it out` it has to press that
    // word, not keep the name typed in the line above it.
    const onKey = (e) => {
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); e.stopPropagation(); done(input.value.trim()); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('', false); }
    };
    const go = $('#nameAskGo');
    const later = $('#nameAskLater');
    go.addEventListener('click', onGo);
    later.addEventListener('click', onLater);
    ask.addEventListener('keydown', onKey);
    input.value = '';
    raiseDialog(ask, 'Your name');
    input.focus();
  });
}

function authorNow() {
  return String(store.settings.authorName || '').slice(0, 60);
}

// ---------- folios: the shelf, and the composer ----------
//
// A folio is a titled slice of the atlas, kept as references so it stays
// current as places improve. Keeping shares nothing. Handing over and printing
// are each their own explicit act, from the same page.

// The law under an empty shelf says what the poster's own subtitle does not.
// It used to open `A folio is a titled set of places`, which is word for word
// that subtitle, sixty pixels higher up the same screen, and then went on to
// contradict it: `kept here for yourself` against `for the people you choose`.
// One room, two definitions, and the one thing a person opening an empty shelf
// actually needs to be told, that keeping one shares nothing, was the clause
// at the end of the second.
const EMPTY_SHELF = `<div class="ix-empty"><div class="ix-empty-law">No collections yet.</div>
  <p>Create one for a trip, person, or idea. Nothing is shared until you choose.</p>
</div>`;

function openFolioShelf() {
  onFolioClosed = null;
  const body = $('#folioBody');
  const shelf = store.folios;
  body.innerHTML = `
    ${shelf.length ? shelf.map(f => {
      const r = store.resolveFolio(f.id);
      const names = r.places.slice(0, 3).map(p => p.name).join(' · ');
      const n = r.places.length + r.routes.length + r.books.length;
      return `<button class="fol-shelf-row" data-open="${esc(f.id)}">
        <span class="fs-title">${esc(f.title)}</span>
        <span class="fs-meta mono">${n} item${n === 1 ? '' : 's'}${r.routes.length ? ` · ${r.routes.length} path${r.routes.length > 1 ? 's' : ''}` : ''}${r.books.length ? ` · ${r.books.length} book${r.books.length > 1 ? 's' : ''}` : ''}${fmtDate(f.updatedAt) ? ` · ${fmtDate(f.updatedAt)}` : ''}</span>
        ${names ? `<span class="fs-names">${esc(names)}${r.places.length > 3 ? ' …' : ''}</span>` : ''}
        ${f.dedication ? `<span class="fs-ded">${esc(f.dedication)}</span>` : ''}
      </button>`;
    }).join('') : EMPTY_SHELF}
    <div class="fol-acts">
      <button class="word-btn" id="folNew">create a collection</button>
      <button class="word-btn quiet" id="folHandOver">share the whole atlas</button>
      <button class="word-btn quiet" id="folAsk">ask for recommendations</button>
    </div>`;
  $$('[data-open]', body).forEach(b => b.addEventListener('click', () => openFolioComposer({ folioId: b.dataset.open, reading: true })));
  $('#folNew').addEventListener('click', () => openFolioComposer({ fresh: true }));
  // the door to handing over, standing where the nav's own subtitle promises
  // it. it was reachable only by typing >share after the reduction, which on
  // a phone is a door with no handle, and handing over is a third of the loop.
  //
  // it says the whole atlas out loud because of where it stands. in a room
  // titled folio, beside folios a person kept, `hand over` reads as `hand over
  // a folio`, and it does not: it drops the shelf and opens the atlas panel.
  // handing over a kept folio is done by opening it and reading its own door,
  // which is one press away and is the path this word was misread as.
  $('#folHandOver').addEventListener('click', () => { closeSurface('folioOverlay'); shareMap(); });
  // and the other direction, standing beside it for the same reason. An ask is
  // the move that starts a folio in somebody else's atlas, and until now the
  // only way to make one was to type >ask, which is the door with no handle
  // described above. A person who has just been handed an ask had no way at all
  // to find out how one is made.
  $('#folAsk').addEventListener('click', () => { closeSurface('folioOverlay'); composeAsk(); });
  openSurface('folioOverlay');
  const surface = $('#folioOverlay');
  if (surface && !surface.contains(document.activeElement)) surface.focus();
}

function openFolioComposer({ folioId = null, title = '', dedication = '', places = null, ways = null, books = null, fresh = false, preselect = [], cap = 0, attend = '', first = '', reading = false, agentView = false } = {}) {
  const kept = folioId ? store.folioById(folioId) : null;
  // The house is everything the person owns.
  //
  // `mayLeave` used to stand here, and it cost more than it saved. Someone who
  // took the app's own first suggestion, an atlas of eighteen loans, pressed
  // "compose a new folio" and was handed a page with no rows on it and no
  // sentence saying why, while "file into a folio" on the plate filtered
  // nothing at all: the same record was filable from one surface and invisible
  // on the other. A folio is a shelf in your own house, and what may leave the
  // house is decided at the doors, one door at a time, below.
  //
  // Leaving the pool whole also settles a quieter defect. A place in a kept
  // folio that had no row kept its id in the selection anyway, so the counter
  // could read more enclosed than there were rows to see, and that number was
  // written back to the shelf on the next keep. Every id now has a row.
  //
  // The ternary stays, and someone will want to tidy it away. A caller passing
  // `places` is handing over what is on screen: the ask that was just answered,
  // the arrangement the person is looking at. Flattening it to the whole atlas
  // would turn "compose a folio" in the share panel into the whole atlas,
  // already enclosed, one press from the door.
  //
  // The ways are held to that same word, and were not. `houseWays` read the
  // whole atlas however the composer had been opened, so a band in the index,
  // which is documented as handing over exactly what is on the screen, filters
  // and all, honoured the arrangement for its places and then laid every path
  // in the atlas underneath them.
  //
  // And a folio that is being read is its own members, which is the one case
  // the reasoning above does not cover. Keeping a folio of three used to land
  // a person back on a page of every place they own with three of them ticked,
  // above a line reading "3 of 13 enclosed": the work was safe on the shelf and
  // the surface said it was nearly empty. A folio opened from the shelf said
  // the same thing. So the pool is what the folio holds, and the house is one
  // word away, where widening is a thing a person asks for rather than the
  // state they are handed.
  //
  // It is read once, here, rather than on every repaint: a row pressed out in
  // this state stays on the page, saying out, and can be pressed back in.
  const read = reading && kept ? store.resolveFolio(kept.id) : null;
  // An assistant draft is the exception to the whole-house rule: its caller
  // supplies disclosure copies, and widening those to the owner's originals
  // would put private rows and local metadata in a page the assistant can see.
  const housePlaces = agentView ? (places || [])
    : read ? read.places : (kept || fresh) ? allPlaces() : (places || filteredPlaces());
  const houseWays = agentView ? (ways || [])
    : read ? read.routes : (kept || fresh) ? allRoutes() : (ways || filteredRoutes());
  // The books hold to the same word with one difference: a caller handing
  // over what is on screen names its books or brings none. A pressed city
  // band and an answered ask are about places on a map, and a book answers
  // to no city, so no city's composer has business laying the whole shelf
  // under somebody's three restaurants.
  const houseBooks = agentView ? (books || [])
    : read ? read.books : (kept || fresh) ? allBooks() : (books || ((places || ways) ? [] : filteredBooks()));

  // Under a cap the pool is not the house, and here the reason runs the other
  // way. This surface promises a number out loud, and it can only promise it
  // over records that will actually arrive. A row that can never leave spends
  // one of the three and delivers nothing, so a folio titled "three for X"
  // reaches X holding two. A way that asked to hide its ends and is too short
  // to lose them is refused at the door for its own good reason, and would
  // spend a place in the three exactly the same way.
  const pool = cap ? housePlaces.filter(mayLeave) : housePlaces;
  const wayPool = cap ? houseWays.filter(r => mayLeave(r) && store.trimWay(r)) : houseWays;
  const bookPool = cap ? houseBooks.filter(mayLeave) : houseBooks;
  // Keep the membership of the composition stable, but resolve owned records
  // again after every durable read. `flushWrites()` deliberately reloads the
  // atlas before it applies a delayed note, which replaces the store arrays;
  // painting from the objects captured above would then show the old sentence
  // even though the new one was safely written. Assistant drafts are already
  // disclosure copies, so they stay on their deliberately narrower objects.
  const placePoolNow = () => agentView ? pool : pool.map(p => placeById(p.id)).filter(Boolean);
  const wayPoolNow = () => agentView ? wayPool : wayPool.map(r => routeById(r.id)).filter(Boolean);
  const bookPoolNow = () => agentView ? bookPool : bookPool.map(b => store.bookById(b.id)).filter(Boolean);
  const chosen = new Set(
    kept ? kept.placeIds.filter(id => placeById(id))
      : fresh ? preselect.filter(id => pool.some(p => p.id === id))
        : pool.map(p => p.id));
  const chosenWays = new Set(
    kept ? kept.routeIds.filter(id => routeById(id))
      : fresh ? preselect.filter(id => wayPool.some(r => r.id === id))
        : []);
  // a preselect may carry a book's id: "a new folio, starting with it" is
  // offered on a book's plate too, and each id lands in the set of its kind
  const chosenBooks = new Set(
    kept ? (kept.bookIds || []).filter(id => store.bookById(id))
      : fresh ? preselect.filter(id => bookPool.some(b => b.id === id))
        : []);
  // A kept folio wears its own head, unless a caller is carrying one across
  // from the page the person is standing on.
  if (kept) { title = title || kept.title; dedication = dedication || kept.dedication; }
  const body = $('#folioBody');
  const ordered = values => [...values].sort();
  const baseline = JSON.stringify({
    title, dedication,
    placeIds: ordered(chosen), routeIds: ordered(chosenWays), bookIds: ordered(chosenBooks),
  });

  const readHead = () => {
    title = $('#folTitle')?.value ?? title;
    dedication = $('#folDed')?.value ?? dedication;
  };
  const draftState = () => {
    readHead();
    return {
      title, dedication,
      placeIds: ordered(chosen), routeIds: ordered(chosenWays), bookIds: ordered(chosenBooks),
    };
  };
  const dirty = () => JSON.stringify(draftState()) !== baseline;
  const saveDraft = () => {
    const draft = draftState();
    const patch = {
      title: draft.title.trim() || 'Untitled collection',
      dedication: draft.dedication.trim(),
      placeIds: draft.placeIds,
      routeIds: draft.routeIds,
      bookIds: draft.bookIds,
    };
    return kept ? store.updateFolio(kept.id, patch) : store.addFolio(newFolio(patch));
  };
  let decidingClose = false;
  const leaveComposer = (after) => {
    if (decidingClose) return;
    if (!dirty()) {
      onFolioClosed = null;
      after();
      return;
    }
    decidingClose = true;
    const subject = kept ? `Save changes to “${kept.title}” before leaving?`
      : 'Save this collection as a draft before leaving?';
    void ask(subject, {
      yes: kept ? 'save changes' : 'save draft',
      also: 'discard',
      no: 'keep editing',
      dangerAlso: true,
    }).then((answer) => {
      decidingClose = false;
      if (answer === false) return;
      if (answer === true && !saveDraft()) {
        toast('this browser refused to save it, so nothing changed');
        return;
      }
      onFolioClosed = null;
      after();
      if (answer === true) toast(kept ? 'changes saved' : 'draft saved');
    });
  };
  const leaveFor = after => onFolioClosed ? onFolioClosed(after) : after();
  onFolioClosed = leaveComposer;
  // Pools decide which ids this composition may use; the records themselves
  // are resolved afresh. A record can be excluded or removed in another tab
  // while this long-lived composer remains open, and its captured object must
  // never become a stale route around that newer choice.
  const selection = () => placePoolNow().filter(p => chosen.has(p.id));
  const wraySelection = () => wayPoolNow().filter(r => chosenWays.has(r.id));
  const bookSelection = () => bookPoolNow().filter(b => chosenBooks.has(b.id));
  const needsTitle = () => {
    const t = $('#folTitle').value.trim();
    if (!t) { $('#folTitle').focus(); toast('give this collection a title'); return null; }
    if (!chosen.size && !chosenWays.size && !chosenBooks.size) { toast('choose at least one item'); return null; }
    return t;
  };

  // What a row says about itself in the column on the right. The city used to
  // stand here too, repeated down every row of a page that is now divided by
  // city anyway. What is left is the one thing a person cannot work out by
  // reading the name: whether this record will travel at all.
  const staysBehind = r => r.private ? 'Excluded from sharing' : '';

  // ---------- the page is divided the way the sheet is divided ----------
  //
  // The city was always the unit this atlas organises by. It was never a thing
  // a person could take hold of: the composer listed every record flat, in the
  // order the pool happened to be in, and someone composing a folio for one
  // city pressed nineteen rows one at a time to leave out the four that were
  // somewhere else.
  //
  // The bands come from find.js, so this page is divided exactly where the
  // printed page it becomes is divided. The heading rule is the sheet's own:
  // a heading unless there is one group and nothing in it has a city at all,
  // in which case naming it would be saying "off the map" over a page that is
  // entirely off the map.
  //
  // `first` is the city that was pressed to get here, and its band goes to the
  // top. The pool is still the whole atlas, because a person who pressed Lisboa
  // may well also want the one place in Cascais, but the bands underneath were
  // ordered for browsing and the city just pressed could be anywhere among
  // them: on a phone, the single most important gesture in this feature landed
  // on a screen with not one row of the pressed city on it.
  //
  // Ordered rather than scrolled, and the surface's own animation decides it.
  // The body arrives on a `rise`, which is a transform, so anything measuring
  // where a row is during those 380ms measures a page that is still moving and
  // lands somewhere else. And the page repaints on every row pressed: a scroll
  // would have to be suppressed on all but the first paint, or it would drag
  // the page back under the hand at every touch. An order is computed once and
  // is simply true afterwards.

  // ---------- finding changes the view, never the collection ----------
  //
  // A title names the collection. It cannot also be a query without turning a
  // simple act of naming into a hidden list command. Finding therefore has its
  // own field and uses the same mixed-library semantics as the rest of the app:
  // names, cities, tags, notes, authors and years all answer in one place.
  //
  // The search source is only this composer's pool. In particular an assistant
  // draft never widens into private originals, and a capped answer never finds
  // records outside the three-item choice it was given. Filtering changes only
  // which rows stand on the page; selected ids remain selected until a person
  // presses a row or an explicit selection control.
  const nameOfTag = (id) => tagById(id)?.name;
  let query = '';
  let shownPlaces = pool;
  let shownWays = wayPool;
  let shownBooks = bookPool;
  let cityGroups = citiesHeld(pool, first);
  let showBands = cityGroups.length > 1 || (!!cityGroups[0] && cityGroups[0].label !== PLACELESS);
  let offer = null;

  // What the search field has left standing, worked out afresh before every
  // render. One searchLibrary call decides all three kinds together. Results
  // retain their source records by reference, so ids do not need to be guessed
  // across kinds and the existing order remains stable.
  //
  // The city offer is read from the place pool and the query, not the title. It
  // speaks for the whole city even when another search term shows only part of
  // it; its count makes that wider action explicit before the press.
  //
  // Under a cap there is no offer at all, for the reason the band word has
  // none: a surface that promises three cannot have a single press on it that
  // quietly encloses nine.
  const reckon = () => {
    const q = query.trim();
    const currentPlaces = placePoolNow();
    const currentWays = wayPoolNow();
    const currentBooks = bookPoolNow();
    const found = q ? searchLibrary({
      places: currentPlaces, routes: currentWays, books: currentBooks, tags: allTags(),
    }, q) : null;
    shownPlaces = found ? found.filter(item => item.kind === 'place').map(item => item.record) : currentPlaces;
    shownWays = found ? found.filter(item => item.kind === 'path').map(item => item.record) : currentWays;
    shownBooks = found ? found.filter(item => item.kind === 'book').map(item => item.record) : currentBooks;
    const named = q ? cityTyped(currentPlaces, q) : null;
    cityGroups = citiesHeld(shownPlaces, named ? named.label : (!q ? first : ''));
    showBands = cityGroups.length > 1 || (!!cityGroups[0] && cityGroups[0].label !== PLACELESS);
    // a city whose every place is already in has nothing left to offer, and a
    // word that does nothing when pressed is worse than no word at all
    offer = named && !cap && !named.places.every(p => chosen.has(p.id)) ? named : null;
  };
  // A word that takes a whole city in or out. Under a cap there is no such
  // word at all: the answer-with-three surface promises three, and a single
  // press that quietly enclosed nine would break the only promise it makes.
  //
  // And none on the city being offered under the field, because that offer is
  // the same act on the same city, and a narrowing to one city stacked the two
  // within three lines of each other: the name twice, the word twice, and no
  // way to tell which of them was the real one. One act, one word. The moment
  // the offer is taken the city is whole, the offer goes, and the band's own
  // word comes back saying "all of it out", which is the act that is left.
  const cityWord = (g, gi) => cap || (offer && g.label === offer.label) ? '' :
    `<button class="fb-all" data-cg="${gi}">${g.places.every(p => chosen.has(p.id)) ? 'remove all' : 'add all'}</button>`;
  const band = (label, word) =>
    `<div class="fol-band mono"><span class="fb-city">${esc(label.toLowerCase())}</span>${word}</div>`;
  // What you would say about it, said here.
  //
  // The note is the only thing in a folio that is not a fact. It is the reason
  // the place is in it, and it is the thing a person is deciding about at the
  // moment they are deciding what to send: a line written for themselves two
  // years ago is not the line they would say to Ada now. Sending them to the
  // plate to fix it would cost them the composition they are in the middle of.
  //
  // Only under a place that is in. A word under all two hundred is noise, and
  // the question only arises about the ones actually going.
  //
  // The word is a sibling of the row and not inside it, for the reason the
  // index rows were rebuilt: a control inside a control is unreachable by a
  // keyboard and is not agreed upon by two engines.
  let saying = null;
  const placeRow = (p) => {
    const inIt = chosen.has(p.id);
    const said = (p.note || '').trim();
    return `<div class="fol-item">
      <button class="fol-row" data-fid="${esc(p.id)}" aria-pressed="${inIt}">
        <span class="in" aria-hidden="true">${inIt ? '✓' : '＋'}</span>
        <span class="nm">${esc(p.name)}</span>
        <span class="sub">${p.thanks?.length ? `\u2665 ${p.thanks.length} · ` : ''}${esc(staysBehind(p))}</span>
      </button>
      ${inIt && saying !== p.id ? `<button class="fol-say" data-say="${esc(p.id)}" aria-expanded="false">
        <span class="sr-only">${said ? 'Edit the atlas note' : 'Atlas note'} for ${esc(p.name)}: </span>${said
          ? `<span class="fs-said">${esc(said)}</span>`
          : '<span class="fs-none">add its atlas note</span>'}</button>` : ''}
      ${inIt && saying === p.id ? `<div class="fol-note-edit">
        <textarea class="fol-saying" data-saying="${esc(p.id)}"
          aria-label="Edit the atlas note for ${esc(p.name)}" aria-describedby="folNoteHelp"
          rows="2" maxlength="2000" placeholder="Add a note to this place">${esc(p.note || '')}</textarea>
        <p class="fol-note-help" id="folNoteHelp">This is the place’s atlas note. Changes appear everywhere you use it.</p>
      </div>` : ''}
    </div>`;
  };

  // ---------- the two doors ----------
  //
  // Keeping is not a door. A place marked never to leave may be filed and kept
  // like any other, and the shelf is the person's own house. It is the link and
  // the sheet that go outside, so the word is read at both of them, at the
  // moment of leaving, and what stays behind is said before anything moves
  // rather than discovered afterwards in a toast.

  // What leaves by this door, or null if the person turned back.
  //
  // Three different things can keep a record at home, and all three are said
  // here, in one sentence, before anything moves.
  //
  // A word on the record: `mayLeave` reads it, and it is the person's own
  // instruction or the loan they have not adopted yet.
  //
  // A door that carries no ways at all.
  const doorSnapshot = ({ carriesWays = true } = {}) => {
    if (!loadLatestAtlas()) return null;
    const enclosedPlaces = selection();
    const enclosedWays = wraySelection();
    const enclosedBooks = bookSelection();
    const places = enclosedPlaces.filter(mayLeave);
    const books = enclosedBooks.filter(mayLeave);
    // dropped rather than held back: the word on the record has nothing to do
    // with it, this door simply does not carry this kind of thing
    const dropped = carriesWays ? [] : enclosedWays;
    const held = [...enclosedPlaces, ...enclosedBooks, ...(carriesWays ? enclosedWays : [])].filter(r => !mayLeave(r));
    const ways = [], tooShort = [];
    for (const r of (carriesWays ? enclosedWays : []).filter(mayLeave)) {
      const out = store.trimWay(r);
      if (out) ways.push(out); else tooShort.push(r);
    }

    const never = held.filter(r => r.private).length;
    const tags = tagsFor([...places, ...books], ways);
    const key = disclosureFingerprint({
      places, ways, books, tags,
      held: held.map(r => [r.id, !!r.private]),
      dropped: dropped.map(r => r.id),
      tooShort: tooShort.map(r => [r.id, r.name]),
    });
    return {
      enclosedPlaces, enclosedWays, enclosedBooks,
      places, books, tags, dropped, held, ways, tooShort, never, key,
    };
  };

  const throughTheDoor = async (where, yes, { carriesWays = true } = {}) => {
    const snapshot = doorSnapshot({ carriesWays });
    if (!snapshot) return null;
    const {
      enclosedPlaces, places, books, dropped, held, ways, tooShort, never,
    } = snapshot;

    // Nothing can leave by this door. This used to be asked only once a word
    // on a record had already held something back, so a folio of paths alone
    // walked past it and was published empty, in silence.
    //
    // And when a word on a record is what stopped it, that word is named and
    // answered. The atlas the app suggests first is entirely on loan, so this
    // is the end of the whole journey for a person on their first afternoon.
    const going = places.length + ways.length + books.length;
    if (!going) {
      if (dropped.length && !enclosedPlaces.length) {
        return toast('direct sharing needs at least one place. this collection contains only paths');
      }
      // and when no word on any record held anything back, what is enclosed is
      // paths whose ends cannot be hidden, which is the geometry and not the
      // person. saying a loan held them back would be a plain untruth.
      if (!held.length) {
        return toast(tooShort.length === 1
          ? 'the selected path is too short to hide its start and end safely'
          : 'the selected paths are too short to hide their starts and ends safely',
        6500);
      }
      return toast(nothingLeaves(), 6500);
    }

    const said = [
      held.length ? `${staysBehindLine(never)} ${SHARING_EXCLUSION_COPY}` : '',
      dropped.length
        ? `Direct sharing carries places, so ${dropped.length === 1 ? 'the selected path stays' : `the ${dropped.length} selected paths stay`} in your collection.`
        : '',
      tooShort.length
        ? `${tooShort.length} selected path${tooShort.length === 1 ? ' is' : 's are'} too short to hide ${tooShort.length === 1 ? 'its start and end' : 'their starts and ends'} safely, so ${tooShort.length === 1 ? 'it stays' : 'they stay'} out.`
        : '',
    ].filter(Boolean);
    if (said.length && !await ask(`${said.join(' ')} ${going === 1 ? 'The remaining item goes' : `The remaining ${going} items go`} ${where}.`,
      { yes, no: 'go back' })) return null;
    return snapshot;
  };

  // The fields are written once and then left alone; only the results beneath
  // them are repainted. A search must never replace its own caret or dismiss a
  // phone keyboard in the middle of a word.
  const head = () => `
    ${store.folios.length || kept ? `<button class="fol-back mono" id="folBack">‹ all collections</button>` : ''}
    <div class="fol-field fol-title-field">
      <label class="fol-label mono" for="folTitle">title</label>
      <input class="fol-title" id="folTitle" placeholder="Name your collection" value="${esc(title)}" maxlength="80">
    </div>
    <div class="fol-field">
      <label class="fol-label mono" for="folDed">collection note · optional</label>
      <input class="fol-ded" id="folDed" placeholder="Add context" value="${esc(dedication)}" maxlength="140">
    </div>
    <div class="fol-field fol-find-field">
      <label class="fol-label mono" for="folFindItems">find items</label>
      <input class="fol-find" id="folFindItems" type="search" placeholder="Place, city, tag, path, or book"
        value="${esc(query)}" autocomplete="off" spellcheck="false" enterkeyhint="search">
    </div>`;

  const below = () => {
    reckon();
    // What is enclosed, and how much of it will never travel.
    //
    // It said "stays behind at the door", and the primary word on this surface
    // is "keep this folio". Keeping holds every one of them: the shelf is the
    // person's own house and no door is involved, so the line contradicted the
    // button under it. What is true whichever word is pressed is that some of
    // these records will not go anywhere, ever, until the word on them changes.
    const staying = [...selection(), ...wraySelection(), ...bookSelection()].filter(r => !mayLeave(r)).length;
    const behind = staying ? `, ${staying} excluded from sharing` : '';
    // The count goes on counting what is enclosed out of everything owned,
    // whatever the field has hidden, because that is the number the doors and
    // the shelf will act on. How many rows are standing is a second thing, and
    // it is said only while something is actually being held back, in the words
    // that name what did it: nobody should have to guess why a list is short.
    const selectedCount = chosen.size + chosenWays.size + chosenBooks.size;
    const visibleCount = shownPlaces.length + shownWays.length + shownBooks.length;
    const offerHost = $('#folOffer');
    if (offerHost) offerHost.innerHTML = offer ? `<button class="fol-offer mono" id="folCityIn">
        <span class="fo-city">${esc(offer.label.toLowerCase())}</span>
        <span class="fo-word">${offer.places.length} place${offer.places.length === 1 ? '' : 's'} · add all</span>
      </button>` : '';
    const count = cap
      ? `${selectedCount} of ${cap} selected · ${visibleCount} visible${behind}`
      : `${selectedCount} selected · ${visibleCount} visible${behind}`;
    const countEl = $('#folCount');
    if (countEl && countEl.textContent !== count) countEl.textContent = count;
    return `<div class="fol-acts fol-primary-actions">
        ${cap ? '' : `<button class="word-btn" id="folKeep">${kept ? 'save changes' : 'save collection'}</button>`}
        <!-- The word names the road only while there is one road. With people
             to write to there are two, so the first press opens those roads. -->
        <button class="word-btn${cap ? '' : ' quiet'}" id="folCopy">${cap ? 'send them back' : store.letters.pairs.some(maySend) ? 'share collection' : 'copy collection link'}</button>
        <div class="word-row road-row" id="folHandRow" hidden></div>
      </div>
      <div class="fol-save-note">Saving shares nothing. Sharing or printing makes a snapshot.</div>
      ${query.trim() && !visibleCount ? `<div class="fol-no-results" role="status">
        <span>No items match “${esc(query.trim())}”.</span>
        <button class="word-btn quiet" id="folClearFind">clear search</button>
      </div>` : ''}
      ${cityGroups.map((g, gi) =>
        `${showBands ? band(g.label, cityWord(g, gi)) : ''}${[...g.places]
          .sort((x, y) => (y.thanks?.length ? 1 : 0) - (x.thanks?.length ? 1 : 0))
          .map(placeRow).join('')}`).join('')}
      ${shownWays.length ? `${band('paths', cap ? '' : `<button class="fb-all" data-wall="1">${shownWays.every(r => chosenWays.has(r.id)) ? 'remove all' : 'add all'}</button>`)}${shownWays.map(r => `
        <button class="fol-row" data-wid="${esc(r.id)}" aria-pressed="${chosenWays.has(r.id)}">
          <span class="in" aria-hidden="true">${chosenWays.has(r.id) ? '✓' : '＋'}</span>
          <span class="nm">${esc(r.name)}</span>
          <span class="sub">${esc(staysBehind(r) || `${fmtKm(r.km)}${Number.isFinite(r.ascent) ? ` · ${r.ascent} m up` : ''}`)}</span>
        </button>`).join('')}` : ''}
      ${shownBooks.length ? `${band('books', cap ? '' : `<button class="fb-all" data-ball="1">${shownBooks.every(b => chosenBooks.has(b.id)) ? 'remove all' : 'add all'}</button>`)}${shownBooks.map(b => `
        <button class="fol-row" data-bkid="${esc(b.id)}" aria-pressed="${chosenBooks.has(b.id)}">
          <span class="in" aria-hidden="true">${chosenBooks.has(b.id) ? '✓' : '＋'}</span>
          <span class="nm">${esc(b.title)}</span>
          <span class="sub">${esc(staysBehind(b) || [b.author, b.year].filter(Boolean).join(', '))}</span>
        </button>`).join('')}` : ''}
      <div class="fol-acts fol-secondary-actions">
        ${cap ? '' : '<button class="word-btn quiet" id="folPrint">print, or save as pdf</button>'}
        ${cap ? '' : read
          ? `<button class="word-btn quiet" id="folWiden">add from everything you keep</button>`
          : visibleCount ? `<button class="word-btn quiet" id="folAll">${query.trim() ? 'select visible' : 'select all'}</button>` : ''}
        ${read || (!visibleCount && !cap) ? '' : `<button class="word-btn quiet" id="folNone">${cap ? 'start over' : query.trim() ? 'clear visible selection' : 'clear selection'}</button>`}
        ${kept && !cap ? '<button class="word-btn quiet" id="folRemove">remove collection</button>' : ''}
      </div>`;
  };

  const paint = () => {
    // the composer can still be empty, on an atlas that is itself empty or on
    // an arrangement nothing answers. the shelf and the filing panel both say
    // so in words; this used to say it with a blank page.
    if (!pool.length && !wayPool.length && !bookPool.length) {
      const bare = !allPlaces().length && !allRoutes().length && !allBooks().length;
      body.innerHTML = `
        ${store.folios.length || kept ? `<button class="fol-back mono" id="folBack">‹ all collections</button>` : ''}
        ${agentView
          ? `<div class="ix-empty"><div class="ix-empty-law">No assistant-visible items are available for this collection.</div>
              <p>Close this draft and choose something else with your assistant.</p>
            </div>`
          : bare
          ? `<div class="ix-empty"><div class="ix-empty-law">Collections are made from things you keep, and this atlas is empty.</div>
              <p><button class="word-btn" id="folFind" style="font-size:inherit;letter-spacing:0;text-transform:none">Keep your first thing</button>, or explore the
              <button class="word-btn" id="folDemo" style="font-size:inherit;letter-spacing:0;text-transform:none">example atlas</button>.</p>
            </div>`
          : `<div class="ix-empty"><div class="ix-empty-law">There is nothing to add from this view.</div>
              <p>Use <button class="word-btn quiet" id="folEverything">your whole atlas</button> instead.</p>
            </div>`}`;
      $('#folBack')?.addEventListener('click', () => leaveFor(openFolioShelf));
      $('#folFind')?.addEventListener('click', () => closeSurface('folioOverlay', openPalette));
      $('#folDemo')?.addEventListener('click', () => closeSurface('folioOverlay', previewDemo));
      $('#folEverything')?.addEventListener('click', () => leaveFor(
        () => openFolioComposer({ fresh: true, title, dedication, cap }),
      ));
      return;
    }
    // The selection count is one durable live region. Rebuilding the node on
    // every press makes some screen readers treat each update as a new room
    // and others announce nothing at all.
    body.innerHTML = `${head()}<div id="folOffer"></div><div class="fol-count" id="folCount" aria-live="polite" aria-atomic="true"></div><div id="folBelow"></div>`;

    $('#folBack')?.addEventListener('click', () => leaveFor(openFolioShelf));
    $('#folTitle').addEventListener('input', (event) => { title = event.target.value; });
    $('#folDed')?.addEventListener('input', (event) => { dedication = event.target.value; });
    $('#folFindItems').addEventListener('input', (event) => {
      query = event.target.value;
      repaintBelow();
    });
    repaintBelow();
  };

  // Everything under the two fields, rewired after every rewrite. The fields
  // themselves are never in here, so a person can type through all of it.
  // Opening the line, and keeping what is typed into it.
  //
  // The writing is saved as it is typed, through the same debounce every other
  // field in the app uses, and the page is not repainted while a person is in
  // the middle of a sentence: a repaint would take the caret with it. The list
  // catches up when the field is left.
  //
  // Editing a sample makes it yours, here as everywhere else. That is not a
  // side effect, it is the whole of what the word means, and it is what lets a
  // person fix a line and then actually send the place.
  const wireSaying = () => {
    $$('.fol-say', body).forEach(w => w.addEventListener('click', () => {
      saying = w.dataset.say;
      repaintBelow();
      $(`[data-saying="${saying}"]`, body)?.focus();
    }));
    const field = $('.fol-saying', body);
    if (!field) return;
    const id = field.dataset.saying;
    writesLater(field, `folio-note-${id}`, (text) => {
      store.updatePlace(id, { note: text, sample: false });
    });
    field.addEventListener('blur', () => { saying = null; repaintBelow(); renderAll(); });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); field.blur(); }
    });
  };

  const repaintBelow = () => {
    const under = $('#folBelow');
    if (!under) return;
    const before = document.activeElement;
    const focusMark = (under.contains(before) || $('#folOffer')?.contains(before)) ? {
      id: before.id || '',
      data: ['fid', 'wid', 'bkid', 'cg', 'wall', 'ball', 'say']
        .map(k => [k, before.dataset?.[k]])
        .find(([, v]) => v !== undefined) || null,
    } : null;
    under.innerHTML = below();
    wireSaying();
    $('#folClearFind')?.addEventListener('click', () => {
      query = '';
      const field = $('#folFindItems');
      if (field) field.value = '';
      repaintBelow();
      // The clear word can be reached at the foot of a short screen. Restoring
      // focus without restoring the field left the keyboard attached to a
      // control entirely above the glass after the long list returned.
      field?.scrollIntoView({ block: 'center', inline: 'nearest' });
      field?.focus({ preventScroll: true });
    });
    $$('.fol-row', body).forEach(row => row.addEventListener('click', () => {
      readHead();
      const pid = row.dataset.fid, wid = row.dataset.wid, bkid = row.dataset.bkid;
      // the cap bounds everything that travels, not the places alone. way rows
      // used to sit outside it entirely, uncounted and uncapped, and rode out
      // on the link all the same: "3 of 3 chosen" could hand over six records
      const inAlready = pid ? chosen.has(pid) : wid ? chosenWays.has(wid) : chosenBooks.has(bkid);
      if (!inAlready && cap && chosen.size + chosenWays.size + chosenBooks.size >= cap) {
        return toast('you can send three items. remove one before adding another');
      }
      if (pid) chosen.has(pid) ? chosen.delete(pid) : chosen.add(pid);
      if (wid) chosenWays.has(wid) ? chosenWays.delete(wid) : chosenWays.add(wid);
      if (bkid) chosenBooks.has(bkid) ? chosenBooks.delete(bkid) : chosenBooks.add(bkid);
      repaintBelow();
    }));
    // The city under the field, in one press. It is the gesture that was asked
    // for, and it is a press rather than something the typing does by itself:
    // the app offers, and the person decides. The whole city goes in, including
    // any of it the title is not currently showing, which is what the line says
    // it will do and what the count line then reports.
    $('#folCityIn')?.addEventListener('click', () => {
      readHead();
      offer.places.forEach(p => chosen.add(p.id));
      repaintBelow();
    });
    // a whole city, in or out on one press. it reads what the city is now
    // rather than what the last press left, so a city half in goes fully in
    // and only a city already whole comes out.
    $$('[data-cg]', body).forEach(w => w.addEventListener('click', (e) => {
      e.stopPropagation();
      readHead();
      const g = cityGroups[Number(w.dataset.cg)];
      if (!g) return;
      const whole = g.places.every(p => chosen.has(p.id));
      g.places.forEach(p => whole ? chosen.delete(p.id) : chosen.add(p.id));
      repaintBelow();
    }));
    $$('[data-wall]', body).forEach(w => w.addEventListener('click', (e) => {
      e.stopPropagation();
      readHead();
      const whole = shownWays.every(r => chosenWays.has(r.id));
      shownWays.forEach(r => whole ? chosenWays.delete(r.id) : chosenWays.add(r.id));
      repaintBelow();
    }));
    $$('[data-ball]', body).forEach(w => w.addEventListener('click', (e) => {
      e.stopPropagation();
      readHead();
      const whole = shownBooks.every(b => chosenBooks.has(b.id));
      shownBooks.forEach(b => whole ? chosenBooks.delete(b.id) : chosenBooks.add(b.id));
      repaintBelow();
    }));
    // Every row is on the page, so the word means what it says. It stopped
    // needing a second name for itself the moment typing stopped hiding
    // things: a control whose reach is exactly what a person can see.
    $('#folAll')?.addEventListener('click', () => {
      readHead();
      shownPlaces.forEach(p => chosen.add(p.id));
      shownWays.forEach(r => chosenWays.add(r.id));
      shownBooks.forEach(b => chosenBooks.add(b.id));
      repaintBelow();
    });
    // The way out of the folio and into the house. A folio being read shows
    // what it holds, and this is the word that says the rest of your atlas is
    // still there, one press behind the page.
    $('#folWiden')?.addEventListener('click', () => {
      readHead();
      // the head is carried across rather than written: widening is not
      // keeping, and a title typed here is not kept until the word says so
      leaveFor(() => openFolioComposer({ folioId: kept.id, title, dedication }));
    });
    $('#folNone')?.addEventListener('click', () => {
      readHead();
      // under a cap the word is "start over", and starting over is the whole of
      // it: the three are few enough to be seen at once and there is nothing
      // out of sight for the word to leave behind.
      if (cap) { chosen.clear(); chosenWays.clear(); chosenBooks.clear(); }
      else {
        shownPlaces.forEach(p => chosen.delete(p.id));
        shownWays.forEach(r => chosenWays.delete(r.id));
        shownBooks.forEach(b => chosenBooks.delete(b.id));
      }
      repaintBelow();
    });

    $('#folKeep')?.addEventListener('click', () => {
      const t = needsTitle();
      if (!t) return;
      const patch = {
        title: t,
        dedication: $('#folDed').value.trim(),
        placeIds: [...chosen],
        routeIds: [...chosenWays],
        bookIds: [...chosenBooks],
      };
      const saved = kept ? store.updateFolio(kept.id, patch) : store.addFolio(newFolio(patch));
      if (!saved) return toast('this browser refused to keep it');
      onFolioClosed = null; // kept by hand: the guard has nothing left to ask
      toast(kept ? 'changes saved' : 'collection saved');
      // and what is kept is what is shown: the folio, not the atlas it was
      // chosen from
      openFolioComposer({ folioId: saved.id, reading: true });
    });

    // One folio, two roads, and the difference between them is a sentence and
    // a cap rather than a second construction. What is enclosed is decided by
    // the same door, built by the same call, and counted off the same payload;
    // a folio that reads one way as a link and another way as a letter would
    // be two features wearing one word.
    //
    // `forLink` is the one flag that genuinely differs, and it is the flag
    // buildDisclosure already takes: a link is a thing anybody may come to
    // hold, and a letter is opened by one key.
    const handTheFolio = async (pair, button) => {
      const t = needsTitle();
      if (!t) return;
      const letter = !!pair;
      // the door is read before a byline is even asked for: nobody should be
      // asked their name for a folio they are about to turn back from. the
      // ways come back from it already trimmed, and the ones it would not trim
      // are named in its sentence rather than in a second one of this handler's
      // own, which the sheet next door never had
      const going = await throughTheDoor(letter ? 'in this direct message' : 'in the link', 'share the rest');
      if (!going) return;
      let approvedAuthor = null;
      const stillReviewed = () => {
        const latest = doorSnapshot();
        if (latest && latest.key === going.key
          && (approvedAuthor === null || authorNow() === approvedAuthor)) return true;
        if (latest) toast('This collection changed. Review it again before sharing.');
        return false;
      };
      // and then this door's own sentence, which the sheet next door has had
      // since it was written. What stays behind is one question; what travels
      // is another, and only the second one can say that a link reaches
      // further than a sheet and cannot be called back. This door, the one the
      // whole feature is built around, said nothing at all: the note in full,
      // the saved link, the address and the road a place came by all left
      // without a word, and only the note was ever on the page.
      //
      // The counts are read off the payload itself rather than off the rows,
      // so the sentence and the link cannot disagree; it is the rule the atlas
      // panel is already built on. The byline is the one field stamped
      // afterwards, because it is asked for next: nobody signs a folio they
      // have not read yet.
      const folio = buildPayload('folio', {
        title: t,
        dedication: $('#folDed').value.trim(),
        author: store.settings.authorName || '',
        // a folio of ways alone still needs its vocabulary
        tags: going.tags,
        places: going.places,
        routes: going.ways,
        books: going.books,
      }, { forLink: !letter });
      const c = disclosureCounts(folio);
      const carries = [
        c.places ? `${c.places} place${c.places === 1 ? '' : 's'}` : '',
        c.routes ? `${c.routes} path${c.routes === 1 ? '' : 's'}` : '',
        c.books ? `${c.books} book${c.books === 1 ? '' : 's'}` : '',
        c.tags ? `${c.tags} tag label${c.tags === 1 ? '' : 's'}` : '',
        c.notes ? `${c.notes} note${c.notes === 1 ? '' : 's'}, in full` : '',
        'addresses and coordinates',
        c.links ? `${c.links} link${c.links === 1 ? '' : 's'} you saved` : '',
        c.bylines ? 'the road each of them travelled to reach you' : '',
      ].filter(Boolean).join(' · ');
      // The two sentences differ in the one place they must. A link reaches
      // whoever comes to hold it; a letter is sealed to one key and reaches
      // that key alone. Neither can be called back, and both say so, because
      // the thing that cannot be undone is the sending and not the road.
      if (!await ask(letter
        ? `This letter carries ${carries}. It is sealed to ${pair.name || 'them'} and nobody else can open it, and it cannot be recalled once it is sent.`
        : `This link carries ${carries}. Anyone holding it can read all of it, and it cannot be recalled once it is sent.`,
      { yes: 'hand it over', no: 'go back' })) return;
      const askedAuthor = await ensureAuthor();
      if (askedAuthor === null) return;
      if (!stillReviewed()) return;
      const author = authorNow();
      approvedAuthor = author;
      // stamped rather than rebuilt: one construction of one disclosure, and
      // the byline buildPayload puts on is applied here by hand
      folio.author = author.slice(0, 60);
      if (letter) {
        // the size a letter is refused at is the box's, not a link's, and it
        // is checked on the sealed bytes rather than on a guess about them.
        //
        // The composer is left standing, which is what the link road beside
        // this one does. Closing it here read as a discard: the guard that
        // catches an unsaved composition fires on the way out and says the
        // composition is on the shelf and not lost, which landed on top of
        // `sent to Bruno` and told somebody who had just handed a folio to a
        // friend that nothing had happened except a near miss.
        await sendLetterTo(pair, {
          kind: 'folio', payload: folio, noun: 'collection', stillAllowed: stillReviewed,
        }, button);
        return;
      }
      const url = packPayload(folio);
      if (url.length > LINK_HARD_LIMIT) {
        return toast('this collection is too long for one link. remove a few things, or print it');
      }
      handOver(url, 'the collection', {
        title: t,
        text: `${t}${author ? `, a collection from ${author}` : ', a collection'}`,
      });
    };
    $('#folCopy').addEventListener('click', () => {
      // a folio being sent back to the person who asked for it already has its
      // addressee, so there is nothing to choose between
      if (cap) return void handTheFolio(null);
      roadsUnder($('#folHandRow'), {
        onPerson: (pair, b) => handTheFolio(pair, b),
        onLink: () => handTheFolio(null),
      });
    });
    $('#folPrint')?.addEventListener('click', async () => {
      const t = needsTitle();
      if (!t) return;
      const going = await throughTheDoor('on the printed page', 'print the rest');
      if (!going) return;
      const reviewed = () => {
        const latest = doorSnapshot();
        if (!latest || latest.key !== going.key) return null;
        return {
          title: t,
          dedication: $('#folDed').value.trim(),
          places: latest.places,
          routes: latest.ways,
          books: latest.books,
          tags: latest.tags,
        };
      };
      printSheet({
        title: t,
        dedication: $('#folDed').value.trim(),
        places: going.places,
        routes: going.ways,
        books: going.books,
        tags: going.tags,
      }, { refresh: reviewed });
    });
    $('#folRemove')?.addEventListener('click', async () => {
      if (!await ask(`Remove “${kept.title}” from Collections? Its things stay in your atlas.`, { yes: 'remove collection', no: 'keep it', danger: true })) return;
      store.removeFolio(kept.id);
      toast('collection removed. everything is still in your atlas');
      onFolioClosed = null;
      openFolioShelf();
    });

    // Repainting the count and every row must not throw a keyboard or
    // screen-reader user back to the page. Return to the same decision after
    // its wording changes; if it disappeared, keep focus on the dialog rather
    // than raising an unrelated field and keyboard.
    if (focusMark) {
      let target = focusMark.id ? document.getElementById(focusMark.id) : null;
      if (!target && focusMark.data) {
        const [key, value] = focusMark.data;
        target = $$(`[data-${key}]`, under).find(el => el.dataset[key] === value) || null;
      }
      (target || $('#folioOverlay'))?.focus({ preventScroll: true });
    }
  };
  paint();
  openSurface('folioOverlay');
  // ---------- fill in what is known, ask only what cannot be ----------
  //
  // A composer opened from a city arrives knowing its title and knowing what
  // is in it. The one thing it cannot know is who this is for, which is also
  // the only thing that makes a folio a gift rather than a list, so that is
  // where the attention goes and nothing else is asked.
  //
  // Softly, though. On a phone a focused field raises the keyboard, and the
  // keyboard would cover the very rows the person came here to check before
  // they had read one of them. There the field simply waits, named by its own
  // placeholder, one tap away.
  if (attend === 'dedication') focusSoftly($('#folDed'));
  else if (!$('#folioOverlay')?.contains(document.activeElement)) $('#folioOverlay')?.focus();
}

// ---------- a city, handed over ----------
//
// Two surfaces offer a city, and they hand over two different things on
// purpose.
//
// From the command line the pool is the whole atlas, because a person who
// pressed Lisboa may well also want the one place in Cascais, and the city
// they pressed is simply already enclosed when the page opens.
//
// From a band in the index the pool is what was on the screen, filtered and
// all: the person is looking at their Lisbon places tagged food that they
// still want to go to, and a composer that quietly gave back the rows they had
// just filtered away would be answering a question nobody asked.
//
// The paths obey both of those readings, and used to obey neither: the whole
// atlas of them arrived under either door. From the command line they are the
// whole atlas because the places are. From a band they are that band's city,
// out of the arrangement showing, because a folio for Lisbon has no business
// carrying a walk in Basel.
// Either way the city that was pressed goes to the top of the page it opens.
// From a band that is the only city there is; from the command line it is one
// of many, and it is the one the press was about.
function composeForCity(label, places, { whole = true } = {}) {
  openFolioComposer(whole
    ? { fresh: true, title: label, preselect: places.map(p => p.id), attend: 'dedication', first: label }
    : { places, ways: filteredRoutes().filter(r => cityLabel(r) === label), title: label, attend: 'dedication', first: label });
}

// filing a place into a folio, from the place itself: the gesture a library
// grows by. one tap for the shelf, one for the folio.
// One door for filing anything a folio can hold. The id tells the kind:
// records wear unique ids across kinds, so a book's id answers from the
// shelf and everything else answers from the field, and the folio's own
// field for that kind is the one that changes.
function fileIntoFolio(recordId) {
  const body = $('#folioBody');
  const book = store.bookById(recordId);
  const route = routeById(recordId);
  const field = book ? 'bookIds' : route ? 'routeIds' : 'placeIds';
  const said = book ? book.title : route ? route.name : (placeById(recordId)?.name || '');
  const rows = store.folios.map(f => {
    const inIt = (f[field] || []).includes(recordId);
    return `<button class="fol-row" data-file="${esc(f.id)}" aria-pressed="${inIt}">
      <span class="in" aria-hidden="true">${inIt ? '✓' : '＋'}</span>
      <span class="nm">${esc(f.title)}</span>
      <span class="sub">${f.placeIds.length + f.routeIds.length + (f.bookIds || []).length} items</span>
    </button>`;
  }).join('');
  body.innerHTML = `
    <div class="fol-count">add “${esc(said)}” to</div>
    ${rows || '<div class="news-note">no collections yet.</div>'}
    <div class="fol-acts">
      <button class="word-btn quiet" id="folNewWith">create a new collection with it</button>
    </div>`;
  $$('[data-file]', body).forEach(b => b.addEventListener('click', () => {
    const f = store.folioById(b.dataset.file);
    const cur = f[field] || [];
    const has = cur.includes(recordId);
    const saved = store.updateFolio(f.id, {
      [field]: has ? cur.filter(x => x !== recordId) : [...cur, recordId],
    });
    if (!saved) return toast('this browser refused to keep it');
    toast(has ? `out of “${f.title}”` : `into “${f.title}”`);
    fileIntoFolio(recordId);
  }));
  $('#folNewWith').addEventListener('click', () => {
    openFolioComposer({ fresh: true, preselect: [recordId] });
  });
  openSurface('folioOverlay');
}

async function composeAsk() {
  const q = await askText('What recommendations are you looking for?', { yes: 'create request', placeholder: 'wine bars in lisbon', max: LIMITS.asking });
  if (!q || !q.trim()) return;
  const from = await ensureAuthor();
  if (from === null) return;
  const url = makeAskUrl({ from, q: q.trim() });
  handOver(url, 'the request', { title: `a request from ${from}`, text: `${from} asks: ${q.trim()}` });
}

// ---------- the sheet: the atlas typeset for paper, or pdf ----------

const DOC_TITLE = document.title;

// The sheet is words and drawn ground: names, cities, notes in full, exact
// coordinates, and a path's section. It carried photographs too for as long
// as there were any, on the reasoning that a page handed to one person by
// someone standing there has no address that outlives the intention. The same
// button has always also said save as pdf, and a pdf keeps no such promise,
// so that reasoning was never as settled as it read. Nothing is kept to
// typeset now, so the page is the same page with a row of figures gone from
// under each entry, and the print path has nothing left to wait for.
//
// `spare` is the sheet a browser's own Print command gets: names, cities and
// nothing else. That path cannot ask a question, because beforeprint is
// already the last moment, so it must be the one that assumes least.
function buildSheet({ title, dedication = '', author = store.settings.authorName, places, routes = [], books = [], tags = [], tagName = null, spare = false }) {
  const names = new Map(tags.map(tag => [tag.id, tag.name]));
  const nameOf = tagName || ((id) => names.get(id));
  // The heading this page has always grouped by now lives in find.js, because
  // the composer, the command line and the index all offer that same heading
  // as something a person can press. It was computed here, inline, and the
  // moment a second surface computed it too the two could drift: a person
  // would choose a city and be handed a page divided somewhere else.
  const groups = groupByCity(places);
  const nWays = routes.length;
  const signed = [
    author ? `kept by ${author}` : '',
    fmtDate(new Date().toISOString()).toLowerCase(),
    places.length ? `${places.length} place${places.length === 1 ? '' : 's'}` : '',
    nWays ? `${nWays} path${nWays === 1 ? '' : 's'}` : '',
    books.length ? `${books.length} book${books.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');

  let no = 0;
  const entry = (p) => {
    no += 1;
    // the tags a place is filed under, and whether it has been visited,
    // are things a person told this app about themselves. a sheet nobody
    // reviewed does not carry them either.
    const meta = spare ? '' : [
      p.tags.map(nameOf).filter(Boolean).join(', ').toLowerCase(),
      datumWord(p),
    ].filter(Boolean).join(' · ');
    return `<article class="sh-entry">
      <div class="sh-line"><span class="sh-no mono">${fmtNo(no)}</span><h3 class="sh-name">${esc(p.name)}</h3></div>
      ${meta ? `<div class="sh-meta">${esc(meta)}</div>` : ''}
      ${!spare && p.note ? `<p class="sh-note">${esc(p.note).replace(/\n/g, '<br>')}</p>` : ''}
      ${spare ? '' : `<div class="sh-coords mono">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>`}
    </article>`;
  };

  const ways = routes.map((r, i) => {
    // A path told more about a person than a place did, and the spare sheet
    // was not asking it to stop: how far, how much climbing, how long it
    // takes, what was written about it, and the ground drawn as a section.
    // A walk from a door is a routine, and its shape is the most personal
    // line in the atlas. The unreviewed sheet gets a name and a city.
    if (spare) {
      return `<article class="sh-entry">
        <div class="sh-line"><span class="sh-no mono">${r.loop ? 'O' : '/'}</span><h3 class="sh-name">${esc(r.name)}</h3></div>
        ${r.city ? `<div class="sh-meta">${esc(r.city)}</div>` : ''}
      </article>`;
    }
    const pf = profile(r.path, { width: 1000, height: 150, columns: 96 });
    const meta = [
      fmtKm(r.km),
      Number.isFinite(r.ascent) ? `${r.ascent} m up` : '',
      fmtHours(r.hours),
      r.loop ? 'a loop' : '',
    ].filter(Boolean).join(' · ');
    return `<article class="sh-entry">
      <div class="sh-line"><span class="sh-no mono">${r.loop ? 'O' : '/'}</span><h3 class="sh-name">${esc(r.name)}</h3></div>
      <div class="sh-meta">${esc(meta)}</div>
      ${r.note ? `<p class="sh-note">${esc(r.note).replace(/\n/g, '<br>')}</p>` : ''}
      ${pf ? `<div class="sh-profile">${profileSVG(pf)}</div>` : ''}
    </article>`;
  }).join('');

  // A book on the sheet is its title, its author and its year, and the note
  // in full. The spare sheet, which nobody reviewed, gets the title alone,
  // by the same rule that strips a place to its name.
  const shelfRows = books.map((b) => {
    if (spare) {
      return `<article class="sh-entry">
        <div class="sh-line"><span class="sh-no mono">¶</span><h3 class="sh-name">${esc(b.title)}</h3></div>
      </article>`;
    }
    const meta = [b.author, b.year].filter(Boolean).join(' · ');
    return `<article class="sh-entry">
      <div class="sh-line"><span class="sh-no mono">¶</span><h3 class="sh-name">${esc(b.title)}</h3></div>
      ${meta ? `<div class="sh-meta">${esc(meta)}</div>` : ''}
      ${b.note ? `<p class="sh-note">${esc(b.note).replace(/\n/g, '<br>')}</p>` : ''}
    </article>`;
  }).join('');

  $('#sheet').innerHTML = `
    <header class="sh-head">
      <div class="sh-mast mono">resonate</div>
      <h1 class="sh-title">${esc(title)}</h1>
      ${dedication ? `<p class="sh-ded">${esc(dedication)}</p>` : ''}
      <div class="sh-signed mono">${esc(signed)}</div>
    </header>
    ${[...groups.entries()].map(([city, list]) =>
      `${groups.size > 1 || city !== PLACELESS ? `<h2 class="sh-city mono">${esc(city.toLowerCase())}</h2>` : ''}
       ${list.map(entry).join('')}`).join('')}
    ${ways ? `<h2 class="sh-city mono">paths</h2>${ways}` : ''}
    ${shelfRows ? `<h2 class="sh-city mono">books</h2>${shelfRows}` : ''}
    <footer class="sh-colophon mono">resonate · resonate.select</footer>`;
  paginateSheet(title);
}

// ---------- the sheet counts its own pages ----------
//
// A page number in a browser is not a thing CSS will give you. The rule for it
// exists, `@page { @bottom-center { content: counter(page) } }`, and no engine
// implements it: it is honoured by the print-to-pdf engines a server runs and
// by nothing a person opens this app in. A footer pinned with position:fixed
// repeats on every sheet in two of the three engines and still cannot count,
// because nothing in CSS or in JavaScript tells an element which sheet it
// landed on. And a count worked out by dividing the height of the content by
// the height of a page is precisely a number that is not the number.
//
// So the app decides where the pages break. The blocks are already atomic and
// already refuse to break inside themselves; packing them into pages is
// arithmetic, and a number that comes out of that packing is true by
// construction rather than by estimate.
//
// The measuring is done at the narrower of the two common paper widths and the
// shorter of their two heights, so one packed page fits on one sheet of either
// A4 or letter. If a single block is taller than a page will hold, which takes
// a note longer than this comment and a section drawn under it, the packing is
// abandoned and the sheet prints as it always did: unnumbered, whole, and
// broken by the browser. Nothing is lost and no number is invented.
const SHEET_W_MM = 174;   // A4 210 less 36mm of margin, the narrower of the two
const SHEET_H_MM = 243;   // letter 279 less 36mm of margin, the shorter of the two
const SHEET_FOOT_MM = 12; // the line at the foot, and air above it

function paginateSheet(title) {
  const sheet = $('#sheet');
  const blocks = [...sheet.children];
  if (blocks.length < 2) return false;

  // laid out where nobody can see it, at the width paper will give it
  const held = sheet.getAttribute('style') || '';
  sheet.style.cssText = `display:block;position:absolute;left:-20000px;top:0;width:${SHEET_W_MM}mm;visibility:hidden`;

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:100mm';
  sheet.append(probe);
  const perMM = probe.offsetHeight / 100;
  probe.remove();

  const tall = (el) => {
    const cs = getComputedStyle(el);
    return el.offsetHeight + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);
  };
  const heights = blocks.map(tall);
  const budget = (SHEET_H_MM - SHEET_FOOT_MM) * perMM;

  // one block that cannot fit anywhere: the packing would be a fiction
  if (!perMM || heights.some(h => h > budget)) {
    sheet.style.cssText = held;
    return false;
  }

  const pages = [[]];
  let left = budget;
  blocks.forEach((el, i) => {
    if (heights[i] > left && pages[pages.length - 1].length) { pages.push([]); left = budget; }
    pages[pages.length - 1].push(el);
    left -= heights[i];
  });
  // a city heading is a promise that something follows it, so it never ends a
  // page. the same rule the stylesheet states for the browser's own breaks.
  for (let i = 0; i < pages.length - 1; i += 1) {
    const page = pages[i];
    while (page.length > 1 && page[page.length - 1].classList.contains('sh-city')) {
      pages[i + 1].unshift(page.pop());
    }
  }

  sheet.replaceChildren(...pages.map((page, i) => {
    const box = document.createElement('section');
    box.className = 'sh-page';
    box.append(...page);
    const foot = document.createElement('div');
    foot.className = 'sh-foot mono';
    foot.innerHTML = `<span class="sh-who">${esc(title || '')}</span><span class="sh-of">${i + 1} of ${pages.length}</span>`;
    box.append(foot);
    return box;
  }));
  sheet.style.cssText = held;
  return true;
}

// A sheet is a hand-over like any other, so the same word decides what is on
// it. This used to read the filtered lists straight, which meant a place
// marked never leaves, and every untouched sample record, was typeset with
// its coordinates under the person's own byline. `mayLeave` had been applied
// to the files and the links and not to the paper.
function atlasSheetOpts({ spare = false } = {}) {
  const author = store.settings.authorName;
  const places = filteredPlaces().filter(mayLeave);
  const routes = filteredRoutes().filter(mayLeave).map(r => store.trimWay(r)).filter(Boolean);
  const books = filteredBooks().filter(mayLeave);
  return {
    source: 'atlas',
    title: author ? `the atlas of ${author}` : 'an atlas',
    places,
    routes,
    books,
    tags: tagsFor([...places, ...books], routes),
    author,
    spare,
  };
}

// Every other exit here states what it is about to hand over. This one went
// from a button straight to the system dialog, and it is the exit that reaches
// furthest: a sheet is given to one person by hand, but the same button says
// "or save as pdf", and a pdf is a file like any other. It can be copied,
// forwarded and searched, and Resonate cannot recall it. So the sentence comes
// first, and the word after it is the only way to the dialog.
//
// It waited for photographs once, on both counts: it read them out of their
// store before the page was built, and then held print() back until every one
// of them had decoded, because print() does not wait for an image and a
// picture that has not arrived prints as a hole. Nothing is kept to typeset
// now, so there is nothing to resolve and nothing to hold back. What is left
// async is the question itself.
function sheetFingerprint(opts) {
  return disclosureFingerprint({
    title: opts.title,
    dedication: opts.dedication || '',
    author: opts.author || '',
    spare: !!opts.spare,
    places: opts.places || [],
    routes: opts.routes || [],
    books: opts.books || [],
    // A tag name is printed beside every place that wears it. Capture the
    // vocabulary as well as the records that point into it, or another tab
    // can change the printed words while the review is standing.
    tags: opts.tags || [],
  });
}

async function printSheet(opts, { refresh = null } = {}) {
  const atlasSource = opts?.source === 'atlas';
  const resolve = refresh || (atlasSource
    ? () => atlasSheetOpts({ spare: !!opts.spare })
    : () => opts);
  if (!loadLatestAtlas()) return;
  opts = resolve();
  if (!opts) return toast('This selection changed. Review it again before printing.');
  if (!opts.places.length && !(opts.routes || []).length && !(opts.books || []).length) return toast('nothing to print yet');
  const reviewed = sheetFingerprint(opts);

  const notes = opts.places.filter(p => p.note).length + (opts.routes || []).filter(r => r.note).length
    + (opts.books || []).filter(b => b.note).length;
  const lines = [
    `${opts.places.length} place${opts.places.length === 1 ? '' : 's'}`,
    (opts.routes || []).length ? `${opts.routes.length} path${opts.routes.length === 1 ? '' : 's'}` : '',
    (opts.books || []).length ? `${opts.books.length} book${opts.books.length === 1 ? '' : 's'}` : '',
    (opts.tags || []).length ? `${opts.tags.length} tag label${opts.tags.length === 1 ? '' : 's'}` : '',
    notes ? `${notes} note${notes === 1 ? '' : 's'}, in full` : '',
    'exact coordinates',
    (opts.author ?? store.settings.authorName) ? `shared by ${opts.author ?? store.settings.authorName}` : '',
  ].filter(Boolean).join(' · ');

  if (!await ask(`This sheet carries ${lines}. It can be copied, scanned or forwarded, and Resonate cannot recall it.`,
    { yes: 'print it', no: 'not now' })) return;

  if (!loadLatestAtlas()) return;
  const latest = resolve();
  if (!latest || sheetFingerprint(latest) !== reviewed) {
    return toast('This selection changed. Review it again before printing.');
  }
  buildSheet(latest);
  document.title = `resonate · ${latest.title}`;
  window.print();
}

// The system print command should never catch the raw map: typeset first.
//
// The browser's own Print command arrives with no chance to ask anything. It
// gets the spare sheet: what a person marked as travelling, by name and city,
// with no note, no link, no road it came by and no coordinate. Anything richer
// than that is chosen from inside the app, where there is a sentence to read
// first.
window.addEventListener('beforeprint', () => {
  if ($('#sheet').innerHTML) return;
  if (loadLatestAtlas({ notify: false })) buildSheet(atlasSheetOpts({ spare: true }));
  else $('#sheet').innerHTML = '<main class="print-sheet"><p>The atlas could not be read safely, so nothing was printed.</p></main>';
});
window.addEventListener('afterprint', () => {
  $('#sheet').innerHTML = '';
  document.title = DOC_TITLE;
});

// The newsstand is gone. It offered public folios ranked against the atlas,
// and the owner closed it on 2026-08-11: this app is the loop between people
// who know each other, and a public ranked feed is a different product
// wearing the same coat. queryMyAtlas below survives, because an ask is a
// person's question and has nothing to do with a stand.

// What of your atlas answers someone else's question.
//
// This used to split the question on whitespace and ask whether each run
// appeared anywhere inside a place, as a substring. So "what should we do in
// Lisbon?" matched "do" against every place in LonDON, "in" against BerlIN and
// SpaIN, and "we" against AntWErp, and the ask report printed the total at the
// person as though their atlas had answered. It had been printing that
// inflated number since the day it shipped. The rules that fix it are in
// find.js, along with the argument for why they are rules and not a list of
// English words.
// A question is an arrangement like any other, and the composer it opens is
// held to it. The ways were left out of the answer and then handed over whole
// underneath it: every path in the atlas, in a folio titled with somebody
// else's question. A path answers a question the same way a place does, so it
// is asked the same question and counted in the same breath.
function queryMyAtlas(q) {
  const words = wordsOf(q);
  if (!words.length) return { places: [], ways: [] };
  const nameOf = id => tagById(id)?.name;
  return {
    places: allPlaces().filter(p => answers(p, words, nameOf)),
    ways: allRoutes().filter(r => answers(r, words, nameOf)),
  };
}

// ---------- share ----------

// a link is a disclosure: it is read before it is made, never after.
// long fragments break in messaging apps and histories long before a browser
// refuses them, so a large atlas is offered as a file instead.
const LINK_SOFT_LIMIT = 8000;
const LINK_HARD_LIMIT = 16000;

function handOver(url, what, { title = '', text = '', road = '' } = {}) {
  const send = async () => {
    // where a system sheet exists it is the one true door: mail, whatsapp,
    // messages, whatever the device holds, chosen by its owner
    if (navigator.share) {
      try {
        await navigator.share(title || text ? { title, text, url } : { url });
        return 'shared';
      } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    // no sheet: the link is copied when the device allows, and the two
    // rails stand at the foot either way
    let copied = true;
    try { await navigator.clipboard.writeText(url); } catch { copied = false; }
    raiseHandBar(url, what, { title, text, copied, road });
    return copied ? 'copied' : 'offered';
  };
  return send();
}

function raiseHandBar(url, what, { title = '', text = '', copied = true, road = '' } = {}) {
  const bar = $('#handBar');
  $('#hbCopied').textContent = copied ? `${what} copied` : what;
  // The bar said only what had been copied, which on a thanks reads as a
  // receipt. Nothing has been sent: the link is on the clipboard, the person it
  // is for is not named, and `done` and the timeout both throw it away without
  // a word. A caller who knows the addressee says so here. Cleared on every
  // raise, or a road left over from a thanks would stand under the next atlas.
  const rd = $('#hbRoad');
  rd.textContent = road;
  rd.hidden = !road;
  const cp = $('#hbCopy');
  cp.hidden = copied;
  cp.onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      $('#hbCopied').textContent = `${what} copied`;
      cp.hidden = true;
    } catch { askText('Copy this link.', { value: url, yes: 'done', no: 'close', max: PASTED_LINK_MAX }); }
  };
  $('#hbMail').href = 'mailto:?subject=' + encodeURIComponent(title || what)
    + '&body=' + encodeURIComponent((text ? text + '\n\n' : '') + url);
  $('#hbWa').href = 'https://wa.me/?text=' + encodeURIComponent((text ? text + '\n' : '') + url);
  // some desktop mail clients cut a body around two thousand characters; said
  // before the paste rather than discovered in a broken one. the panel that
  // made the link says its own version of this past eight thousand, so a long
  // link is named twice, at two bounds, for two different carriers.
  $('#hbNote').hidden = url.length <= 1800;
  bar.onkeydown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    bar.onkeydown = null;
    dropDialog(bar);
  };
  // A share choice must not disappear while it is being read or while a
  // switch-control user is travelling to it. It remains until Done or Escape.
  raiseDialog(bar);
}

async function shareMap() {
  if (!loadLatestAtlas()) return;
  const places = sharablePlaces();
  const { ways: routes, tooShort } = sharableWays();
  const books = sharableBooks();
  // an atlas of ways and no places is still an atlas. this used to stop at
  // the places and never look at the ways it had just finished computing, so
  // a person who kept only walks could not hand over anything at all.
  //
  // One word holds a record back now, and the sentence below says so.
  const held = [...allPlaces(), ...allRoutes(), ...allBooks()].filter(r => !mayLeave(r));
  const never = held.filter(r => r.private).length;
  const kept = held.length;
  if (!places.length && !routes.length && !books.length) {
    // A word on a record is the reason that has a remedy, so it is the one
    // named when both are true: a path too short to hide its ends is refused
    // by geometry, and there is nothing a person can do about the geometry.
    if (kept && !tooShort.length) return toast(nothingLeaves(), 6500);
    if (kept) return toast(`${staysBehindLine(never)} ${tooShortLine(tooShort)}`, 6500);
    return toast(tooShort.length
      ? 'every path here is too short to hide its start and end safely'
      : 'nothing to hand over yet');
  }
  // The panel is painted before a name is asked for, which is this file's own
  // rule and the folio door's own order. This door had it backwards: pressing
  // `hand over` dropped the shelf and raised the byline modal over an unpainted
  // panel, so a person who pressed the word to find out what it meant was asked
  // to sign before they were shown anything. The name is asked for at the
  // carriers below, where it is used, and stamped onto the disclosure there.
  const author = store.settings.authorName || '';
  const tags = tagsFor([...places, ...books], routes);
  // the panel and the payload read the same object, so they cannot disagree
  const disclosure = buildPayload('atlas', { places, routes, books, tags, author }, { forLink: true });
  // The panel is a consent snapshot, not a durable capability. Any atlas
  // change while it stands requires a fresh review; the sharing name is the
  // one expected exception because the carrier asks for it after this panel.
  const reviewed = unsignedDisclosureFingerprint(store.outward());
  const count = disclosureCounts(disclosure);
  // How many of the notes going out are words the sender did not write.
  //
  // The disclosure cannot answer this: the mark that says a record arrived
  // with the app is local bookkeeping and never travels, which is right. So it
  // is counted here, from the records themselves, and said at the door. A
  // byline names who handed an atlas over. It has never meant that every
  // sentence inside was theirs, and on the one surface where a person is about
  // to put their name to something, that difference is worth a line.
  const starterNotes = [...places, ...routes, ...books].filter(r => r.sample && r.note).length;
  const url = packPayload(disclosure);
  const bytes = url.length;
  const tooLong = bytes > LINK_HARD_LIMIT;
  const long = bytes > LINK_SOFT_LIMIT;

  // "what stays" names the things a person could reasonably fear are in the
  // link. It listed the photographs while they were in the records, because
  // they were the obvious candidate and the answer was no. When they left, a
  // line about the snapshots was written in their place, and that is a
  // promise about something that was never a candidate to travel: a snapshot
  // is a copy of the records already listed above, kept for this device to
  // bring the atlas back with. Naming it here is the reassurance implying the
  // risk, so it is not named.
  const body = $('#shareBody');
  body.innerHTML = `
    <div class="share-choices">
      <button class="share-choice" id="shFolio">
        <span class="share-choice-no">01</span>
        <span class="share-choice-copy"><span class="share-choice-title">Create a collection</span>
          <span class="share-choice-desc">Choose exactly what to include. Creating it shares nothing.</span></span>
        <span class="share-choice-mark" aria-hidden="true">›</span>
      </button>
      <button class="share-choice" id="shWhole" aria-expanded="false">
        <span class="share-choice-no">02</span>
        <span class="share-choice-copy"><span class="share-choice-title">Share the whole atlas</span>
          <span class="share-choice-desc">Review everything, then create a link or shared file.</span></span>
        <span class="share-choice-mark" aria-hidden="true"></span>
      </button>
    </div>
    <div id="shWholeRow" hidden>
    <div class="sh-what">
      <div class="sec-head" role="heading" aria-level="2">what travels</div>
      <ul class="sh-list">
        ${count.places ? `<li><b>${count.places}</b> place${count.places === 1 ? '' : 's'}: names and coordinates</li>` : ''}
        ${count.routes ? `<li><b>${count.routes}</b> path${count.routes === 1 ? '' : 's'}: a shape, its distance and its climb${routes.some(r => r.trimEnds) ? ', without the ends you hid' : ''}</li>` : ''}
        ${count.books ? `<li><b>${count.books}</b> book${count.books === 1 ? '' : 's'}: title, author, year, and reading status</li>` : ''}
        <li>addresses, cities, countries, tags, and status</li>
        ${count.notes ? `<li><b>${count.notes}</b> note${count.notes === 1 ? '' : 's'}, in full</li>` : ''}
        ${count.links ? `<li><b>${count.links}</b> link${count.links === 1 ? '' : 's'} you saved</li>` : ''}
        ${count.bylines ? `<li><b>${count.bylines}</b> sharing name${count.bylines === 1 ? '' : 's'} on records you received</li>` : ''}
        <li>${author ? `sharing name <b>${esc(author)}</b>` : 'sharing name: added before sending'}</li>
      </ul>
      ${starterNotes ? `<p class="sh-warn"><b>${starterNotes}</b> note${starterNotes === 1 ? ' is' : 's are'} unchanged starter text. Your sharing name identifies the sender, not each note's writer.</p>` : ''}
      <div class="sec-head" role="heading" aria-level="2">what stays</div>
      <ul class="sh-list">
        <li>your people, settings, and local snapshots</li>
      </ul>
      <p class="sh-warn">Anyone with this link can read and keep it. Sent links cannot be recalled.</p>
      ${kept ? `<p class="sh-warn">${staysBehindLine(never)} ${SHARING_EXCLUSION_COPY}</p>` : ''}
      ${tooShort.length ? `<p class="sh-warn">${tooShortLine(tooShort)}</p>` : ''}
      <p class="sh-size mono">${(bytes / 1024).toFixed(1)} kB link${long ? ' · some apps may break a link this long' : ''}${routes.length ? ' · the link rounds coordinates and simplifies paths; the shared file is exact' : ' · the link rounds coordinates; the shared file is exact'}</p>
    </div>
      <div class="word-row">
        ${tooLong ? '' : '<button class="word-btn quiet" id="shGo">as a link</button>'}
        <button class="word-btn quiet" id="shFile">as a shared file</button>
      </div>
      ${tooLong ? '<p class="sh-warn">This atlas is too long to travel as a link. The shared file carries it whole.</p>' : ''}
    </div>`;

  // The folio is the unit of this app's sharing: a composed slice for a
  // person, under a title. The whole atlas is the larger, rarer act, so its
  // two carriers wait behind one quiet word instead of standing as peers of
  // the thing the panel is for.
  $('#shWhole').addEventListener('click', () => {
    const row = $('#shWholeRow');
    row.hidden = !row.hidden;
    $('#shWhole').setAttribute('aria-expanded', String(!row.hidden));
  });
  const stillReviewed = () => {
    if (!loadLatestAtlas()) return false;
    if (unsignedDisclosureFingerprint(store.outward()) === reviewed) return true;
    closeSurface('shareOverlay');
    void shareMap();
    const open = !$('#shareOverlay').hidden;
    if (open) {
      const row = $('#shWholeRow');
      if (row) row.hidden = false;
      $('#shWhole')?.setAttribute('aria-expanded', 'true');
      toast('Your atlas changed. Review the updated share.');
    } else {
      toast('Your atlas changed. Nothing is currently available to share.');
    }
    return false;
  };
  $('#shGo')?.addEventListener('click', async () => {
    // the name at the moment it is used, with the panel still standing behind
    // the question so a person can see what they are signing. the disclosure is
    // signed rather than rebuilt: one construction, one carrier.
    const askedAuthor = await ensureAuthor();
    if (askedAuthor === null) return;
    if (!stillReviewed()) return;
    // stillReviewed has just reloaded settings as well as records. Use that
    // durable byline, not the value captured before a queued storage event.
    const signed = authorNow();
    const link = signed === author ? url : packPayload({ ...disclosure, author: signed.slice(0, 60) });
    // the kB above was measured before the name went on, and a name is bytes
    if (link.length > LINK_HARD_LIMIT) {
      return toast('this atlas is too long to travel as a link. the shared file carries it whole');
    }
    closeSurface('shareOverlay');
    handOver(link, 'your atlas', {
      title: signed ? `the atlas of ${signed}` : 'an atlas',
      text: signed ? `${signed} hands you their atlas` : 'an atlas, handed to you',
    });
  });
  // the same door as "compose a new folio" on the shelf, so it opens the same
  // way: nothing enclosed, the whole atlas waiting, "everything in" one press
  // away for the person who truly means the lot. The bare call fell through to
  // filteredPlaces() with every id preselected, which is the failure the
  // composer's own comment names out loud: the whole atlas, already enclosed,
  // one press from the door, under a panel preaching that a folio is the
  // better gift. The panel counts the whole atlas either way, so the pool is
  // the whole atlas here too rather than whatever the index was filtered to.
  $('#shFolio').addEventListener('click', () => { closeSurface('shareOverlay'); openFolioComposer({ fresh: true }); });
  $('#shFile').addEventListener('click', async () => {
    // the file carries the byline exactly as the link does, so the name is
    // asked for here too, at the moment it is used
    const askedAuthor = await ensureAuthor();
    if (askedAuthor === null) return;
    if (!stillReviewed()) return;
    closeSurface('shareOverlay');
    // the same object the link carries, written out rather than encoded. the
    // file used to be built somewhere else entirely, so it disclosed more
    // than the panel above it described: every tag in the atlas, and the
    // dates every record was made and last touched.
    //
    // it is asked for by name now rather than rebuilt here from the same
    // parts. two constructions of one disclosure agreed today and had no rule
    // obliging them to agree tomorrow, and the file an assistant is given is
    // promised to hold this exact atlas.
    download('resonate-shared-atlas.json', store.humanHandoverJSON(), 'application/json');
    toast('Shared file downloaded with paths drawn in full.');
  });
  openSurface('shareOverlay');
}

// ---------- the file an assistant is given, read before it leaves ----------
//
// Every other outward door in this app says what will leave before it opens.
// This one did not. It was a single press under a word naming a reader who is
// not a person, and it put the whole outward atlas into a portable file with
// nothing shown and nothing to press twice.
//
// Nothing on this surface is a number typed by hand. The bytes are written
// first, and the review reads them back: `file` is the parsed contents of the
// very string the press hands over, so the counts are counts of the file and
// not of an object built alongside it that ought to match. A field that JSON
// drops on the way out, `prov` on a record that has none, is already gone by
// the time anything here counts it. That is the whole reason for the parse.
//
// The rest is what a review of a machine-readable file has to say and a review
// of a link does not. The document inside names the use it was handed over
// for; naming is all a file can do, and this panel says so rather than leaving
// a person to read a protection into the presence of a terms address.
function renderAssistantFile() {
  if (!loadLatestAtlas()) return;
  const json = store.assistantCopyJSON();
  const file = JSON.parse(json);
  const atlas = file.disclosure;
  const reviewed = disclosureFingerprint(atlas);
  const count = disclosureCounts(atlas);
  const { tooShort } = sharableWays();
  const held = [...allPlaces(), ...allRoutes(), ...allBooks()].filter(r => !mayLeave(r));
  const never = held.filter(r => r.private).length;
  const travels = count.places || count.routes || count.books;

  // What is in the file, asked of the file. One line here used to be printed
  // whatever the atlas held: "addresses, cities, countries, been or want to
  // go". A person who keeps only walks was told their addresses were going,
  // and they had none; a person who had never marked a place been or wanted
  // was told the same. A review that names things the bytes do not contain is
  // wrong in the direction that costs trust, because the next line it prints
  // is the one about coordinates, and that one is true.
  const both = [...atlas.places, ...atlas.routes];
  const has = {
    addresses: atlas.places.some(p => p.address),
    cities: both.some(r => r.city),
    countries: both.some(r => r.country),
    status: both.some(r => r.status),
    geometry: atlas.routes.some(r => Array.isArray(r.path) && r.path.length),
  };
  const named = [
    has.addresses ? 'addresses' : '',
    has.cities ? 'cities' : '',
    has.countries ? 'countries' : '',
    has.status ? 'whether you have been or want to go' : '',
  ].filter(Boolean);
  const alsoLine = named.length > 1
    ? `${named.slice(0, -1).join(', ')}, and ${named[named.length - 1]}`
    : named[0] || '';

  const body = $('#agentBody');
  body.innerHTML = `
    <div class="sh-what">
      <div class="sec-head" role="heading" aria-level="2">what travels</div>
      <ul class="sh-list">
        ${travels ? `
        ${count.places ? `<li><b>${count.places}</b> place${count.places === 1 ? '' : 's'}: names and exact coordinates</li>` : ''}
        ${count.routes ? `<li><b>${count.routes}</b> path${count.routes === 1 ? '' : 's'}: ${has.geometry ? 'full shape, distance, and climb' : 'distance and climb'}</li>` : ''}
        ${count.books ? `<li><b>${count.books}</b> book${count.books === 1 ? '' : 's'}: title, author, year, and reading status</li>` : ''}
        ${alsoLine ? `<li>${alsoLine}</li>` : ''}
        ${count.tags ? `<li><b>${count.tags}</b> tag${count.tags === 1 ? '' : 's'}: labels used by these records</li>` : ''}
        ${count.notes ? `<li><b>${count.notes}</b> note${count.notes === 1 ? '' : 's'}, in full</li>` : ''}
        ${count.links ? `<li><b>${count.links}</b> link${count.links === 1 ? '' : 's'} you saved</li>` : ''}
        ${count.bylines ? `<li><b>${count.bylines}</b> sharing name${count.bylines === 1 ? '' : 's'} on records you received</li>` : ''}
        <li>${count.author ? `sharing name <b>${esc(count.author)}</b>` : 'no sharing name included'}</li>` : `<li>${nothingLeaves()}</li>`}
      </ul>
      <div class="sec-head" role="heading" aria-level="2">what stays</div>
      <ul class="sh-list">
        <li>your people, settings, and local snapshots</li>
      </ul>
      ${travels ? `<p class="sh-warn">Anyone with this file can copy it and keep it. Its terms guide the reader; they are not a restriction on the file. Sent files cannot be recalled.</p>` : ''}
      ${held.length ? `<p class="sh-warn">${staysBehindLine(never)} ${SHARING_EXCLUSION_COPY}</p>` : ''}
      ${tooShort.length ? `<p class="sh-warn">${tooShortLine(tooShort)}</p>` : ''}
      ${travels ? `<p class="sh-size mono">${(new Blob([json]).size / 1024).toFixed(1)} kB file</p>` : ''}
    </div>
    ${travels ? `<div class="word-row">
      <button class="word-btn" id="agGo">download copy</button>
    </div>` : ''}`;

  // No word when there is nothing to hand over. The panel used to print
  // "nothing. no place or path here may leave." above a button that wrote an
  // empty atlas to a file, which is this app's own rule about words that do
  // nothing broken on its newest surface. The lines above already say which
  // records stayed and why, so the refusal needs no sentence of its own: it is
  // the absence of the word.
  //
  // the bytes counted above, and not a second call that could read a record
  // edited in the meantime and hand over a file the review never described
  $('#agGo')?.addEventListener('click', () => {
    if (!loadLatestAtlas()) return;
    const latest = store.assistantCopyJSON();
    const latestAtlas = JSON.parse(latest).disclosure;
    if (disclosureFingerprint(latestAtlas) !== reviewed) {
      renderAssistantFile();
      toast('Your atlas changed. Review the updated copy.');
      return;
    }
    closeSurface('agentOverlay');
    download('resonate-for-an-assistant.json', json, 'application/json');
    toast('assistant copy downloaded');
  });
  openSurface('agentOverlay');
}

// ---------- posters: census & kept ----------

function renderStats() {
  const body = $('#statsBody');
  const places = allPlaces();
  const visited = places.filter(p => p.status === 'visited');
  const countries = new Map();
  const cities = new Set();
  places.forEach(p => {
    if (p.country) countries.set(p.country, (countries.get(p.country) || 0) + 1);
    if (p.city) cities.add(p.city);
  });
  // A room called the census counted one kind of record. A person keeping
  // walks and books and no places at all was told nothing was counted yet,
  // which was a count of their atlas that was wrong by everything in it; and
  // the band beneath the opening line named places, countries and cities to
  // somebody holding nine paths. The by-tag rows below were corrected first,
  // because a tag has always been worn by all three, and the band was left
  // saying the older, smaller thing one line above them.
  const ways = allRoutes();
  const shelf = allBooks();
  if (!places.length && !ways.length && !shelf.length) {
    body.innerHTML = `<p class="stat-opening">Your atlas is empty. <em>Add a place, path, or book to begin.</em></p>`;
    return;
  }
  // counted the way the tags room counts, or one surface says six and the
  // other twelve about the same word
  const tagRows = allTags()
    .map(t => ({ t, n: store.tagCensus(t.id).total }))
    .filter(r => r.n > 0).sort((a, b) => b.n - a.n);
  const countryList = [...countries.entries()].sort((a, b) => b[1] - a[1]);

  // Every count stays tied to the word it counts, just as it does in the index.
  // The opening adds the one ratio the cells do not show; it does not repeat
  // their countries, cities, paths, or books in prose.
  const tied = (n, word) => `${n}\u00a0${word}`;
  body.innerHTML = `
    <p class="stat-opening">${places.length
      ? `${tied(visited.length, 'of')} ${tied(places.length, `place${places.length === 1 ? '' : 's'}`)} visited.`
      : `No places yet. <em>Your paths and books are counted below.</em>`}</p>
    <div class="stat-band">
      ${places.length ? `<div class="stat-cell"><div class="stat-num">${places.length}</div><div class="stat-lbl">places</div></div>
      <div class="stat-cell"><div class="stat-num">${countries.size}</div><div class="stat-lbl">countries</div></div>
      <div class="stat-cell"><div class="stat-num">${cities.size}</div><div class="stat-lbl">cities</div></div>` : ''}
      ${ways.length ? `<div class="stat-cell"><div class="stat-num">${ways.length}</div><div class="stat-lbl">path${ways.length === 1 ? '' : 's'}</div></div>` : ''}
      ${shelf.length ? `<div class="stat-cell"><div class="stat-num">${shelf.length}</div><div class="stat-lbl">book${shelf.length === 1 ? '' : 's'}</div></div>` : ''}
    </div>
    ${tagRows.length ? `<div class="sec-head" role="heading" aria-level="2">by tag</div>
      ${tagRows.map(({ t, n }) => `<div class="tally"><span class="name">${esc(t.name)}</span><span class="n">${n}</span></div>`).join('')}` : ''}
    ${countryList.length ? `<div class="sec-head" role="heading" aria-level="2">countries</div>
      <div class="country-cols">${countryList.map(([c, n]) => `<div class="tally"><span class="name">${esc(c)}</span><span class="n">${n}</span></div>`).join('')}</div>` : ''}
    <div class="sec-head" role="heading" aria-level="2">storage and backup</div>
    <div class="set-row-sub mono" id="statKept">counting…</div>`;
  paintKept('#statKept');
}

// what this browser is holding, and whether it has promised to keep it
//
// The figure is the browser's estimate for this whole address, which is what
// it has always been and not what it was named. It used to read "N mb here"
// beside a count of places and paths, so it was read as the size of the
// atlas; that was arguable while photographs were most of the bytes, and it
// is simply untrue now. Records are small, and what the number is mostly
// measuring is the app's own offline copy: the map library, the typefaces,
// the code that draws the evening. The figure is kept, because eviction takes
// the whole address at once and this is the only warning of it a person gets.
// It is the sentence that changes.
async function keptWhere() {
  const bytes = (await photoStore.estimate())?.used ?? null;
  const promised = await photoStore.persisted();
  const mb = bytes === null ? null : (bytes / 1_048_576).toFixed(bytes > 10_485_760 ? 0 : 1);
  const last = store.settings.lastExportAt;
  // null is a database that would not open and [] is one that is genuinely
  // empty. Collapsed together, a browser refusing its own storage reads as a
  // browser that simply has not got round to a snapshot yet, which is the one
  // sentence that would stop somebody going to look for their backup.
  const snaps = await photoStore.snapshotKeys();
  // The places and the paths are not counted here.
  //
  // They were, and `the census` two sections above counted them too, so the one
  // screen said `31 places · 1 path` twice in eleven lines with nothing to tell
  // a reader why the two lines disagreed about everything else. Two counts of
  // the same thing on one surface is a surface asking to be doubted.
  //
  // The split is by question rather than by number: the census answers what you
  // have, and this answers where it is and whether it will survive. Folios and
  // contacts moved up into the census in the same edit, so nothing stopped
  // being counted; it is counted once.
  return [
    snaps === null ? 'local snapshots unavailable'
      : snaps.length ? `${snaps.length} local snapshot${snaps.length === 1 ? '' : 's'}` : 'no local snapshot yet',
    mb === null ? '' : `${mb} mb used on this device`,
    promised === true ? 'storage protected'
      : promised === false ? 'the browser may clear storage when space is low' : '',
    last ? `last backup downloaded ${fmtDate(last).toLowerCase()}` : 'no backup downloaded yet',
  ].filter(Boolean).join(' · ');
}

function paintKept(sel) {
  keptWhere().then(line => { const el = $(sel); if (el) el.textContent = line; });
}

// you: the byline, the club, the data, the census, this atlas, and the manual
function renderSettings() {
  const body = $('#settingsBody');
  body.innerHTML = `
    <section class="set-sec set-essential">
      <h2 class="sec-head">sharing name</h2>
      <div class="set-name-row">
        <input class="text-input" id="authorName" placeholder="no name" aria-label="Sharing name" aria-describedby="authorNameHelp" autocomplete="name" maxlength="60" value="${esc(store.settings.authorName)}">
        <p class="set-row-sub" id="authorNameHelp">Shown on links and files you share. Not an account.</p>
      </div>
    </section>

    <section class="set-sec set-essential set-backup">
      <h2 class="sec-head">backup and recovery</h2>
      <p class="set-row-sub">Keep an independent private backup of everything in your atlas.</p>
      <div class="word-row">
        <button class="word-btn" id="expJson">download backup file</button>
        <button class="word-btn quiet" id="impJson">restore backup file</button>
        <button class="word-btn quiet" id="moreForms" aria-expanded="false" aria-controls="formRow">more formats</button>
      </div>
      <div class="word-row" id="formRow" hidden>
        <button class="word-btn quiet" id="expGeo">geojson</button>
        <button class="word-btn quiet" id="expKml">kml</button>
        <button class="word-btn quiet" id="expCsv">csv</button>
        <button class="word-btn quiet" id="expMd">markdown</button>
        <button class="word-btn quiet" id="expPdf">print, or save as pdf</button>
        <button class="word-btn quiet" id="expAgent">assistant copy</button>
      </div>
      <p class="set-row-sub set-note">Restore previews every change before saving.</p>
      <p class="set-row-sub" id="formsSub" hidden>GeoJSON and KML are for maps, CSV for spreadsheets, and Markdown for reading. ${SHARING_EXCLUSION_COPY}</p>
      <button class="settings-door" id="clubWord">
        <span class="settings-door-copy">
          <span class="settings-door-title">travellers club</span>
          <span class="settings-door-note">Encrypted backup and private sharing.</span>
        </span>
        <span class="settings-door-action">open</span>
      </button>
      ${store.letters.jwk ? '<p class="set-row-sub set-note">Downloaded backup files do not include your private-connection identity. Club backup does.</p>' : ''}
    </section>

    <button class="settings-door settings-census" id="censusWord">
      <span class="settings-door-copy">
        <span class="settings-door-title">your atlas</span>
        <span class="settings-door-note" id="censusLine">counting…</span>
      </span>
      <span class="settings-door-action">at a glance</span>
    </button>

    <details class="set-disclosure" id="assistantSettings">
      <summary>
        <h2 class="set-summary">
          <span class="set-summary-copy">
            <span class="set-summary-title">assistant access</span>
            <span class="set-summary-note">Let assistants work with records included in sharing.</span>
          </span>
          <span class="set-summary-state mono" id="agentAccessSummary">off</span>
        </h2>
      </summary>
      <div class="set-detail">
        <div class="agent-state mono" id="agentAccessState" data-state="off" aria-live="polite"></div>
        <p class="set-row-sub" id="agentAccessCopy"></p>
        <div class="word-row">
          <button class="word-btn quiet" id="agentAccessToggle" data-agent-access-toggle aria-pressed="false">Allow access</button>
          <button class="word-btn quiet" id="agentCopyFallback">Review assistant copy</button>
          <a class="word-btn quiet" href="read.html?d=assistant">Read data contract</a>
        </div>
      </div>
    </details>

    <details class="set-disclosure" id="deviceSettings">
      <summary>
        <h2 class="set-summary">
          <span class="set-summary-copy">
            <span class="set-summary-title">this device</span>
            <span class="set-summary-note">Offline access and local recovery.</span>
          </span>
          <span class="set-summary-state mono" id="deviceSummary">checking</span>
        </h2>
      </summary>
      <div class="set-detail">
        <div class="set-row-sub mono" id="deviceState" aria-live="polite"></div>
        <div class="set-row-sub" id="installedWord" hidden>Installed for quick access. Your atlas remains private to this browser.</div>
        <div class="word-row" id="installRow">
          <a class="word-btn quiet" id="installWord" href="read.html?d=support">install on this device</a>
        </div>
        <h3 class="sec-head">local snapshots</h3>
        <div class="set-row-sub mono" id="setKept">counting…</div>
        <div class="word-row">
          <button class="word-btn quiet" id="snapRestore">view local snapshots</button>
          <button class="word-btn quiet" id="photoWay" hidden>the photographs still here</button>
        </div>
        <p class="set-row-sub set-note">Keeps the three latest snapshots on this device.</p>
        <p class="set-row-sub" id="photoWaySub" hidden></p>
      </div>
    </details>

    <details class="set-disclosure set-danger" id="resetSettings">
      <summary>
        <h2 class="set-summary">
          <span class="set-summary-copy">
            <span class="set-summary-title">reset this atlas</span>
            <span class="set-summary-note">Remove starter records or erase everything.</span>
          </span>
        </h2>
      </summary>
      <div class="set-detail">
        <div class="word-row">
          ${untouched().length ? '<button class="word-btn quiet" id="clearUntouched">remove untouched starter records</button>' : ''}
          <button class="word-btn quiet" id="eraseAll">erase everything</button>
        </div>
        ${untouched().length ? `<p class="set-row-sub set-note">Removes ${untouched().length} unchanged starter record${untouched().length === 1 ? '' : 's'}. Anything you edited stays.</p>` : ''}
      </div>
    </details>

    <nav class="set-footer" aria-label="Settings help">
      <button class="word-btn quiet" id="howWord">how this works</button>
      <a class="word-btn quiet" href="read.html?d=privacy">privacy</a>
      <a class="word-btn quiet" href="read.html?d=support">help</a>
      <span class="set-release mono">release ${esc(RELEASE)}</span>
    </nav>`;
  paintKept('#setKept');
  paintDeviceState();
  paintAgentAccess();
  // Opening this room is also a natural capability check. If a browser or
  // extension supplied a WebMCP runtime since boot, the saved choice can meet
  // it here; an unchanged runtime is an idempotent repaint, not registration.
  void syncAgentAccess();

  $('#installWord')?.addEventListener('click', async (e) => {
    if (!installOffer) return; // the link opens the instructions everywhere else
    e.preventDefault();
    const offer = installOffer;
    installOffer = null; // a browser permits each offer to be used once
    try {
      await offer.prompt();
      const choice = await offer.userChoice;
      if (choice?.outcome === 'dismissed') toast('installation left for later');
    } catch {
      location.assign('read.html?d=support');
    }
    paintDeviceState();
  });

  // The way back to the photographs, standing here for as long as there are
  // any. The notice at boot is a courtesy and can be waved away by a keypress;
  // this is the door, and it is only shown when there is something behind it.
  photoStore.photographCount().then(n => {
    const word = $('#photoWay');
    const said = $('#photoWaySub');
    if (!word || !n) return;
    const device = $('#deviceSettings');
    if (device) {
      device.dataset.photographs = String(n);
      device.open = true;
      paintDeviceState();
    }
    word.textContent = n === 1 ? 'the photograph still here' : `the ${n} photographs still here`;
    word.hidden = false;
    if (said) {
      said.textContent = `Resonate no longer keeps photographs, and this device is still holding ${n === 1 ? 'one' : n}. Nothing has been deleted. This writes them all out to a page you can open anywhere, or lets them go, whichever you choose.`;
      said.hidden = false;
    }
  });

  $('#photoWay').addEventListener('click', async () => {
    const n = await photoStore.photographCount();
    if (!n) return toast('no photographs are left on this device');
    return offerTheFarewell(n, { wait: false });
  });

  $('#snapRestore').addEventListener('click', async () => {
    // A database that would not open answers null, and one holding nothing
    // answers an empty list. Read as the same thing, a browser refusing its own
    // storage was reported as a browser that had simply not taken a snapshot
    // yet: the person believes the feature has not started, when what has
    // happened is that it cannot.
    const keys = await photoStore.snapshotKeys();
    if (keys === null) return toast('this browser would not open its database, so the snapshots on it cannot be read', 7000);
    if (!keys.length) return toast('no snapshot has been taken on this device yet');
    const newest = keys.sort().reverse();
    const when = newest.map(k => fmtDate(k).toLowerCase());
    const pick = await askText(`Snapshots on this device: ${when.map((w, i) => `${i + 1}. ${w}`).join(' · ')}. Which one?`, { value: '1', yes: 'look at it' });
    const i = parseInt(pick, 10) - 1;
    if (!Number.isFinite(i) || i < 0 || i >= newest.length) return;
    const rec = await photoStore.snapshotGet(newest[i]);
    if (!rec?.json) return toast('that snapshot could not be read');
    let parsed = null;
    try { parsed = JSON.parse(rec.json); }
    catch { return toast('that snapshot could not be read'); }

    // A snapshot is an archive like any other, so it gets the same two words a
    // file does. It used to offer one operation under a word that promised the
    // other: "bring it home" ran an additive merge, which cannot bring back an
    // older note, an earlier name, an earlier shape or a place you edited by
    // mistake. It only ever helped when a record was entirely gone,
    // which is not what a person reaching for a snapshot is usually afraid of.
    const seen = store.compare(parsed);
    if (!seen) return toast('that snapshot could not be read');
    if (seen.lost.length) return sayWhatWasLost(seen.lost, { verb: 'come home' });
    // all five kinds, because going back replaces all five
    const held = store.places.length + store.routes.length + store.tags.length
      + store.folios.length + store.correspondents.length;
    // A snapshot taken before photographs left a record names them by id, and
    // where those pictures are now is a question with two answers. This device
    // may have let them go an hour ago, and a panel that says they are still
    // here is a panel that sends somebody looking for something that is not
    // there. So it is asked rather than assumed.
    const nPics = photographsSetAside(seen.setAside);
    const stillHere = nPics ? await photoStore.photographCount() : 0;
    const word = await ask(
      `The snapshot from ${when[i]}, beside this atlas:\n\n`
      + [`${seen.fresh} record${seen.fresh === 1 ? '' : 's'} this atlas no longer has`,
        seen.differ ? `${seen.differ} it has, differently` : '',
        seen.identical ? `${seen.identical} already the same` : '',
        seen.onlyHere ? `${seen.onlyHere} here that the snapshot does not have` : '',
        nPics ? `${nPics} photograph${nPics === 1 ? '' : 's'} this version does not keep. ${stillHere ? 'the pictures are still on this device' : 'the pictures are not on this device any more'}` : ''].filter(Boolean).join('\n')
      + `\n\nBring back what is missing, and nothing you have now changes. Go back to the snapshot, and the ${held} record${held === 1 ? '' : 's'} here are replaced by what it holds. A snapshot of now is taken first either way.`,
      { yes: 'bring back what is missing', also: 'go back to this snapshot', no: 'never mind' });
    if (!word) return;

    try { await photoStore.snapshotPut(store.recordsJSON()); await photoStore.snapshotPrune(4); }
    catch { /* a device with no room for one more still gets the choice */ }

    if (word === 'also') {
      const sure = await ask(
        `Replace ${held} record${held === 1 ? '' : 's'} with the snapshot from ${when[i]}? `
        + `${seen.onlyHere} record${seen.onlyHere === 1 ? '' : 's'} made since then will be gone. The snapshot just taken holds them.`,
        { yes: 'go back', no: 'stop', danger: true });
      if (!sure) return;
    }

    const r = await bringHome(parsed, { replace: word === 'also' });
    if (!r.ok) {
      if (r.why === 'lossy') return sayWhatWasLost(r.lost, { verb: 'come home' });
      return toast('this device would not save it, so nothing changed');
    }
    renderAll();
    toast(word === 'also'
      ? `this atlas is the snapshot from ${when[i]}. ${r.now.places} place${r.now.places === 1 ? '' : 's'}`
      : (r.added ? `${r.added} record${r.added === 1 ? '' : 's'} came home from ${when[i]}` : 'that snapshot holds nothing this atlas lacks'));
  });

  $('#authorName').addEventListener('change', (e) => {
    store.settings.authorName = e.target.value.trim().slice(0, 60);
    e.target.value = store.settings.authorName;
    store.saveSettings();
  });
  bindAgentAccessToggle($('#settingsBody'));
  $('#agentCopyFallback').addEventListener('click', () => renderAssistantFile());
  $('#expJson').addEventListener('click', async () => {
    await exportEverything();
    paintKept('#setKept');
  });
  // the other forms unfold in place: the row exists the whole time, and the
  // word above it only says whether it is showing
  $('#moreForms').addEventListener('click', () => {
    const row = $('#formRow');
    const sub = $('#formsSub');
    const open = row.hidden;
    row.hidden = !open;
    sub.hidden = !open;
    $('#moreForms').setAttribute('aria-expanded', String(open));
  });
  // the census, headlined where the data lives; the whole story one press away
  {
    const places = allPlaces();
    const cities = new Set(places.map(p => p.city).filter(Boolean));
    const countries = new Set(places.map(p => p.country).filter(Boolean));
    const ways = allRoutes().length;
    // Seven counts and six separators in one line at twelve pixels, which is
    // the longest line of this shape in the app and the one most certain to
    // wrap. Every count is tied to its noun and every separator travels forward
    // onto the count it introduces, so the two ways this line can break badly -
    // a number alone at the end of a line, and a dot pointing at nothing - are
    // both closed. The index tally keeps the same rule.
    const n = (v, word) => `${v}\u00a0${word}`;
    $('#censusLine').textContent = [
      n(places.length, `place${places.length === 1 ? '' : 's'}`),
      cities.size ? n(cities.size, cities.size === 1 ? 'city' : 'cities') : '',
      countries.size ? n(countries.size, `countr${countries.size === 1 ? 'y' : 'ies'}`) : '',
      ways ? n(ways, `path${ways === 1 ? '' : 's'}`) : '',
      store.books.length ? n(store.books.length, `book${store.books.length === 1 ? '' : 's'}`) : '',
      // up from `kept where`, which used to count these and the places and the
      // paths as well: what you have is one question and it is answered once
      store.folios.length ? n(store.folios.length, `collection${store.folios.length === 1 ? '' : 's'}`) : '',
      store.correspondents.length ? n(store.correspondents.length, store.correspondents.length === 1 ? 'person' : 'people') : '',
    ].filter(Boolean).join(' \u00b7\u00a0') || 'your atlas is empty';
  }
  $('#censusWord').addEventListener('click', () => openSurface('statsOverlay', renderStats));
  $('#clubWord').addEventListener('click', () => openSurface('clubOverlay', renderClub));
  $('#howWord').addEventListener('click', () => openSurface('howOverlay'));
  // the same atlas a person hands a friend, which is the whole of the claim:
  // an assistant is given what a friend is given, and not one field more. it
  // was written here as the same bytes, and that was never true, because this
  // copy names the terms it was handed over under and a friend's copy has no
  // terms to name. the press opens the review; a second press hands it over.
  $('#expAgent').addEventListener('click', () => renderAssistantFile());
  $('#expGeo').addEventListener('click', () => exportOutwardFile(
    'resonate-atlas.geojson', () => store.exportGeoJSON(), 'application/geo+json'));
  $('#expKml').addEventListener('click', () => exportOutwardFile(
    'resonate-atlas.kml', () => store.exportKML(), 'application/vnd.google-earth.kml+xml'));
  $('#expCsv').addEventListener('click', () => exportOutwardFile(
    'resonate-atlas.csv', () => store.exportCSV(), 'text/csv'));
  $('#expMd').addEventListener('click', () => exportOutwardFile(
    'resonate-atlas.md', () => store.exportMarkdown(), 'text/markdown'));
  $('#expPdf').addEventListener('click', () => printSheet(atlasSheetOpts()));
  $('#impJson').addEventListener('click', () => {
    const file = $('#importFile');
    file.onchange = () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      readArchiveFile(f, openResonateFile);
    };
    file.click();
  });
  $('#clearUntouched')?.addEventListener('click', async () => { await clearUntouched(); renderSettings(); });
  $('#eraseAll').addEventListener('click', async () => {
    // `every place and tag` named two of the seven things store.clearAll takes.
    // A person holding sixteen contacts could read the old sentence as sparing
    // them, and the how page's own list already disagreed with it. The census
    // three sections up counts the same records; the word that destroys them
    // can afford the same sentence. Counted rather than listed, because a
    // number is the one part of this a person can check against what they know
    // they have.
    const nPlaces = allPlaces().length;
    const nWays = allRoutes().length;
    const held = [
      `${nPlaces} place${nPlaces === 1 ? '' : 's'}`,
      store.correspondents.length ? `${store.correspondents.length} ${store.correspondents.length === 1 ? 'person' : 'people'}` : '',
      nWays ? `${nWays} path${nWays === 1 ? '' : 's'}` : '',
      store.books.length ? `${store.books.length} book${store.books.length === 1 ? '' : 's'}` : '',
      store.folios.length ? `${store.folios.length} collection${store.folios.length === 1 ? '' : 's'}` : '',
      store.tags.length ? `${store.tags.length} tag${store.tags.length === 1 ? '' : 's'}` : '',
      store.settings.authorName ? 'your sharing name' : '',
    ].filter(Boolean);
    const counted = held.length > 1
      ? `${held.slice(0, -1).join(', ')} and ${held[held.length - 1]}`
      : held[0];
    if (!await ask(`Erase this atlas? It takes ${counted}. Export first if you want a keepsake.`, { yes: 'go on', no: 'not yet', danger: true })) return;
    // An erase empties the photographs store as well, and on a device from
    // before that store is not empty. Neither confirmation named them, so the
    // one word in the app that destroys somebody's pictures was the one word
    // that did not mention them. It is said here, where the word is pressed,
    // and only where it is true.
    const nPics = await photoStore.photographCount();
    const alsoPictures = nPics
      ? ` This device is still holding ${nPics === 1 ? 'one photograph' : `${nPics} photographs`} from a version that kept them, and an erase takes ${nPics === 1 ? 'it' : 'them'} too. Under yours, the word beside the snapshots writes ${nPics === 1 ? 'it' : 'them'} out first.`
      : '';
    // Said to everybody, member or not: a device that never joined was told its
    // club key was kept and a paid backup could still come home, about a key it
    // has never had, in the same breath as a backup at the club it does not
    // have either. And the member was not told the other half. The letters
    // identity travels in no file by design, so an erase without a backup at
    // the club ends a correspondence rather than pausing it, and this is the
    // last surface where that can be said.
    const beyond = store.settings.clubKey
      ? 'It cannot reach links you sent, files you exported, or your backup at the club.'
        + ' Your club key is kept, so a paid backup can still come home.'
        + (store.letters.jwk
          ? ' Your letters identity is in no file you can export: only that backup carries it.'
          : '')
      : 'It cannot reach links you sent or files you exported.';
    if (!await ask(`Gone means gone here.${alsoPictures} ${beyond} Really erase?`, { yes: 'erase everything', no: 'stop', danger: true })) return;
    // Preserve the inbox first, then stage each destructive store behind a
    // durable local journal. Until the final commit marker, any refusal can
    // put all three stores back exactly as this press found them.
    const shared = await sharedForErase();
    if (!shared) {
      toast('this browser could not read its share inbox, so the atlas was left as it was', 7000);
      return;
    }
    if (!store.clearAll({ defer: true, context: { shared } })) {
      toast('this browser could not prepare a complete erase, so the atlas was left as it was', 7000);
      return;
    }
    if (!await wipeShareDB()) {
      await rollbackPreparedErase(shared);
      toast('this browser could not erase its share inbox, so the atlas was put back', 7000);
      return;
    }
    if (!await photoStore.stageClear()) {
      await rollbackPreparedErase(shared);
      toast('this browser could not erase its photographs and snapshots, so the atlas was put back', 7000);
      return;
    }
    if (!store.commitClearAll()) {
      await rollbackPreparedErase(shared);
      toast('this browser could not commit a complete erase, so the atlas was put back', 7000);
      return;
    }
    // Past this marker recovery always finishes the erase. Both following
    // operations remove temporary recovery copies, not the primary records.
    if (!await photoStore.commitClear() || !store.finishClearAll()) {
      toast('the erase is not finished. close other Resonate tabs and try again', 8000);
      return;
    }
    // Permission is part of what erase clears. Abort registered browser tools
    // immediately; an empty disclosure is not a substitute for revocation.
    await syncAgentAccess();
    state.selectedId = null;
    state.foreign = null;
    state.visiting = null;
    state.filters.tags.clear();
    closeSurface('settingsOverlay');
    pushCorrespondentsToMap();
    applyWorldState();
    renderAll();
    toast('your atlas has been erased');
  });
}

// tags: the words a person files a place, a path or a book under, kept on
// their own page.
//
// The room's first line promises a colour the field wears, and this was the
// one place in the app that showed none: choosing between `petrol` and
// `cobalt` was choosing between two words set in the same grey, and a colour
// chosen wrongly could only be undone by removing the tag, which takes the
// word off every record that wears it. So a wrong colour cost a vocabulary.
// The names and the stations are written in their own hue now, and the
// stations that make a tag are the stations that change one.
function renderTags(showHue = null) {
  const body = $('#tagsBody');
  body.innerHTML = `
    <div class="tag-rows">
      ${store.tags.map(t => {
        const h = Number(t.hue);
        return `
        <div class="tag-row" data-tid="${esc(t.id)}"${Number.isFinite(h) ? ` style="--mk-hue:${h}"` : ''}>
          <div class="tally">
            <span class="name">${esc(t.name)}</span>
            <button class="word-btn quiet" data-rename aria-label="Rename ${esc(t.name)}">rename</button>
            <button class="word-btn quiet" data-recolor aria-label="Recolour ${esc(t.name)}" aria-expanded="${showHue === t.id}">recolour</button>
            <button class="word-btn quiet" data-del aria-label="Remove ${esc(t.name)}">remove</button>
            <span class="n">${store.tagCensus(t.id).total}</span>
          </div>
          ${showHue === t.id ? `<div class="hue-stations">${TAG_STATIONS.map(s => `<button data-hue="${s.hue}" data-hex="${s.hex}" style="--mk-hue:${s.hue}" aria-pressed="${h === s.hue}">${s.name}</button>`).join('')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="tag-add">
      <input class="text-input" id="tagName" placeholder="new tag name" aria-label="New tag name" enterkeyhint="done">
      <div class="hue-stations" id="tagHues">
        ${TAG_STATIONS.map((s, i) => `<button data-hue="${s.hue}" data-hex="${s.hex}" style="--mk-hue:${s.hue}" aria-pressed="${i === 4}">${s.name}</button>`).join('')}
      </div>
      <button class="word-btn" id="tagAdd">add the tag</button>
    </div>`;

  let picked = TAG_STATIONS[4];
  $('#tagHues').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hue]');
    if (!b) return;
    picked = { hue: parseInt(b.dataset.hue, 10), hex: b.dataset.hex };
    $$('#tagHues button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#tagAdd').addEventListener('click', () => {
    const name = $('#tagName').value.trim();
    if (!name) return $('#tagName').focus();
    const made = store.addTag(newTag({ name, hue: picked.hue, color: picked.hex }));
    if (!made) return;
    renderTags(); renderChips();
    toast(`tag “${name}” added`);
  });
  $('#tagName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#tagAdd').click(); });

  $('.tag-rows', body).addEventListener('click', async (e) => {
    const row = e.target.closest('[data-tid]');
    if (!row) return;
    const id = row.dataset.tid;
    const tag = store.tagById(id);
    if (e.target.closest('[data-recolor]')) { renderTags(showHue === id ? null : id); return; }
    const station = e.target.closest('.hue-stations [data-hue]');
    if (station) {
      // hue is the stored truth and the hex is kept for older exports and
      // links, so the two move together or neither does
      store.updateTag(id, { hue: parseInt(station.dataset.hue, 10), color: station.dataset.hex });
      renderTags(id); renderAll();
      return;
    }
    if (e.target.closest('[data-del]')) {
      // the question and the removal read the same arithmetic now, so the
      // sentence cannot promise one thing while the store does another
      const c = store.tagCensus(id);
      const rides = [
        c.places ? `${c.places} place${c.places === 1 ? '' : 's'}` : '',
        c.paths ? `${c.paths} path${c.paths === 1 ? '' : 's'}` : '',
        c.books ? `${c.books} book${c.books === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      const from = rides.length > 1
        ? ` from ${rides.slice(0, -1).join(', ')} and ${rides[rides.length - 1]}`
        : rides.length ? ` from ${rides[0]}` : '';
      if (!await ask(`Remove tag “${tag.name}”${from}?${rides.length ? ' They keep their other tags.' : ''}`, { yes: 'remove it', no: 'keep it', danger: true })) return;
      if (!store.removeTag(id)) return;
      renderTags(); renderAll();
    }
    if (e.target.closest('[data-rename]')) {
      const name = await askText('What should this tag be called?', { value: tag.name, yes: 'rename it' });
      if (name === null) return;
      store.updateTag(id, { name: name.trim() || tag.name });
      renderTags(); renderAll();
    }
  });
}

function renderKeys() {
  const rows = [
    ['/', 'command line'], ['⌘K', 'command line'], ['i', 'the index'],
    ['j · k', 'next · previous place'], ['esc', 'close one surface'],
    ['+ · −', 'zoom'], ['0', 'frame everything'], ['t', 'day / night'],
    ['g', 'find me'], ['s', 'share this atlas'], ['1–9', 'toggle tag worlds'],
    ['right-click', 'propose a place'], ['drop a photo', 'file it by its own fix'],
    ['drop a gpx', 'a walk becomes a path'],
  ];
  $('#keysBody').innerHTML = `<div class="keys-grid">
    ${rows.map(([k, d]) => `<div class="key-row"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}
  </div>`;
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- the command line ----------

const palette = { input: null, results: null, hl: 0, rows: [], remoteAbort: null };

// ---------- the travellers club ----------
//
// The one rule, said everywhere it matters: the envelope is sealed on this
// device before it travels, and the recovery phrase never leaves. The club is a
// keeper of bytes it cannot read.

const clubBase = () => store.settings.clubUrl || CLUB_URL;
const clubClient = () => makeClient(clubBase(), () => store.settings.clubKey);

// Whether the room has heard back from the club about what it is holding.
// Resolves true when the answer arrived and false when it did not, and is
// never rejected: it is a question about knowledge, and "we did not find out"
// is one of its answers rather than an error somebody has to catch.
let roomKnows = null;
let roomGen = 0;

// What the club is while it is a sandbox, said where a person is about to hand
// it an atlas rather than in a document they may not open.
//
// It stands above the join word and above the backup that follows it, because
// both of those look exactly like the finished thing and neither of them is:
// the card is a test card, nothing is charged, and what is stored can be wiped
// without notice. A person who reads only this one block has been told the two
// facts that would change what they do.
//
// The shut door does not get it. That branch already says the door is not open,
// and a second notice about a sandbox behind a door nobody can reach is noise.
// What the desk last said it was, or null for `we have not found out`.
//
// Asked once each time the club room opens and kept between opens, because the
// answer changes only when somebody redeploys the worker, and a room that
// re-asked on every paint would ask three times to draw once.
let deskSaid = null;

const DESK_AGREED = 'agreed', DESK_UNKNOWN = 'unknown', DESK_WRONG = 'wrong';

// Whether the desk agrees with what this build says about it.
//
// `TESTING` is the claim and `live` is the fact, and the two are opposites: a
// build that says nothing is charged belongs over a desk that charges nothing.
// Silence is not agreement. That line is the reason any of this exists, because
// the failure it guards is a person reading `no money changes hands` and being
// charged for a year, and nothing else in the club catches it: `admits` refuses
// a test session against a live desk, so the person who obeys the app and types
// a test card is turned away, and the person who ignores it and types a real
// card sails through every check there is.
const deskVerdict = said => (said ? (said.live === !TESTING ? DESK_AGREED : DESK_WRONG) : DESK_UNKNOWN);

// The two sentences for a desk that does not match the build. Which way round
// it fails matters to whoever is reading: one of them is about to take money
// they were told they would not spend, and the other is about to sell them a
// membership that buys nothing which lasts.
const deskQuarrel = () => (TESTING ? `
      <div class="set-sec">
        <p class="ce-law">This desk is taking real\u00a0money.</p>
        <div class="set-row-sub" style="max-width:52ch">This app was built to say that nothing is charged here, and the club it is pointed at says the opposite. One of the two is wrong, neither of them can tell you which, and no card is asked for until they agree.</div>
      </div>` : `
      <div class="set-sec">
        <p class="ce-law">This desk charges\u00a0nothing.</p>
        <div class="set-row-sub" style="max-width:52ch">This app is selling a membership and the club it is pointed at is a sandbox, so a card typed here would buy nothing that lasts. No card is asked for until they agree.</div>
      </div>`);

const deskSilent = () => `
      <div class="set-sec">
        <p class="ce-law">Payment status unavailable.</p>
        <div class="set-row-sub" style="max-width:52ch">Resonate will not ask for a card until the club confirms whether this is a test or live payment. Everything on this device is unaffected.</div>
      </div>`;

const deskLoading = () => `
      <div class="set-sec">
        <div class="agent-state mono" data-state="waiting">checking payment mode…</div>
      </div>`;

// What to paint from the last answer. Nothing, when there has not been one
// yet: `deskSilent` is for an answer that failed to arrive, and painting it
// before the question has even been asked would flash a worry at somebody every
// time they open the room.
const deskNote = () => {
  const v = deskVerdict(deskSaid);
  return v === DESK_AGREED ? testingNote() : v === DESK_WRONG ? deskQuarrel() : deskLoading();
};

// Ask the desk, and put the answer where the claim was.
//
// Patched in rather than re-rendered. The member's branch carries a recovery
// phrase field somebody may be half way through typing into, and a room that
// repaints when a fetch lands takes the phrase out of their hands.
//
// The whole join section goes when the desk disagrees, not the word alone: the
// line under it quotes a price, and a price standing beside a desk that may not
// be charging it is the same untruth one sentence smaller. `already a member`
// stays, because pasting a key you already hold costs nothing and asks nobody
// for a card.
async function settleDesk() {
  const box = $('#clubDesk');
  const sec = $('#clubJoinSec');
  const join = $('#clubJoin');
  deskSaid = await clubClient().desk();
  const v = deskVerdict(deskSaid);
  if (box?.isConnected) {
    box.setAttribute('aria-busy', 'false');
    box.innerHTML = v === DESK_AGREED ? testingNote() : v === DESK_WRONG ? deskQuarrel() : deskSilent();
  }
  if (v === DESK_AGREED) {
    if (join?.isConnected) join.disabled = false;
    return;
  }
  if (sec?.isConnected) sec.remove();
}

const testingNote = () => (TESTING ? `
      <div class="set-sec">
        <p class="ce-law">This is a test. No money changes hands.</p>
        <div class="set-row-sub" style="max-width:52ch">Stripe opens in test mode. Use a test card. This membership may be reset without warning, so download a backup from <b>backup and recovery</b>.</div>
      </div>` : '');

function renderClub() {
  const body = $('#clubBody');
  const key = store.settings.clubKey;

  if (!clubBase()) {
    body.innerHTML = `
      <div class="set-sec">
        <p class="ce-law">The club is not open yet.</p>
        <div class="set-row-sub" style="max-width:52ch">Everything the app does on this device is free and stays free. Membership pays for the one thing that needs a machine of ours: a backup of your atlas, and the backup before it, that any device of yours can fetch.</div>
        <div class="set-row-sub" style="max-width:52ch">The backup is locked on this device with a recovery phrase we never see. It saves you from losing your device, not from losing our account: both backups sit on one company's machines.</div>
        <div class="set-row-sub" style="max-width:52ch">A private backup file you download is the only copy that does not depend on us.</div>
      </div>`;
    return;
  }

  if (!key) {
    // A payment this device began and never finished. It is asked for first,
    // because everything below it makes the situation worse: `become a member`
    // mints a new secret every press, and a new secret is a new commitment, a
    // new idempotency key, and a subscription Stripe has no way of knowing is
    // the same person. The panel used to say nothing at all about this.
    const held = unfinishedJoins();
    const begun = held[0];
    body.innerHTML = `
      <div id="clubDesk" role="status" aria-live="polite" aria-busy="true">${deskNote()}</div>
      ${begun ? `
      <div class="set-sec">
        <div class="sec-head" role="heading" aria-level="2">a payment you began</div>
        <div class="set-row-sub" style="max-width:52ch">You went to the payment page ${esc(fmtDate(begun.at).toLowerCase())} and never came back with a key. Go back to that payment instead of starting again: starting again means a second membership and a second charge.</div>
        <div class="word-row" style="margin-top:10px">
          <button class="word-btn" id="clubResume">go back to that payment</button>
          <button class="word-btn quiet" id="clubDropJoin">it never went through</button>
        </div>
      </div>` : ''}
      <div class="set-sec" id="clubJoinSec">
        <div class="sec-head" role="heading" aria-level="2">join</div>
        <div class="word-row"><button class="word-btn" id="clubJoin" ${deskVerdict(deskSaid) === DESK_AGREED ? '' : 'disabled'}>become a member</button></div>
        <div class="set-row-sub" style="margin-top:10px">${PRICE ? `${esc(PRICE)} a year. ` : ''}Stripe takes the payment, so your card details never reach this app. You come back with a membership key, which is kept on this device.</div>
      </div>
      <div class="set-sec">
        <div class="sec-head" role="heading" aria-level="2">already a member</div>
        <div class="set-row">
          <input class="text-input mono" id="clubKeyIn" style="max-width:320px" placeholder="tc_…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your membership key">
          <button class="word-btn quiet" id="clubKeyKeep">keep the key on this device</button>
        </div>
        <div class="set-row-sub" style="margin-top:10px">Paste your membership key (tc_…). If payment finished without returning a key, paste its reference (cs_…).</div>
      </div>`;

    settleDesk();

    // Paid, and the page never came home, is the ordinary shape of this: a
    // closed tab, a dead battery, a bank's own screen that swallowed the
    // return. The door answers that question for nothing, so it is asked
    // before anybody is sent back to pay.
    $('#clubResume')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'checking that payment…';
      try {
        const got = await clubClient().door(begun.session);
        store.settings.clubKey = got.key; store.saveSettings();
        forgetJoins();
        toast('that payment went through. your key is kept on this device');
        renderClub();
        return;
      } catch { /* not paid, or not paid by this session: back to the desk */ }
      // A checkout session at Stripe expires a day after it is made, so an
      // older address leads to their expired page and not to a card. Asking the
      // door is still worth it at any age, because a payment that landed stays
      // landed; sending somebody back to a dead address is not.
      if (begun.url && Date.now() - begun.at < 24 * 3600e3) { location.href = begun.url; return; }
      b.disabled = false;
      b.textContent = 'go back to that payment';
      toast(begun.url
        ? 'that payment was never completed, and a payment page only lasts a day. become a member to start a fresh one'
        : 'that payment has not gone through, and this device did not keep its address', 6000);
    });
    $('#clubDropJoin')?.addEventListener('click', () => { forgetJoins(); renderClub(); });

    $('#clubJoin').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (begun && !await ask('This device already started a membership that never finished. Starting another one means a second subscription and a second charge, and the two cannot be merged afterwards.', { yes: 'start a second one anyway', no: 'never mind', danger: true })) return;
      b.disabled = true;
      b.textContent = 'opening the payment page…';
      try {
        // the session is made by the club, at one price, and this device's
        // secret is written down before anything navigates
        const { url } = await clubClient().checkout();
        if (!url) throw new Error('the payment page has no address');
        location.href = url;
      } catch (err) {
        b.disabled = false;
        b.textContent = 'become a member';
        toast(String(err.message || 'the payment page did not open'));
      }
    });
    $('#clubKeyKeep').addEventListener('click', async () => {
      const v = $('#clubKeyIn').value.trim();
      if (/^cs_/.test(v)) {
        // a checkout session pasted whole: walk it through the door
        try {
          const got = await clubClient().door(v);
          store.settings.clubKey = got.key; store.saveSettings();
          toast('that payment went through. your key is kept on this device');
          renderClub();
        } catch (e) { toast(String(e.message || 'the club did not answer')); }
        return;
      }
      // The alphabet the club actually mints, from club/src/validate.js:34:
      // crockford base32, which has no i, l, o or u in it precisely so that a
      // key read off a screen cannot be typed back wrong. This test used to
      // accept all twenty-six, so the four characters the format exists to
      // keep out were waved through here and refused at the door, and the
      // sentence a person got back was the club's and not this one's.
      //
      // The sentence used to name those four letters. It was the clearest thing
      // in the room to whoever wrote the format and the most confusing thing in
      // it to everybody else: a person who has just failed to type a key does
      // not need the alphabet it was minted from, they need to be told to stop
      // typing and paste. So the rule stays exactly as strict and says the one
      // thing that fixes it.
      if (!/^tc_[0-9abcdefghjkmnpqrstvwxyz]{20,27}$/.test(v)) return toast('that key does not match the club format. paste the full key beginning tc_');
      store.settings.clubKey = v; store.saveSettings();
      renderClub();
    });
    return;
  }

  body.innerHTML = `
    <div id="clubDesk" role="status" aria-live="polite" aria-busy="true">${deskNote()}</div>
    <div class="set-sec">
      <div class="sec-head" role="heading" aria-level="2">membership</div>
      <div class="set-row-sub mono" id="clubStanding">asking the club…</div>
      <div class="set-row" style="margin-top:6px">
        <span class="set-row-sub mono" id="clubKeyText">${esc(key)}</span>
        <button class="word-btn quiet" id="clubKeyCopy">copy it</button>
      </div>
      <div class="set-row-sub" style="margin-top:6px">Write it down somewhere other than this browser. It is how any other device of yours reaches this backup.</div>
    </div>
    <div class="set-sec">
      <div class="sec-head" role="heading" aria-level="2">your backup</div>
      <div class="set-row">
        <input class="text-input" type="password" id="clubPhrase" style="max-width:320px" placeholder="Recovery phrase" autocomplete="off" aria-label="Recovery phrase" aria-describedby="clubPhraseHelp">
      </div>
      <div class="set-row-sub" id="clubPhraseHelp" style="margin-top:6px">Invent it here. Resonate never stores it. Keep it somewhere safe.</div>
      <!-- Both hidden until the club has said it is holding nothing. The
           reasoning is beside the answer that reveals them. -->
      <div class="set-row-sub" id="clubFirstSeal" style="margin-top:10px" hidden>Invent a phrase of eight characters or more and write it down somewhere other than this browser. This first backup is locked with it for good, and nobody stores it, so type it twice.</div>
      <div class="set-row" id="clubPhrase2Row" hidden>
        <input class="text-input" type="password" id="clubPhrase2" style="max-width:320px" placeholder="the same phrase again" autocomplete="off" aria-label="Recovery phrase, again">
      </div>
      <div class="word-row" style="margin-top:14px">
        <button class="word-btn" id="clubSync" disabled>back it up now</button>
        <button class="word-btn quiet" id="clubPrev">the backup before this one</button>
      </div>
      <div class="set-row-sub" id="clubMeta" style="margin-top:10px"></div>
      <div class="set-row-sub" style="margin-top:10px">This is a backup, not a sync. Saving first copies anything the backup has that this atlas is missing, then stores everything again.</div>
      <div class="set-row-sub" style="margin-top:10px">Deleting here is not copied: a saved item returns the next time you back up. To remove it from the club, delete both backups, then save a fresh one. Lose the phrase and nobody, us included, can open them.</div>
      <div class="set-row-sub" style="margin-top:10px">It saves you from losing your device, not from losing our account: both backups sit on one company's machines. Download a private backup file now and again.</div>
    </div>
    <div class="set-sec">
      <div class="sec-head" role="heading" aria-level="2">leaving</div>
      <div class="word-row">
        <button class="word-btn quiet" id="clubEnd">end the membership</button>
        <button class="word-btn quiet" id="clubBurn">delete both backups</button>
        <button class="word-btn quiet" id="clubForget">forget the key on this device</button>
      </div>
      <div class="set-row-sub" style="margin-top:10px">Only the first stops the payments, at Stripe. The other two delete the backups, or forget the key on this device. A membership that has ended leaves both backups readable until you delete them.</div>
    </div>`;

  settleDesk();

  // What this button means depends on an answer that has not arrived, so it
  // cannot be pressed until it has. The promise is kept rather than only the
  // disabled attribute, because a guarantee that lives on one attribute of one
  // element is a guarantee that the next surface can forget to ask for.
  // An answer belongs to the room that asked for it. This room can be painted
  // again while a question is still in the air, by forgetting the key or by
  // finishing a payment, and an answer landing in a room that no longer has
  // these elements used to write to null: an enabled seal on a stale reading,
  // or a throw inside the catch that was there to prevent throwing.
  const gen = ++roomGen;
  const mine = () => gen === roomGen;
  const say = (id, text) => { if (mine()) { const el = $(id); if (el) el.textContent = text; } };

  roomKnows = (async () => {
    try {
      const m = await clubClient().membership();
      if (!mine()) return false;
      const until = m.until ? new Date(m.until * 1000).toISOString().slice(0, 10) : '';
      say('#clubStanding',
        m.standing === 'good' ? `a member${until ? ` until ${until}` : ''}${m.leaving ? ', and it ends on that date' : ''}`
        : m.standing === 'lapsed' ? 'the membership has ended. your backups are still yours to read and delete; pay again to save new ones'
        : m.standing === 'left' ? 'the membership has ended. your backups are still yours'
        : 'the club does not recognise this key');
      // "no backup yet" and "the club would not say" were one sentence here,
      // and they are the opposite of each other for the decision below: one
      // means the phrase must be read twice, the other means nothing is known
      // and nothing may be sealed.
      let got = null;
      try { got = await clubClient().getVault(); }
      catch {
        say('#clubMeta', 'the club did not say what it is holding');
        return false;
      }
      if (!mine()) return false;
      say('#clubMeta', got?.at
        ? `last saved ${got.at.slice(0, 10)}, ${got.bytes.length.toLocaleString()} bytes`
        : 'no backup yet');
      // The second field only stands where it earns its room: before the seal
      // that fixes the phrase for good. The phrase is invented by the person
      // and stored by nobody, so the very first backup is the one moment a typo
      // in it is permanent. It seals against the typo, and every later attempt
      // to open it uses the phrase they meant. Once a backup exists there is
      // nothing left to guard: a wrong phrase then simply fails to open it.
      //
      // This row used to be painted from store.settings.clubSeq and corrected
      // here, two round trips later, and the comment that stood beside it
      // argued that shown-then-taken-away was the safe direction because
      // hidden-then-shown fails open. It was half right. The count fails open
      // too, in the direction it did not think of: a device carrying a sequence
      // of three, opened after ANOTHER device burned both backups, painted the
      // row away and sealed the first backup of a fresh store under a phrase
      // typed once. That is the exact harm this field exists to prevent.
      //
      // So neither guess is acted on. The row is revealed by this answer rather
      // than by arithmetic, and because nothing below can be pressed before the
      // answer lands, the direction is free to be the kind one: a field that
      // appears cannot take the keystrokes of somebody already typing into it.
      // The sentence stands with the second field because it is true at the
      // same moment and about the same thing: this is the seal that fixes the
      // phrase. The room said what losing the phrase costs and never where the
      // phrase comes from, and outside this app a recovery phrase is twelve
      // words a service hands you, so the field read as a place to type
      // something already given rather than somewhere to invent one. The
      // eight-character rule was spoken first by a toast, after a press.
      const again = $('#clubPhrase2Row');
      const first = $('#clubFirstSeal');
      if (again) again.hidden = !!got?.at;
      if (first) first.hidden = !!got?.at;
      const btn = $('#clubSync');
      if (btn) btn.disabled = false;
      return true;
    } catch { say('#clubStanding', 'the club did not answer'); return false; }
  })();

  $('#clubKeyCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(key); toast('the key is copied. write it down somewhere other than this browser'); }
    catch { toast('this browser would not copy it. select it on the line above'); }
  });
  $('#clubSync').addEventListener('click', clubSync);
  $('#clubPrev').addEventListener('click', async () => {
    const phrase = $('#clubPhrase').value;
    if (phrase.length < 8) return toast('the phrase needs at least eight characters');
    const btn = $('#clubPrev');
    btn.disabled = true;
    try {
      const got = await clubClient().getVault(true);
      if (!got) return toast('the club has no earlier backup');
      let text;
      try { text = await unseal(got.bytes, phrase, { bind: store.settings.clubKey }); }
      catch (e) {
        return toast(e.message === 'wrong-phrase' ? 'that phrase does not unlock this backup'
          : e.message === 'sealed-for-another-key' ? 'this backup was locked with a different key'
          : e.message === 'this-device-cannot-open-it' ? 'the backup is fine; this device cannot unlock it. a newer browser, or another device, can'
          : 'what the club holds is not a resonate backup');
      }
      let wrapper;
      try { wrapper = JSON.parse(text); } catch { return toast('the backup unlocked, but what is inside cannot be read'); }
      const atlas = wrapper.atlas ?? wrapper;
      const nHeld = (atlas.places?.length ?? 0) + (atlas.routes?.length ?? 0);
      const when = wrapper.sealedAt ? fmtDate(wrapper.sealedAt).toLowerCase() : 'before the last';
      if (!await ask(`The backup before this one was saved ${when} and holds ${nHeld} record${nHeld === 1 ? '' : 's'}. Bring home what it has and this atlas is missing? Nothing here is deleted, and nothing is saved until you back up again.`, { yes: 'bring it home', no: 'leave it' })) return;
      // The atlas alone. An earlier envelope's letters slice is an earlier
      // reading of who may write to you, and bringing that home would restore
      // a pairing this device has since withdrawn or a mark it has since had
      // to repair. Records are additive and safe to bring back from further
      // away; permissions are not.
      const r = await bringHome(atlas);
      if (!r.ok) {
        if (r.why === 'lossy') return sayWhatWasLost(r.lost, { verb: 'come home' });
        return toast('this device would not save it, so nothing changed');
      }
      if (r.added) renderAll();
      // This door has no panel of counts in front of it, so both things a
      // person is owed are said in the one sentence that follows it. The
      // photographs used to be said instead: the clause returned where it
      // stood, and somebody who brought home an older backup carrying
      // pictures was told about the pictures and never told how many records
      // arrived, which is the question they pressed the word to answer.
      const nPics = photographsSetAside(r.setAside);
      const came = r.added
        ? `${r.added} record${r.added === 1 ? '' : 's'} came home from the backup before this one`
        : 'this atlas already holds everything that backup does';
      const alsoPictures = nPics
        ? `. ${nPics} photograph${nPics === 1 ? '' : 's'} in that backup stayed behind: this version keeps none, and the backup at the club is untouched and still has them`
        : '';
      toast(came + alsoPictures, nPics ? 9000 : undefined);
    } catch { toast('the club did not answer'); }
    finally { btn.disabled = false; }
  });
  $('#clubEnd').addEventListener('click', async (e) => {
    // Stripe is where a subscription ends, and the club can only ask for the
    // door. The two words beside this one delete backups and forget a key, and
    // a member who pressed them believing the money had stopped would go on
    // paying for a vault they had emptied.
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const { url } = await clubClient().portal();
      if (!url) throw new Error('the club could not open the billing page');
      location.href = url;
    } catch (err) {
      b.disabled = false;
      toast(String(err.message || 'the club did not answer'));
    }
  });
  $('#clubBurn').addEventListener('click', async (e) => {
    // currentTarget is cleared by the browser once this listener yields, so
    // hold the button before the question's await.
    const btn = e.currentTarget;
    if (!await ask('Delete both backups at the club? Your atlas here is untouched, and the key stays so you can back up again. A backup this device can no longer unlock is deleted too.', { yes: 'delete them', no: 'keep them', danger: true })) return;
    btn.disabled = true;
    try {
      const deleted = await clubClient().delVault();
      if (!deleted.gone) {
        btn.textContent = 'check deletion again';
        toast('the club is still deleting both backups. check again in a moment', 8000);
        return;
      }
      // an emptied vault must be sealable again: the count starts over
      Object.assign(store.settings, burnPatch());
      store.saveSettings();
      toast('both backups are gone'); renderClub();
    }
    catch { toast('the club did not answer'); }
    finally { btn.disabled = false; }
  });
  // The gentlest word on this surface is the one that asked nothing. `delete
  // both backups` two words to the left asks first, and a removed contact both
  // asks and can be taken back; this one wiped the key on the press.
  //
  // What it wipes is the whole road back. The paste-it-back field above wants
  // the key itself, and the cs_ road wants a join secret that a finished join
  // already threw away, so a key written nowhere but this browser is gone at
  // this press and both sealed backups become unreachable. The room only ever
  // advised writing it down.
  //
  // So it asks, and while this tab is still open it can be put back: the key
  // and the count go into a closure rather than to the club, which is the same
  // shape a removed contact already gets. Nothing here touches the membership
  // or the backups, and the question says so, because the fear the question
  // raises must not be a larger fear than the truth.
  $('#clubForget').addEventListener('click', async () => {
    if (!await ask('Forget the key on this device? The membership goes on and nothing at the club is deleted, but this device can no longer reach either backup. If the key is written nowhere but here, there is no way back to them.',
      { yes: 'forget it here', no: 'keep it', danger: true })) return;
    const gone = { clubKey: key, clubSeq: store.settings.clubSeq, clubSealedAt: store.settings.clubSealedAt };
    store.settings.clubKey = ''; store.settings.clubSeq = 0; store.settings.clubSealedAt = '';
    store.saveSettings();
    renderClub();
    toast('the key is forgotten on this device. the membership continues', 9000, { word: 'take it back', run: () => {
      Object.assign(store.settings, gone);
      if (!store.saveSettings()) return toast('this browser would not save it again');
      renderClub();
      toast('the key is back on this device');
    } });
  });
}

async function clubSync() {
  // The button that reaches here is dead until the club has answered, and this
  // waits for the same answer anyway. Both, because the two protect different
  // things: the attribute stops a person pressing a question the room cannot
  // yet answer, and this stops any later caller from sealing on a guess about
  // whether a backup exists. Getting that wrong once seals a first backup
  // under a phrase read only once, and that backup is unopenable for good.
  if (roomKnows && !(await roomKnows)) {
    return toast('the club has not said what it is holding yet. nothing was saved');
  }
  const phrase = $('#clubPhrase').value;
  if (phrase.length < 8) return toast('the phrase needs at least eight characters');
  // The second field stands only before the first seal, and when it stands it
  // is not optional. Nobody stores this phrase, so a typo in the one that
  // seals the first backup is not a wrong password: it is a backup that opens
  // for a string its owner never knew they typed.
  const again = $('#clubPhrase2Row');
  if (again && !again.hidden && $('#clubPhrase2').value !== phrase) {
    return toast('the two phrases do not match. nothing was saved');
  }
  const btn = $('#clubSync');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'saving…';
  // The vault refuses a seal written over a revision this device did not read.
  // That refusal is the whole point: two devices used to be able to read the
  // same envelope and then overwrite one another, and the loser's records went
  // with no trace. A refusal means someone else sealed in the seconds since
  // this device looked, and the answer is to look again rather than to insist.
  // One retry, then a sentence; never a blind rewrite.
  try {
    let done = await sealOnce(phrase);
    if (done === 'stale') done = await sealOnce(phrase);
    if (done === 'stale') toast('another device saved while this one was reading. nothing was written, so try once more', 6000);
  } catch (e) {
    toast(e.message === 'lapsed' ? 'the membership has ended. pay again to save new backups'
      : e.message === 'too-large' ? 'this atlas is too large for one backup'
      : 'the club did not answer');
  } finally {
    btn.disabled = false; btn.textContent = 'back it up now';
  }
}

// What the vault holds about writing to people, brought home.
//
// The rule is in js/pairing.js, where it is pure and where node can plant a
// defect in it. This is the half that touches the device: nothing is kept
// unless the store accepts it, and a refused write leaves the slice exactly
// as it was.
//
// A refused write says so, and says it in a word of its own. It used to answer
// `none`, which is also what a backup holding nothing new answers, and the two
// are opposite facts: one means this device is already whole, the other means
// it has just failed to keep something the vault has and it does not. The
// caller seals immediately afterwards, so a refusal read as `none` is a poorer
// slice written over a richer one, and for this slice there is no second copy
// anywhere to read it back from.
function bringLettersHome(theirs) {
  const done = mergeLetters(store.letters, theirs);
  if (done.identity === 'clash' || done.identity === 'invalid' || done.letters === store.letters) return done;
  const before = store.letters;
  store.letters = done.letters;
  if (!store.saveLetters()) { store.letters = before; return { identity: 'refused', added: 0, theirs: null }; }
  return done;
}

// The membership's identity, minted at the only moment it can safely be minted.
//
// Not on boot, not when the club room opens, not when somebody first presses
// `introduce me`: on the first seal, after the vault has been read and merged.
// Two keys under one membership is two people, and the friend who verified a
// mark against one of them has verified nothing about the other. So the key is
// made only when this device has just looked at everything the membership holds
// and found no key there, and it is written into the backup in the same breath.
// An identity that exists on a device and in no vault is one lost phone away
// from a correspondent whose letters nobody can open.
async function mintIfNone() {
  if (store.letters.jwk) return false;
  const { jwk, pub } = await mintIdentity();
  return !!store.setIdentity({ jwk, pub });
}

// one read, one merge, one seal. returns 'stale' when the club refused because
// the envelope moved underneath, and undefined otherwise.
async function sealOnce(phrase) {
  {
    const c = clubClient();
    const got = await c.getVault();
    const lastSeq = Number(store.settings.clubSeq) || 0;

    // an empty answer over a vault this device has already sealed is not
    // trusted: it is a stale edge or a hollowed club, and pushing over it
    // would demote the real envelope. nothing is written on a doubt.
    if (syncGuard(!!got, lastSeq) === 'refuse-empty') {
      toast('the club answered empty, but something was saved before. nothing written; try again shortly');
      return;
    }

    let brought = 0;
    let remoteSeq = 0;
    let letters = { identity: 'none', added: 0, theirs: null };
    if (got) {
      let text;
      try { text = await unseal(got.bytes, phrase, { bind: store.settings.clubKey }); }
      catch (e) {
        toast(e.message === 'wrong-phrase' ? 'that phrase does not unlock this backup'
          : e.message === 'sealed-for-another-key' ? 'this backup was locked with a different key'
          : e.message === 'this-device-cannot-open-it' ? 'the backup is fine; this device cannot unlock it. a newer browser, or another device, can'
          : 'what the club holds is not a resonate backup');
        return;
      }
      // the envelope carries its own count. an older envelope than this
      // device has already seen is never sealed over.
      let wrapper;
      try { wrapper = JSON.parse(text); } catch {
        toast('the backup unlocked, but what is inside cannot be read. nothing written');
        return;
      }
      remoteSeq = Number(wrapper.seq) || 0;
      const atlas = wrapper.atlas ?? wrapper;
      if (remoteSeq < lastSeq) {
        toast('the club returned an older backup than this device has seen. nothing written; try again shortly');
        return;
      }

      // Validate the non-exportable identity slice before bringing any atlas
      // records home. A wrapper from before this slice existed omits it; a
      // present value that fails its gate is unreadable remote state, never an
      // empty slice this device may replace with its own.
      const checkedLetters = mergeLetters(store.letters, wrapper.letters);
      if (checkedLetters.identity === 'invalid') {
        toast('the backup’s correspondent data could not be read. nothing changed or was written', 8000);
        return;
      }

      const home = await bringHome(atlas);
      if (!home.ok) {
        // an envelope this device could not read whole must never be sealed
        // over by one it wrote from a poorer copy. the promise on this panel
        // is that the envelope is safer than the device, and this is where
        // that promise is either kept or quietly broken.
        if (home.why === 'lossy') {
          await sayWhatWasLost(home.lost, { verb: 'come home' });
          toast('your backup was left as it was', 6000);
        } else {
          toast('this device would not save it, so your backup was left as it was', 6000);
        }
        return;
      }
      // the envelope has already been merged into this atlas by now, so it is
      // drawn before anything below can return: a person must never be left
      // looking at a stale field because a question came after the write
      brought = home.added;
      if (brought) renderAll();

      // The atlas is whole in hand now; only now apply the already-validated
      // identity slice. Its local write remains a gate on sealing a poorer
      // copy back over the vault.
      letters = bringLettersHome(wrapper.letters);
      if (letters.identity === 'refused') {
        toast('this device could not save the backup’s correspondent data, so the club backup was left unchanged', 8000);
        return;
      }

      // An envelope that still holds photographs must never be replaced by
      // one written from a copy that cannot hold them. This is the severe
      // one: the club save is automatic in feel, it keeps only the backup
      // before it, so two saves take both copies, and the device doing the
      // saving may be one whose own store is already empty. The club can be
      // the last place a person's photographs exist.
      //
      // So it is a question, and the way out does not depend on this device
      // holding anything: the envelope itself is written to a file, exactly
      // as the club had it, pictures and all. Escape lands on "not now",
      // which writes nothing, because the word that costs may never be the
      // one a person reaches by pressing away a dialog.
      const nPics = photographsSetAside(home.setAside);
      if (nPics) {
        const word = await ask(
          `Your backup at the club holds ${nPics} photograph${nPics === 1 ? '' : 's'}. This version of Resonate keeps none, so saving now would replace that backup with one that has none of them.\n\n`
          + 'The backup before it keeps them for one more save, and then it does not.\n\n'
          + 'Take them out of the club first. Bring the backup home writes everything the club is holding to a private backup file, photographs and all.',
          { yes: 'bring the backup home', also: 'save without them', no: 'not now' });
        if (word === true) {
          const day = new Date().toISOString().slice(0, 10);
          download(`resonate-club-backup-${day}.json`, JSON.stringify(atlas, null, 2), 'application/json');
          toast('the private backup file includes everything at the club, photographs and all. nothing was saved over', 7000);
          return;
        }
        if (word !== 'also') return;
      }
    }

    const seq = Math.max(remoteSeq, lastSeq) + 1;
    // an envelope short of anything must never replace one that has it. what
    // could go short was the pictures, read back out of a store of their own,
    // and that reading is gone; what the club may still be holding is asked
    // about above, before a word of this runs.
    const json = store.exportJSON();
    // The 3 here is the envelope's own number and belongs to nothing else. It
    // counts the shape of this wrapper, which is a sequence, a time, an atlas
    // and the letters slice, and it moves when the wrapper gains or loses one
    // of those. The archive it carries states its own version inside `atlas`,
    // where a reader that opens this envelope will find it. Neither number may
    // be read as the other, which is why this one stays a literal at the only
    // place that writes it rather than becoming a constant that could be
    // reached for by mistake.
    //
    // It moved from 2 to 3 for the letters slice, and that slice is here and
    // in no file for a reason worth writing at the line that seals it. Identity
    // is the membership rather than the device, so the private key has to be
    // able to reach a second device; and a private key that can travel must
    // travel only inside something sealed, because a copy of it is not a
    // disclosure of what a person wrote but the ability to write as them. The
    // vault is sealed under a phrase this device never stores and the club
    // never sees. exportJSON is a file in a downloads folder. So: here, and
    // nowhere else, and store.exportJSON does not name it.
    // The identity is minted here, between the merge and the seal, and the
    // reasoning is at mintIfNone. A clash mints nothing: a device in a clash
    // already holds a key, and the branch below is about not choosing between
    // two of them.
    const minted = await mintIfNone();
    // and what goes into the envelope. On a clash it is the backup's own slice,
    // written back exactly as it was read, so the sentence a person is about to
    // be shown — that neither was changed — is true of the vault and not only
    // of this device. Everywhere else it is what this device now holds, which
    // by this line includes anything the backup brought home and the key just
    // minted.
    const lettersOut = letters.identity === 'clash' ? letters.theirs : store.letters;
    const sealed = await seal(JSON.stringify({
      v: 3,
      seq,
      sealedAt: new Date().toISOString(),
      atlas: JSON.parse(json),
      letters: lettersOut,
    }), phrase, { bind: store.settings.clubKey });
    let meta;
    try { meta = await c.putVault(sealed); }
    catch (e) { if (e.message === 'stale') return 'stale'; throw e; }
    store.settings.clubSeq = seq;
    store.settings.clubSealedAt = meta.at;
    store.saveSettings();
    $('#clubMeta').textContent = `last saved ${meta.at.slice(0, 10)}, ${meta.bytes.toLocaleString()} bytes`;
    // The identity is worth its own clause, and it is a clause rather than a
    // toast of its own on purpose. It used to be said the moment the merge
    // decided, which put it on screen for as long as the seal took and then
    // replaced it with "backed up": on the two engines where Argon2id is
    // quickest, the sentence a person most needed was the one they never saw.
    // A sentence that matters goes in the last thing said, not the first.
    const alsoLetters = letters.identity === 'taken'
      ? '. this device can write to your correspondents again'
      : letters.identity === 'clash'
        ? '. this device and your backup hold different identities for one membership, so neither was changed. nobody can say from here which of them your correspondents verified'
        : letters.added
          ? `. ${letters.added} correspondent${letters.added === 1 ? '' : 's'} came home too`
          // Said once, on the seal that mints it, because it is the moment a
          // person becomes reachable and there is no other moment to say so:
          // voices is where introductions are handed out, and a person who
          // never opens voices has still just gained an address.
          : minted
            ? '. this membership can be written to now, from letters'
            : '';
    toast((brought
      ? `${brought} place${brought === 1 ? '' : 's'} came home. everything is backed up`
      : 'backed up') + alsoLetters,
    letters.identity === 'clash' ? 12000 : alsoLetters ? 7000 : undefined);
  }
}

const VERBS = {
  share: { run: shareMap, hint: 'share a collection or your whole atlas' },
  collections: { run: () => openFolioShelf(), hint: 'create and manage collections' },
  people: { run: showContacts, hint: 'people you trust and what they share' },
  census: { run: () => openSurface('statsOverlay', renderStats), hint: 'your atlas at a glance' },
  stats: { run: () => openSurface('statsOverlay', renderStats), hint: 'your atlas at a glance' },
  // One room, four words, and the hint is the same on all four because the room
  // is. `yours` was the word on the board until 2026-08-19 and `settings` has
  // never been on it; a table with more words than rooms is the shape this
  // already had, and the hint going stale on three of them was the shape it
  // should not have. The room grew the club and the manual and only the newest
  // word said so.
  you: { run: () => openSurface('settingsOverlay', renderSettings), hint: 'backups, assistants, privacy, and this device' },
  yours: { run: () => openSurface('settingsOverlay', renderSettings), hint: 'backups, assistants, privacy, and this device' },
  kept: { run: () => openSurface('settingsOverlay', renderSettings), hint: 'backups, assistants, privacy, and this device' },
  settings: { run: () => openSurface('settingsOverlay', renderSettings), hint: 'backups, assistants, privacy, and this device' },
  tags: { run: () => openSurface('tagsOverlay', renderTags), hint: 'labels that group related things' },
  contacts: { run: showContacts, hint: 'people you trust and the places they share' },
  // The two words this room used to be, kept as verbs and pointed at the room
  // that replaced them. A verb that refuses to exist teaches a person that they
  // typed the wrong thing; one that answers teaches them where the thing went.
  // `mark` and `drop` have stood as one act under two words since the beginning,
  // so a table with more words than rooms is the shape this already had.
  voices: { run: showContacts, hint: 'legacy name for People' },
  // Typed, this answers whether or not the word is on the board, and the room
  // says why when there is no membership behind it. A verb that refuses to
  // exist teaches a person that they typed the wrong thing; a room that tells
  // them what it needs teaches them what this is.
  //
  // showContacts rather than the surface, because this verb is both roads a
  // person actually walks in by: the word on the index board runs the verb, and
  // so does the command line. Painting the room without asking the club made
  // the one room letters land in the one room that could be a day out of date.
  letters: { run: () => showContacts({ explain: true }), hint: 'direct sharing with trusted people' },
  club: { run: () => openSurface('clubOverlay', renderClub), hint: 'the travellers club. an encrypted backup, off this device' },
  keys: { run: () => openSurface('keysOverlay', renderKeys), hint: 'the keyboard' },
  mark: { run: () => { const c = mapView.getCenter(); proposeAdd(c.lat, c.lng); }, hint: 'add a place at the centre of the map' },
  drop: { run: () => { const c = mapView.getCenter(); proposeAdd(c.lat, c.lng); }, hint: 'add a place at the centre of the map' },
  frame: { run: () => mapView.fitAll(filteredPlaces()), hint: 'fit everything in view' },
  locate: { run: () => findMe(), hint: 'the places nearest where you are' },
  near: { run: () => findMe(), hint: 'the places nearest where you are' },
  nearby: { run: () => findMe(), hint: 'the places nearest where you are' },
  dark: { run: () => setTheme('dark'), hint: 'use the dark theme' },
  light: { run: () => setTheme('light'), hint: 'use the light theme' },
  photo: { run: () => $('#shootFile').click(), hint: 'add a place from a geotagged photo' },
  // the only `here`. an older one meaning mark-the-middle-of-the-field stood
  // up between `mark` and `drop`, and a duplicate key keeps its first position
  // and its last value, so the word ran standHere while the legend printed it
  // in the middle of two rows promising something else.
  here: { run: () => standHere(), hint: 'save your current location' },
  hike: { run: () => $('#gpxFile').click(), hint: 'import a gpx path' },
  route: { run: () => $('#gpxFile').click(), hint: 'import a gpx path' },
  walk: { run: () => $('#gpxFile').click(), hint: 'import a gpx path' },
  path: { run: () => $('#gpxFile').click(), hint: 'import a gpx path' },
  paths: { run: () => $('#gpxFile').click(), hint: 'import a gpx path' },
  export: { run: exportEverything, hint: 'download a private backup file' },
  print: { run: () => printSheet(atlasSheetOpts()), hint: 'the atlas typeset, to paper or pdf' },
  pdf: { run: () => printSheet(atlasSheetOpts()), hint: 'the atlas typeset, to paper or pdf' },
  import: { run: () => { openSurface('settingsOverlay', renderSettings); $('#impJson').click(); }, hint: 'restore from a backup file' },
  been: { run: () => setStatusFilter('visited'), hint: 'only places you’ve been' },
  want: { run: () => setStatusFilter('wishlist'), hint: 'only places still to go' },
  all: { run: () => setStatusFilter('all'), hint: 'everything' },
  // typed as a word, so it is read as a word: the retirement missed this door
  // once because the rule that polices it reads what a module says and a verb
  // here is what a module is named
  example: { run: previewDemo, hint: 'explore the example without adding it' },
  full: { run: previewDemo, hint: 'explore the example without adding it' },
  fill: { run: previewDemo, hint: 'explore the example without adding it' },
  clear: { run: clearUntouched, hint: 'remove untouched starter records' },
  list: { run: () => openFolioShelf(), hint: 'create and manage collections' },
  lists: { run: () => openFolioShelf(), hint: 'create and manage collections' },
  folio: { run: () => openFolioShelf(), hint: 'create and manage collections' },
  folios: { run: () => openFolioShelf(), hint: 'create and manage collections' },
  book: { run: addBookByHand, hint: 'keep a book worth handing on' },
  books: { run: addBookByHand, hint: 'keep a book worth handing on' },
  ask: { run: composeAsk, hint: 'request someone’s taste' },
  // Off the board since 2026-08-19, and reachable four ways: the opening plays
  // itself on a first visit, `?` replays it, the foot of the you room holds the
  // word, and this answers whatever a person types.
  how: { run: () => openSurface('howOverlay'), hint: 'the essentials, without the manual' },
  about: { run: () => openSurface('howOverlay'), hint: 'the essentials, without the manual' },
  // The words this app teaches elsewhere, pointed at the rooms that answer
  // them. The corner says find or add and the word under a proposed place says
  // add, and `>add` answered that no such verb exists: a verb that refuses to
  // exist teaches a person that they typed the wrong thing. They sit together
  // at the foot of the table rather than beside the words they alias, because
  // the order here is the order the rows come in, and no prefix already in
  // somebody's hands should change what it answers first: `>a` is still all,
  // `>n` is still near, `>s` is still share.
  add: { run: () => { const c = mapView.getCenter(); proposeAdd(c.lat, c.lng); }, hint: 'add a place at the centre of the map' },
  new: { run: () => { const c = mapView.getCenter(); proposeAdd(c.lat, c.lng); }, hint: 'add a place at the centre of the map' },
  save: { run: exportEverything, hint: 'your data, yours' },
  help: { run: () => openSurface('howOverlay'), hint: 'what this is, what it keeps, what it shares' },
};

// The command line keeps old vocabulary working without making the reader
// learn the history of the interface. Only one present-tense name for each
// action is discoverable; an exact legacy word resolves to that name.
const VISIBLE_VERBS = [
  'share', 'collections', 'people', 'settings', 'stats', 'tags', 'club', 'keys',
  'mark', 'frame', 'nearby', 'dark', 'light', 'photo', 'here', 'path', 'book',
  'export', 'print', 'import', 'been', 'want', 'all', 'ask', 'example', 'how',
];
const VERB_ALIASES = {
  census: 'stats', you: 'settings', yours: 'settings', kept: 'settings',
  contacts: 'people', voices: 'people', letters: 'people',
  drop: 'mark', add: 'mark', new: 'mark', locate: 'nearby', near: 'nearby',
  hike: 'path', route: 'path', walk: 'path', paths: 'path',
  pdf: 'print', save: 'export', list: 'collections', lists: 'collections',
  folio: 'collections', folios: 'collections', books: 'book',
  full: 'example', fill: 'example', about: 'how', help: 'how',
};

function setStatusFilter(status) {
  state.filters.status = status;
  $$('#statusSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
  renderList(); syncMarkers();
}

function route(q) {
  if (q[0] === '>') return { kind: 'verb', rest: q.slice(1).trim().toLowerCase() };
  if (q[0] === '#') return { kind: 'tag', rest: q.slice(1).trim().toLowerCase() };
  if (q[0] === '@') return { kind: 'voice', rest: q.slice(1).trim().toLowerCase() };
  const at = coordsIn(q);
  if (at) return { kind: 'coords', lat: at.lat, lng: at.lng };
  if (/^https?:\/\//i.test(q)) return { kind: 'link', rest: q };
  return { kind: 'search', rest: q };
}

function openPalette() {
  openSurface('paletteOverlay');
  palette.input.value = '';
  palette.input.placeholder = 'Search or keep…';
  palette.input.focus();
  renderPaletteResults('');
}
function openKeepChooser() { openPalette(); }
function togglePalette() {
  if (topSurface() === 'paletteOverlay') popSurface();
  else openPalette();
}

// How many cities a typed word may offer, standing above the person's own
// places. Three, because they are an offer and the places are the answer.
//
// The empty bar has no cap at all. It used to have one, at twelve, under a
// comment arguing that a person with places in fifteen cities should see
// fifteen: the argument was right and the number contradicted it, and nothing
// on the screen said the list had been cut. The box scrolls and is anchored at
// the input end, so the cities held most in are always the ones nearest the
// hand however many there are, and arrowing past the end now carries the box
// with it. Nothing is cut, so nothing has to be confessed.
const CITY_ROWS_TYPED = 3;

// The cities a person keeps places in, most held first, all of them. `q`
// matches the label the sheet prints, so what is typed is matched against what
// is shown. The placeless are not among them: a folio needs a title, and off
// the map is not a city anybody asked for.
//
// The country rides in its own field as well as inside the label, because the
// row has to be able to protect it when the screen is narrow.
function cityMatches(q) {
  const needle = String(q || '').toLowerCase();
  return citiesHeld(allPlaces())
    .filter(g => g.label !== PLACELESS && (!needle || g.label.toLowerCase().includes(needle)))
    .map(g => ({ kind: 'city', label: g.label, places: g.places, country: g.places[0]?.country || '' }));
}

// What the three-city cap on a typed word left out, said rather than left as a
// silence. The empty bar never needs this, because it cuts nothing.
function moreCities(all, shown) {
  const n = all.length - shown.length;
  return n > 0 ? `and ${n} more ${n === 1 ? 'city' : 'cities'} of yours. keep typing.` : '';
}

// The places most recently kept or changed, for the one atlas the city rows
// cannot describe: every place in it has no city.
//
// That is not a rare shape. It is what a person holds who marks places with no
// signal, or drops photographs in, or writes the middle of the field down and
// names it later, and geocoding is the thing they were doing without. Their
// empty bar painted city rows, found none, and opened onto two teaching lines
// over a blank.
//
// Most recently touched, because the argument against the six earliest is the
// argument for these: an atlas older than a week has its oldest records at the
// far end of what anybody is currently looking for, and the newest at the near
// end. An atlas holding nothing at all still gets the two teaching lines, and
// they are the true thing to show a person with nothing yet.
//
// Six of them, where the cities are uncapped, and the difference is what a row
// does. Pressing a city composes a folio, so every city is worth reaching by
// hand. Pressing a place flies to it, which is what typing its name does too,
// and a wall of place rows would bury the two lines that teach the bar.
//
// This stands in only where there is no city at all. An atlas holding one city
// and forty places without one shows that city, which is thin but true, and
// the rest are a typed word away: mixing the two kinds of row would make a
// list where pressing one thing composes and pressing its neighbour flies.
function heldRecently(limit) {
  return [...allPlaces()]
    .sort((a, b) => String(b.updatedAt || b.createdAt || '')
      .localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, limit)
    .map(p => ({ kind: 'local', place: p }));
}

// Nothing typed is not a search. This used to answer an empty bar with the six
// places saved earliest, unranked, which for any atlas older than a week are
// the least likely things anybody is looking for. The empty bar offers cities
// now, in renderPaletteResults.
function localMatches(q) {
  if (!q) return [];
  return searchLibrary({
    places: allPlaces(), routes: allRoutes(), books: allBooks(),
    tags: allTags(), correspondents: [],
  }, q, { limit: 9 }).map(item => ({ kind: 'library', item }));
}

function corrMatches(q) {
  if (!q) return [];
  return searchLibrary({ correspondents: store.correspondents }, q, { limit: 6 })
    .map(item => ({ kind: 'library', item }));
}

function rowHTML(item, i) {
  const hl = i === palette.hl ? ' hl' : '';
  if (item.kind === 'library') {
    const x = item.item;
    const record = x.record;
    const mark = x.kind === 'book' ? '¶' : x.kind === 'path' ? (record.loop ? '◯' : '⟋') : '·';
    const placeLine = [record.city, record.country].filter(Boolean).join(' · ');
    const bookLine = [record.author, record.year].filter(Boolean).join(', ');
    const pathLine = [Number.isFinite(record.km) ? fmtKm(record.km) : '', placeLine].filter(Boolean).join(' · ');
    const detail = x.kind === 'book' ? bookLine : x.kind === 'path' ? pathLine : placeLine;
    const after = x.correspondent ? ` · after ${x.correspondent.name}` : '';
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-kind" aria-hidden="true">${mark}</span><span class="row-name">${esc(x.title)}</span><span class="row-sub">${esc(x.kind)}${after ? `<span class="after">${esc(after)}</span>` : ''}${detail ? ` · ${esc(detail)}` : ''} · ${esc(x.stateLabel)}</span></button>`;
  }
  if (item.kind === 'corrplace') {
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">${esc(item.p.name)} <span class="after">· after ${esc(item.c.name)}</span></span><span class="row-sub">${esc([item.p.city, item.p.country].filter(Boolean).join(' · '))}</span></button>`;
  }
  if (item.kind === 'local') {
    const p = item.place;
    const side = datumWord(p);
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">${esc(p.name)}</span><span class="row-sub">${esc([p.city, p.country].filter(Boolean).join(' · ') || side)}</span></button>`;
  }
  if (item.kind === 'remote') {
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">${esc(item.r.name)}</span><span class="row-sub">${esc(item.r.sub)} · <span class="key-only" aria-hidden="true">↵ </span>add</span></button>`;
  }
  // A city is offered as itself, with no verb in front of it: a person wants a
  // city, and then whom the folio is for, and not a tag line about a city in
  // the world. What pressing does is said in the column where every other row
  // says it.
  //
  // What it says there is the thing pressing makes, and it used to be a verb
  // with nothing after it. Every other verb in that column takes an object:
  // open, add, propose a place here, ask openstreetmap, inks the world. This
  // one read "compose", alone, over a name set in the same type and the same
  // column as a place. Read cold by someone who has not been told, a row
  // saying "Basel, Switzerland · 4 places · compose" does not say what it is
  // or what it will do, and this is the row the whole feature hangs on.
  //
  // The object is supplied and the verb goes, rather than the other way round,
  // because the column is not free. It is fixed width, the name takes what is
  // left, and the two were measured on a 375 pixel phone: "4 places · compose
  // a folio" wants 215 of the 176 pixels there are, and cuts every city in the
  // list, Lisboa included. "4 places · a folio" is 153, which is exactly what
  // "4 places · compose" costs today. The row says what it makes for nothing.
  //
  // And no sigil, which is the other half of the same question. Every sigil in
  // this bar is a prefix a person can type: > for a verb, # for a tag, @ for a
  // voice. A city has none, because a city is what answers when you type its
  // name. Drawing a mark in front of one would be teaching a key that does not
  // exist, which is a thing to learn in exchange for nothing.
  //
  // The label is written in two parts so the suite can prove that both city
  // and country survive a narrow screen. They flow as one phrase now: either
  // half may wrap, and neither may be exchanged for an ellipsis.
  //
  // Split only where the label genuinely ends in one, which is not the same as
  // the record having a country. A place that knows its country and not its
  // city waits under the country alone, and taking the country off that label
  // leaves nothing in front of the comma: the row would read ", Iceland".
  if (item.kind === 'city') {
    const n = item.places.length;
    const tail = `, ${item.country}`;
    const split = !!item.country && item.label.endsWith(tail) && item.label.length > tail.length;
    const name = split
      ? `<span class="ct-town">${esc(item.label.slice(0, -tail.length))}</span><span class="ct-land">${esc(tail)}</span>`
      : esc(item.label);
    // The two-part class is only worn by a genuinely two-part label; a lone
    // country remains the same plain run every other result uses.
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name${split ? ' city' : ''}">${name}</span><span class="row-sub">${n} place${n === 1 ? '' : 's'} · <span class="key-only" aria-hidden="true">↵ </span>make a collection</span></button>`;
  }
  if (item.kind === 'verb') {
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">&gt; ${item.verb}</span><span class="row-sub">${esc(item.hint)}</span></button>`;
  }
  if (item.kind === 'tag') {
    const on = state.filters.tags.has(item.tag.id);
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name"># ${esc(item.tag.name)}</span><span class="row-sub">${item.n} places · ${on ? 'filtered, <span class="key-only" aria-hidden="true">↵ </span>clears' : '<span class="key-only" aria-hidden="true">↵ </span>inks the world'}</span></button>`;
  }
  if (item.kind === 'voice') {
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">@ ${esc(item.c.name)}</span><span class="row-sub">${item.c.places.length} place${item.c.places.length === 1 ? '' : 's'}${item.c.visible === false ? ' · hidden from my map' : ''}</span></button>`;
  }
  if (item.kind === 'coords') {
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}</span><span class="row-sub"><span class="key-only" aria-hidden="true">↵ </span>propose a place here</span></button>`;
  }
  if (item.kind === 'link') {
    const enter = '<span class="key-only" aria-hidden="true">↵ </span>';
    const act = item.opaque ? `no place inside · ${enter}open it` : `${enter}read it for a place`;
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">a link</span><span class="row-sub">${esc(item.host)} · ${act}</span></button>`;
  }
  if (item.kind === 'world') {
    return `<button class="cmd-row${hl}" data-i="${i}"><span class="row-name">look up “${esc(item.q)}”</span><span class="row-sub"><span class="key-only" aria-hidden="true">↵ </span>ask openstreetmap</span></button>`;
  }
  return '';
}

function paletteSection(item) {
  if (item.kind === 'library' && item.item?.source === 'correspondent') return 'atlases you follow';
  if (item.kind === 'corrplace' || item.kind === 'voice') return 'atlases you follow';
  if (item.kind === 'remote' || item.kind === 'world') return 'new places';
  return 'your atlas';
}

function sectionedRows(items) {
  let section = '';
  return items.map((item, i) => {
    const next = paletteSection(item);
    const heading = next === section ? ''
      : `<div class="cmd-section" role="heading" aria-level="2">${next}</div>`;
    section = next;
    return heading + rowHTML(item, i);
  }).join('');
}

// Focus stays in the search field while the arrows move through its answers.
// The results are actions, not values to select, so they remain real buttons
// rather than pretending to be a listbox. A live status names the highlighted
// action and its position while the input keeps normal text-editing behaviour.
function syncPaletteActive() {
  const rows = $$('.cmd-row', palette.results);
  rows.forEach((row, i) => { row.id = `palette-answer-${i}`; });
  const active = palette.hl >= 0 ? rows[palette.hl] : null;
  palette.input?.removeAttribute('aria-activedescendant');
  const status = $('#paletteStatus');
  if (!status) return;
  const spokenText = selector => {
    const source = active?.querySelector(selector);
    if (!source) return '';
    const copy = source.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  const name = spokenText('.row-name');
  const detail = spokenText('.row-sub');
  // Read the two visual columns as two sentences. Concatenating textContent
  // removed their boundary and let decorative marks or an Enter-key glyph run
  // into the name as one unexplained phrase.
  const answer = [name, detail].filter(Boolean).join('. ');
  const said = active
    ? `${answer}. Result ${palette.hl + 1} of ${rows.length}.`
    : rows.length ? `${rows.length} results. Use the arrow keys to choose one.` : 'No results.';
  if (status.textContent !== said) status.textContent = said;
}

// `chosen` is the row Enter would act on, and -1 is none of them. Every list a
// person typed for has a first row that answers what they typed, and that row
// is lit. The untyped bar has no such row: it offers the cities somebody keeps
// places in, and nobody asked for the top one.
function paint(items, hint, { chosen = 0, sections = false } = {}) {
  palette.rows = items;
  palette.hl = chosen;
  palette.results.innerHTML =
    (hint ? `<div class="cmd-hint">${hint}</div>` : '') +
    (sections ? sectionedRows(items) : items.map((it, i) => rowHTML(it, i)).join(''));
  $$('.cmd-row', palette.results).forEach(r =>
    r.addEventListener('click', () => activateRow(parseInt(r.dataset.i, 10))));
  syncPaletteActive();
}

function activateRow(i) {
  const item = palette.rows[i];
  if (!item) return;
  if (item.kind === 'library') {
    const x = item.item;
    popSurface();
    if (x.source === 'correspondent') {
      if (x.kind === 'place') openForeignPlate(x.correspondent.id, x.record.id);
      else toast(`${x.title} is in ${x.correspondent.name}’s shared atlas`);
      return;
    }
    if (x.kind === 'path') selectRoute(x.record.id, { fly: true });
    else if (x.kind === 'book') selectBook(x.record.id);
    else selectPlace(x.record.id, { fly: true });
    return;
  }
  if (item.kind === 'local') { popSurface(); selectPlace(item.place.id, { fly: true }); return; }
  if (item.kind === 'city') { popSurface(); composeForCity(item.label, item.places); return; }
  if (item.kind === 'corrplace') { popSurface(); openForeignPlate(item.c.id, item.p.id); return; }
  if (item.kind === 'remote') { popSurface(); proposePlace(item.r); return; }
  if (item.kind === 'verb') { popSurface(); item.run(); return; }
  if (item.kind === 'coords') { popSurface(); proposeAdd(item.lat, item.lng); return; }
  if (item.kind === 'link') {
    popSurface();
    // what this app can do with a closed link is hand it to the thing that can
    // open it. the place comes back from there, by share or by hand.
    if (item.opaque) window.open(item.url, '_blank', 'noopener');
    else receiveShared({ url: item.url });
    return;
  }
  if (item.kind === 'tag') {
    const id = item.tag.id;
    state.filters.tags.has(id) ? state.filters.tags.delete(id) : state.filters.tags.add(id);
    renderChips(); renderList(); syncMarkers(); applyWorldState();
    renderPaletteResults(palette.input.value.trim());
    return;
  }
  // the palette holds the record and not just the name, so this row stands on
  // the person it named rather than on the top of the shelf
  if (item.kind === 'voice') { popSurface(); openSurface('contactsOverlay', renderContacts); standOnVoice(item.c.id); return; }
  if (item.kind === 'world') { runWorldSearch(item.q); return; }
}

// the world answers only when asked: one request per explicit press,
// never as-you-type (the nominatim policy forbids autocomplete)
async function runWorldSearch(q) {
  if (!q || q.length < 2) return;
  palette.remoteAbort?.abort();
  palette.remoteAbort = new AbortController();
  // your own matches stay on screen while the world is asked
  {
    const locals = localMatches(q);
    const voices = corrMatches(q);
    const stand = [];
    paint([...locals, ...cityMatches(q).slice(0, CITY_ROWS_TYPED), ...voices, ...stand], 'asking openstreetmap…', { sections: true });
  }
  try {
    const results = await searchGeo(q, { signal: palette.remoteAbort.signal });
    if (palette.input.value.trim() !== q) return;
    const locals = localMatches(q);
    const voices = corrMatches(q);
    const keys = new Set(locals
      .filter(l => l.item?.kind === 'place')
      .map(l => `${l.item.record.lat.toFixed(4)},${l.item.record.lng.toFixed(4)}`));
    const remote = results
      .filter(r => !keys.has(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`))
      .map(r => ({ kind: 'remote', r }));
    const stand = [];
    // The first answer stays nearest the input.
    const held = cityMatches(q);
    const cities = held.slice(0, CITY_ROWS_TYPED);
    paint([...locals, ...cities, ...voices, ...stand, ...remote],
      (!locals.length && !cities.length && !voices.length && !remote.length)
        ? `nothing answers “${esc(q)}”`
        : moreCities(held, cities), { sections: true });
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.warn('search failed', e);
    // never leave the palette holding an empty promise: give the rows back
    if (palette.input.value.trim() !== q) return;
    const locals = localMatches(q);
    const voices = corrMatches(q);
    paint([...locals, ...cityMatches(q).slice(0, CITY_ROWS_TYPED), ...voices, { kind: 'world', q }],
      'openstreetmap did not answer. try again', { sections: true });
  }
}

function renderPaletteResults(q) {
  const r = route(q);
  if (r.kind === 'verb') {
    const canonical = VERB_ALIASES[r.rest];
    const items = canonical
      ? [{
          kind: 'verb',
          verb: canonical,
          // Keep the canonical label while preserving any specialised legacy
          // behaviour (for example, >letters explains how People works).
          run: (VERBS[r.rest] || VERBS[canonical]).run,
          hint: VERBS[canonical].hint,
        }]
      : VISIBLE_VERBS
          .filter(verb => verb.startsWith(r.rest))
          .map(verb => ({ kind: 'verb', verb, run: VERBS[verb].run, hint: VERBS[verb].hint }));
    // a refusal that only refuses leaves a person holding a wrong word and an
    // empty field. the bare > is one backspace away and nothing said so.
    return paint(items, items.length ? '' : 'no such verb. > alone shows every word this bar knows');
  }
  if (r.kind === 'tag') {
    const items = allTags()
      .filter(t => t.name.toLowerCase().includes(r.rest))
      .map(t => ({ kind: 'tag', tag: t, n: allPlaces().filter(p => p.tags.includes(t.id)).length }));
    return paint(items, items.length ? '' : 'no such tag');
  }
  if (r.kind === 'voice') {
    const items = store.correspondents
      .filter(c => c.name.toLowerCase().includes(r.rest))
      .map(c => ({ kind: 'voice', c }));
    return paint(items, items.length ? '' : store.correspondents.length ? 'no such person' : 'no people yet. >share to begin the exchange');
  }
  if (r.kind === 'coords') return paint([{ kind: 'coords', lat: r.lat, lng: r.lng }]);
  if (r.kind === 'link') {
    let host = 'that address';
    try { host = new URL(r.rest).hostname.replace(/^www\./, ''); } catch { /* it will still be read */ }
    // read before the press rather than after it: this parser asks no network,
    // so a link with no place in it can say so while the person is still
    // looking at the row, instead of spending their press to find out.
    const opaque = !!readShared({ url: r.rest })?.opaque;
    return paint([{ kind: 'link', url: r.rest, host, opaque }]);
  }
  // ---------- an empty bar offers your cities ----------
  //
  // It used to offer the six places saved earliest, unranked. For any atlas
  // older than a week those are the least likely six things anybody is looking
  // for, and they sat between a new person and the two lines that teach them
  // what this bar is. A city is the unit the whole atlas is organised by, and
  // one press hands over a folio already titled and already full.
  //
  // The teaching line about keeping stays. Finding and keeping are the two
  // halves of what the bar is for, and one of them cannot be shown as a row.
  //
  // And when no place in the atlas has a city, the same bar offers the places
  // themselves. A surface whose one answer is a city has nothing true to say
  // to a person whose places have no city, and every place captured with no
  // signal is one of those.
  if (!r.rest) {
    const cities = cityMatches('');
    paint(cities.length ? cities : heldRecently(6), '', { chosen: -1 });
    // The two gestures that need no typing stand as words, not as prose. The
    // photograph door existed for a whole release and was reachable only by
    // typing >photo, which on the phone that holds the photographs is a door
    // with no handle. The map gesture stays a sentence, because its handle is
    // the map itself.
    palette.results.insertAdjacentHTML('afterbegin',
      `<div class="cmd-teach">Search your atlas or add something.</div>
       <div class="cmd-kinds" role="group" aria-label="Keep a place, path, or book">
         <button class="cmd-kind" id="capPlace" aria-label="Place"><b>Place</b><span>search, locate, photograph, or mark</span></button>
         <button class="cmd-kind" id="capPath" aria-label="Path"><b>Path</b><span>import a GPX track</span></button>
         <button class="cmd-kind" id="capBook" aria-label="Book"><b>Book</b><span>keep a title to return to</span></button>
       </div>
       <div class="cmd-capture word-row">
         <button class="word-btn quiet" id="capHere">use my location</button>
         <button class="word-btn quiet" id="capPhoto">choose a photo</button>
       </div>
       <div class="cmd-hint">Press and hold the map to add anywhere.</div>`);
    // paint() counted only result rows before these first-use actions existed,
    // so an empty atlas announced “No results” while offering five clear ways
    // forward. Name the useful state that is actually on the screen.
    if (!palette.results.querySelector('.cmd-row')) {
      $('#paletteStatus').textContent = 'Choose Place, Path, Book, use my location, or choose a photo.';
    }
    $('#capPlace').addEventListener('click', () => {
      palette.input.placeholder = 'Find a place…';
      palette.input.focus();
    });
    $('#capPath').addEventListener('click', () => { popSurface(); $('#gpxFile').click(); });
    $('#capBook').addEventListener('click', () => { popSurface(); addBookByHand(); });
    $('#capHere').addEventListener('click', () => { popSurface(); standHere(); });
    $('#capPhoto').addEventListener('click', () => { popSurface(); $('#shootFile').click(); });
    return;
  }
  paintTyped(r.rest);
  askQuietly(r.rest);
}

// What a typed word answers with, written once, because three painters now
// draw it: the keystroke itself, the suggestions that arrive a moment later,
// and the deliberate world search.
function paintTyped(q, suggested = []) {
  const locals = localMatches(q);
  const voices = corrMatches(q);
  // a city you hold stands above your own matching places, so that enter still
  // flies to a place exactly as it did before this existed
  const heldCities = cityMatches(q);
  const cities = heldCities.slice(0, CITY_ROWS_TYPED);
  // What the world offers is never a place you already keep, and the test for
  // that is the app's own: within forty metres, or within a hundred and fifty
  // with a name in the same family. It reads the whole atlas rather than the
  // rows the typed word matched, because the useful case is exactly the one
  // where they differ: the world knows Cervejaria Ramiro, you filed it under
  // "the prawn place", and typing three letters of the real name should find
  // what you have rather than offer to keep it twice. Where that happens your
  // own record comes up in place of the suggestion, which is the answer to the
  // question actually being asked.
  const held = (x) => store.places.find(mp => {
    if (haversineKm(mp, x) > 0.15) return false;
    const a = mp.name.toLowerCase(), b = String(x.name || '').toLowerCase();
    return a.includes(b) || b.includes(a) || haversineKm(mp, x) < 0.04;
  });
  const shown = new Set(locals.map(l => l.item.record.id));
  const remote = [];
  const alsoMine = [];
  for (const x of suggested) {
    const mine = held(x);
    if (!mine) { remote.push({ kind: 'remote', r: x }); continue; }
    if (!shown.has(mine.id)) {
      shown.add(mine.id);
      const item = searchLibrary({ places: [mine], tags: allTags() }, '', { limit: 1 })[0];
      if (item) alsoMine.push({ kind: 'library', item });
    }
  }
  const world = q.length >= 2 ? [{ kind: 'world', q }] : [];
  // an empty answer is an answer: say it, rather than leaving a silence. and
  // so is an answer that was cut: three cities is the offer, and when a fourth
  // one matched, the line under the rows says so.
  const hint = (!locals.length && !alsoMine.length && !cities.length && !voices.length && !remote.length && q.length >= 2)
    ? `nothing of yours answers “${esc(q)}” yet`
    : moreCities(heldCities, cities);
  // the highlight is a place a person put their hand, and a suggestion landing
  // a moment later must not move it out from under them: enter acts on what is
  // visibly highlighted, and every row that was already on the page keeps its
  // index because the new ones are appended after them.
  const hl = palette.hl;
  paint([...locals, ...alsoMine, ...cities, ...voices, ...remote, ...world], hint, { sections: true });
  if (hl > 0 && hl < palette.rows.length) {
    palette.hl = hl;
    $$('.cmd-row', palette.results).forEach((el, i) => el.classList.toggle('hl', i === hl));
    syncPaletteActive();
  }
}

// ---------- the world answers while you are still typing ----------
//
// Finding a place used to be: type the whole name, press a row that says ask
// openstreetmap, wait. Two deliberate acts for the one thing this app is for.
// Photon answers a prefix, so the rows arrive as the word does, and the
// deliberate search stays underneath for what a prefix cannot match.
//
// Quiet in three senses. It waits for a pause in the typing rather than firing
// per keystroke; it abandons the answer to a word that is no longer on screen;
// and when it fails it says nothing at all, because a person typing a place
// they already know how to spell should not be told that a server in Germany
// is unwell. The rows they own are on the page either way.
const SUGGEST_AFTER_MS = 240;
const SUGGEST_MIN = 3;

function askQuietly(q) {
  clearTimeout(palette.suggestTimer);
  palette.suggestAbort?.abort();
  palette.suggestAbort = null;
  if (q.length < SUGGEST_MIN) return;
  palette.suggestTimer = setTimeout(async () => {
    const ac = new AbortController();
    palette.suggestAbort = ac;
    try {
      // Where the field is looking, but only when it is looking at somewhere.
      // A world view has no opinion about which Springfield you mean, and
      // sending its centre as a preference is inventing one: at that zoom the
      // point is an artefact of how the map happened to fit, and it pulled a
      // search for a Portuguese word to the middle of the Atlantic and
      // answered with Brazil.
      const near = mapView.getZoom() >= 6 ? mapView.getCenter() : null;
      const rows = await suggestGeo(q, { signal: ac.signal, at: near });
      // the word may have moved on, or the bar may have been put away
      if (!rows.length || palette.input.value.trim() !== q || $('#paletteOverlay').hidden) return;
      paintTyped(q, rows);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('suggest failed', e);
    }
  }, SUGGEST_AFTER_MS);
}


// Did this visit begin with something in hand? A link someone sent, a place
// shared in from a phone, or the walk back from the club door. All of those
// are arrivals with something in hand, and an arrival holding something is not
// the moment for a welcome.
function arrivedHolding() {
  if (location.hash.startsWith('#m=')) return true;
  const q = new URLSearchParams(location.search);
  return q.has('shared') || q.has('title') || q.has('text') || q.has('url') || q.has('club');
}

// ---------- the name walks to its corner ----------
//
// It used to get there by transitioning left, top, font-size and letter
// spacing at once. Every one of those makes the browser lay the page out
// again, and two of them make it re-shape a variable typeface, sixty times a
// second, over a live map, under four text shadows. It arrived. It did not
// glide.
//
// So it is measured instead: where the word is now, where it belongs, and
// the difference played back as one transform, which is the only thing a
// compositor can carry by itself. The origin is set to the word's own centre
// so the scale happens about the letters rather than about the button's box,
// and the scale is taken from the word's width, because the tracking is tight
// when the name is large and open when it is small: the two states are not a
// pure scale of one another, and width is what the eye follows.
// A word crossing the whole field wants to be followed, not flung. The house
// easing is a hard ease-out, which is right for a panel arriving from just
// off screen and wrong here: it put the name eighty five percent of the way
// home in the first third, so the eye caught a blur and then a long settle.
// This leaves gently, spends the middle of the journey actually in the
// middle, and comes to rest without a bump.
const NAME_WALK_MS = 1400;
const NAME_WALK_EASE = 'cubic-bezier(0.5, 0, 0.15, 1)';

function walkNameHome() {
  const el = $('#fmIndex');
  const word = $('.fm-word', el);
  const hint = $('#fmHint');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the hint belongs to the middle of the field and does not travel
  if (hint) hint.hidden = true;
  const from = word?.getBoundingClientRect();

  document.body.classList.remove('hero');

  if (still || !from || !word || !el.animate) return;
  const to = word.getBoundingClientRect();
  const scale = from.width / to.width;
  if (!Number.isFinite(scale) || scale <= 0) return;

  const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
  const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
  const box = el.getBoundingClientRect();
  el.style.transformOrigin =
    `${to.left + to.width / 2 - box.left}px ${to.top + to.height / 2 - box.top}px`;

  const walk = el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
    { transform: 'translate(0, 0) scale(1)' },
  ], {
    duration: NAME_WALK_MS,
    easing: NAME_WALK_EASE,
  });
  walk.finished.catch(() => {}).then(() => { el.style.transformOrigin = ''; });
}

// ---------- the first evening ----------
//
// It was a film. A hundred and fifty kilobytes of a long table at dusk,
// fetched on a first visit and dissolved into the map.
//
// What it cost was never mainly the bytes. A video is a negotiation: a codec
// the engine may not carry, a seek a server without range requests will
// refuse, a play() an autoplay policy may decline, a `loadeddata` event that
// promises one frame and not a film, and a duration the browser works out when
// it gets round to it. Six listeners, two timeouts, a drawn scene to stand in
// when the film failed, and a way back to that scene when the film arrived and
// then sat still, all stood here to hold that negotiation together. Every one
// of them was written against a defect that had actually happened. Three of
// the four tests over it could only make their claim on some engines, and one
// of those was skipped on two engines of three, every night, saying so in its
// own message.
//
// And a table at dusk was never what this app does. It marks places and draws
// the ways between them. So the evening is ways now, at the size of a screen:
// they arrive out of the dark, come to rest, and leave a mark where they stop.
// It is the gesture the map already makes whenever a path is chosen, which is
// a 4000-unit dash drawn over 1400ms by `way-draw` in the stylesheet.
//
// Nothing is fetched, so nothing can fail to arrive. There is no last frame,
// so the fade cannot outlast the picture. And every engine, on every visit,
// sees the identical evening, which has not been true before.

const DISSOLVE_S = 1.4;   // matches #intro.dissolve in the stylesheet

// The score, in seconds. Choreography rather than tempo, in exactly the sense
// test/style.test.mjs draws that line: each number is measured against the one
// before it and against the dissolve, not against the app's scale, so it is
// written here beside the thing it times.
const WAY_S   = 0.95;     // one way, from off the edge to rest
const WAY_GAP = 0.16;     // between two ways setting out
const MARK_S  = 0.40;     // the ring landing where a way stopped
const REST_S  = 0.35;     // the last mark before the field arrives
// The breath a landed mark takes, which is the 2600ms `breathe` a proposed
// mark takes on the map, in the app's own hand. It is not decoration. The
// whole argument against the film was that it ran out under its own dissolve
// and stood there as a still picture at falling opacity, and a scene whose
// last gesture finishes before the fade opens would have done exactly the same
// thing by a different route. The marks are still breathing when the field
// arrives, so there is nothing still to fade.
const BREATH_S = 2.6;
// A returning visitor gets the same evening at a little over a third of its
// length. That is what `brief` has always meant, and it now means it for the
// whole evening rather than for the fade alone: 0.8 seconds and a 0.6 second
// dissolve, which is within a tenth of what the film ran to after it was cut.
const BRIEF = 0.38;

// Two evenings, because there are two fields.
//
// The opening was one fixed dark picture for everybody, a violet black close
// to the night field's own colour. That was wrong twice. A person who keeps
// this app in day was shown a full screen of night and then dropped onto
// paper, which is a swing of about eighty points of lightness under a fade
// meant to be a handover. And the violet was doing nothing for the drawing:
// six warm bone hairlines on a low saturation purple is the one pairing where
// both colours go grey.
//
// So the evening reads the theme the app has already resolved, and there are
// two of them. Neither is a hue: the dark one is a warm near black lit from
// the middle, the light one is the same drawing in ink on the same paper the
// day field is made of. The ground is a pool of light rather than a ramp from
// edge to edge, because a linear gradient across a whole screen always reads
// as a gradient, and this has to read as air.
//
// `pool` and `ink` are bare channel triples, because both are used at several
// alphas and a hex would have to be taken apart again at every one of them.
// The two evenings were a table of eight numbers here. They are a function
// now, in js/evening.js, because the picture stopped being two pictures: the
// theme still decides paper or ink and nothing else does, and within that the
// light is the light of the hour and the season the device is standing in.
//
// The numbers that used to be written above are still in there, near enough:
// the function passes through them on a spring afternoon, which is when they
// were chosen by eye. What they cannot do any more is be the only answer.
//
// It is a module rather than more of this file because it is arithmetic with a
// whole year of inputs, and node can walk a year. A picture does not fail; it
// renders something plausible enough that nobody looks.

// Six ways, in a unit box, so they hold their shape at any size and any
// aspect. Written down rather than generated, because a composition is a
// composition.
//
// The six marks stand around the name in a clearing the roads themselves
// make: three above the word, three below, none level with another. The word
// spans the middle of the frame at every size the clamp allows, so the band
// it occupies is left empty on purpose and nothing enters it, checked against
// the widest case rather than the desktop one. The widest case is still a
// phone: a road that clears the word at 1280 can cross it at 390.
//
// Recomposed on 19 Aug 2026, and the reason is the type. The name used to be
// set at a hundred and thirty two points, which took a band 0.29 of the frame
// tall out of the middle and pushed all six ways to the top and bottom edges,
// leaving the whole left of the picture empty and the word floating in it.
// The name is a plate now rather than a billboard, its band is 0.17 tall, and
// the ways have come back in to stand around it. Measured across six
// viewports the word occupies x 0.218 to 0.813 and y 0.455 to 0.593; the band
// below carries air on every side of that.
//
// One crossing, low and left, where the way climbing out of the bottom corner
// meets the way running in along it. Roads cross; what a composition cannot
// have is the state in between, a graze, where two curves meet at a few
// degrees and run together for a third of the frame. Every pair here either
// crosses cleanly or stays a good distance apart, and no mark lands on
// another way's road.
//
// `near` is the only thing here that is not geometry. Six ways at one weight
// read as a diagram; two of them a third heavier read as distance, which is
// what a map of somewhere is a picture of.
const WAYS = [
  { p: [[-0.30, 0.92], [-0.04, 0.80], [0.10, 0.52], [0.185, 0.395]], near: true },
  { p: [[ 0.16,-0.28], [ 0.26, 0.06], [0.40, 0.10], [0.520, 0.205]] },
  { p: [[ 1.32, 0.10], [ 1.04, 0.14], [0.94, 0.24], [0.845, 0.330]] },
  { p: [[-0.34, 0.50], [-0.02, 0.72], [0.16, 0.82], [0.300, 0.700]] },
  { p: [[ 0.36, 1.28], [ 0.46, 1.00], [0.56, 0.94], [0.660, 0.845]], near: true },
  { p: [[ 1.30, 0.94], [ 1.06, 0.92], [0.98, 0.72], [0.905, 0.635]] },
];

// Six marks breathing at six phases are six things happening at once. The app
// is called Resonate, and resonance is the one word on this screen that means
// something exact: bodies that start apart and end together, each one then
// carrying the others further than it could carry itself.
//
// So the phases are not a scattering to be admired. They are a state the
// scene leaves. From the moment the last way sets out, every mark that has
// landed is drawn toward one common phase, and the pull finishes exactly as
// the field arrives: six separate breaths at the start of the evening, one
// breath at the end of it, and a deeper one than any of them took alone.
//
// It costs the evening nothing. The gathering happens underneath the last two
// arrivals rather than after them, so every number in the score above still
// means what it meant and the scene is the length it always was.
const TIE_AT = WAY_GAP * (WAYS.length - 1);
const TIE_S = WAY_S + MARK_S + REST_S;
const PHASE = 0.37;   // the phase between two marks, before they are tied

// How long the whole thing stands before the dissolve opens over it.
const sceneSeconds = brief =>
  (WAY_GAP * (WAYS.length - 1) + WAY_S + MARK_S + REST_S) * (brief ? BRIEF : 1);

// a point on a cubic, in unit space
function onWay(P, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0],
    a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1],
  ];
}

// The shape of --e-enter, which is cubic-bezier(0.19, 1, 0.22, 1): away fast,
// and a long settle. Written as a power rather than solved as a bezier, since
// one curve does not earn a solver and at the fifth it is within a percent of
// it across the whole range.
const enter = t => 1 - Math.pow(1 - t, 5);
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

function runIntro(onDone, { brief = false, skip = false } = {}) {
  const el = $('#intro');
  const canvas = $('#introCanvas');
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A request for less movement is final. `skip` also lets the boot choose the
  // useful surface immediately when a small or touch-first glass would turn a
  // full-screen brand moment into startup latency.
  if (skip || RM) {
    // nothing to undo: the canvas is never sized and no frame is ever asked
    // for, so an evening nobody wanted costs them nothing at all
    store.settings.introSeen = true; store.saveSettings(); onDone(); return;
  }
  el.classList.toggle('brief', brief);
  // the stylesheet needs it too: the name, the rule under it, the skip word
  // and the grain are all the wrong colour in the other evening
  // not `P`: that is the name a cubic goes by in every function below it
  const EV = evening(resolvedTheme(), new Date(), deviceZone());
  el.dataset.evening = resolvedTheme();
  // the stylesheet draws the name, the rule under it and the skip word, and
  // all three are the same ink the ways are drawn in. Handed over as a channel
  // triple so the stylesheet can take it at several alphas without having to
  // take a hex apart at each one.
  el.style.setProperty('--ev-ink', EV.ink);
  el.style.background = EV.base;
  el.hidden = false;

  // The name waits for the face it is set in.
  //
  // Bricolage is vendored and declared `font-display: swap`, which is right for
  // a page of prose and wrong for one word at a hundred and thirty two points:
  // measured, RESONATE is 661px in Bricolage and 713px in the fallback, so a
  // face arriving mid-evening resizes the title by eight percent and drags the
  // rule under it out with it. The rule is drawn left to right over 1200ms and
  // would be drawing while the thing it underlines changed width.
  //
  // So the mark is held until the face is here, and shown anyway if it is not
  // here soon. A title that never arrives is worse than one that swaps, and
  // 400ms is the whole budget: the animation's own delay is 300ms, so on every
  // load where the font is already in the cache nothing waits for anything.
  const FACE = '600 132px "Bricolage Grotesque"';
  const lettered = () => el.classList.add('lettered');
  let letterCap = 0;
  if (document.fonts?.check(FACE)) lettered();
  else {
    // both optional, and the second one is not decoration: `document.fonts`
    // absent means `load` returns undefined, and a `.then` on that throws
    // where it stands and takes the whole evening down with it. The word
    // arriving in the wrong face is the thing being avoided here. It is not
    // worth a black screen.
    document.fonts?.load(FACE)?.then(lettered, lettered);
    letterCap = setTimeout(lettered, 400);
  }

  const tempo = brief ? BRIEF : 1;
  const fadeS = brief ? 0.6 : DISSOLVE_S;
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let cutoff = 0;
  let finished = false;

  // A canvas is a bitmap, and this one was sized in CSS pixels on screens that
  // draw two or three device pixels for each, so the whole evening was
  // upscaled. Capped at two: the third device pixel costs half again the fill
  // rate and cannot be seen.
  const dpr = Math.min(2, devicePixelRatio || 1);
  let w = 0, h = 0;
  const fit = () => {
    w = innerWidth; h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  // Not `{ once: true }`, which is what stood here. A phone collapsing its
  // address bar fires this on the way in, and after that one the canvas held
  // the wrong size for the rest of the evening.
  addEventListener('resize', fit);

  // The ground: one flat field and a pool of light standing in the middle of
  // it, a little above centre, where the clearing the ways leave is. A ramp
  // from the top edge to the bottom one reads as a gradient however many stops
  // it is given; light falling in a room reads as air, and the difference is
  // that light has a source somewhere inside the frame.
  function ground() {
    ctx.fillStyle = EV.base;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(
      w * EV.at[0], h * EV.at[1], 0,
      w * EV.at[0], h * EV.at[1], Math.max(w, h) * EV.reach);
    g.addColorStop(0, `rgba(${EV.pool}, ${EV.lift})`);
    g.addColorStop(1, `rgba(${EV.pool}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // One way, drawn to `p` of its length, with `head` falling from one to zero
  // as it comes to rest. Two strokes over the same points: the road it leaves
  // behind, and the head of it, which is brighter and heavier and is what the
  // eye actually follows. The head has to go out, or a way that has arrived
  // keeps a bright dash sitting in it for the rest of the evening, which reads
  // as a fragment rather than as a road.
  //
  // The head used to be a soft disc a twentieth of the frame across, laid over
  // a road one pixel wide. On a 1280 screen that is a 44 pixel smudge trailing
  // a hairline, and the eye follows the largest softest thing in a picture, so
  // the least made part of the evening was the part everybody watched. The
  // light is in the line now: the last stretch of the road is stroked with a
  // gradient that comes up out of nothing to the head, and what is left of the
  // glow is a bead a fifth of the old size at nearly twice the brightness. A
  // thing travelling fast in the dark has a wake, not a halo.
  function way(P, p, head, near) {
    if (p <= 0) return;
    const n = Math.max(2, Math.round(96 * p));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const [x, y] = onWay(P, (i / n) * p);
      pts.push([x * w, y * h]);
    }
    // A road at a fifth of full is a road nobody sees once the head has gone
    // out, and the whole of the last second of the evening is roads with no
    // heads on them. Raised until the picture holds at rest, which is where
    // it is looked at longest.
    const road = near ? 0.38 : 0.26;
    const line = (from, width, alpha) => {
      ctx.beginPath();
      ctx.moveTo(pts[from][0], pts[from][1]);
      for (let i = from + 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.lineWidth = width;
      ctx.strokeStyle = `rgba(${EV.ink}, ${alpha})`;
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    line(0, near ? 1.5 : 1.1, road);
    if (head > 0) {
      const from = Math.max(0, pts.length - 26);
      const [ax, ay] = pts[from];
      const [hx, hy] = pts[pts.length - 1];
      const wake = ctx.createLinearGradient(ax, ay, hx, hy);
      wake.addColorStop(0, `rgba(${EV.ink}, 0)`);
      wake.addColorStop(1, `rgba(${EV.ink}, ${0.62 * head})`);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      for (let i = from + 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.lineWidth = (near ? 1.5 : 1.1) + 1.0 * head;
      ctx.strokeStyle = wake;
      ctx.stroke();
      const r = Math.min(w, h) * 0.012;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
      g.addColorStop(0, `rgba(${EV.ink}, ${0.55 * head})`);
      g.addColorStop(1, `rgba(${EV.ink}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, 6.2832);
      ctx.fill();
    }
  }

  // The mark left where a way stopped: the ring opens outward, settles, and
  // then breathes, which is the shape a proposed mark makes on the map.
  //
  // `phase` arrives already tied: the draw loop hands each mark its own phase
  // at the start of the evening and closes the six of them onto one by the end
  // of it. `tie` is how far along that is, and it does one more thing here.
  // Things breathing together carry further than things breathing apart, so
  // the swing widens as the phases close rather than staying where it was.
  // That is the difference between six marks that happen to agree and six
  // marks that are resonating, and it is the whole reason the word is on the
  // screen above them.
  function mark(P, p, t, phase, tie) {
    if (p <= 0) return;
    const [x, y] = onWay(P, 1);
    const R = Math.max(7, Math.min(w, h) * 0.016);
    const e = enter(p);
    const b = p >= 1 ? 0.5 + 0.5 * Math.sin((t / BREATH_S + phase) * 6.2832) : 0;
    ctx.beginPath();
    ctx.arc(x * w, y * h, R * (0.35 + 0.65 * e) * (1 + (0.07 + 0.05 * tie) * b), 0, 6.2832);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = `rgba(${EV.ink}, ${0.72 * p * (0.74 + (0.26 + 0.12 * tie) * b)})`;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x * w, y * h, 2.1, 0, 6.2832);
    ctx.fillStyle = `rgba(${EV.ink}, ${0.85 * p})`;
    ctx.fill();
  }

  // the frame closes down toward its corners, so the ways arrive out of
  // somewhere rather than off an edge
  function vignette() {
    const g = ctx.createRadialGradient(
      w / 2, h * 0.55, Math.min(w, h) * 0.30,
      w / 2, h * 0.55, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, EV.out);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const t0 = performance.now();
  const draw = (now) => {
    const t = (now - t0) / 1000 / tempo;
    ground();
    // one number for the whole field: how far the six phases have closed.
    // A mark's phase is its own at the start and everyone's at the end, and
    // because it moves continuously the breath never jumps, it only gathers.
    const tie = enter(clamp01((t - TIE_AT) / TIE_S));
    for (let i = 0; i < WAYS.length; i++) {
      const { p: P, near } = WAYS[i];
      const s = t - i * WAY_GAP;
      // the head goes out a little faster than the mark comes in, so the road
      // is quiet by the time the ring is fully open on the end of it
      way(P, enter(clamp01(s / WAY_S)), 1 - clamp01((s - WAY_S) / (MARK_S * 0.7)), near);
      mark(P, clamp01((s - WAY_S) / MARK_S), t, i * PHASE * (1 - tie), tie);
    }
    vignette();
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  const finish = (remember = true) => {
    if (finished) return;
    finished = true;
    if (finishFirstRunIntro === finishForReview) finishFirstRunIntro = null;
    // whatever ended the evening, its listeners go with it: a capturing key
    // handler left behind would swallow the next Enter in the whole app
    cleanupIntro();
    if (remember) {
      store.settings.introSeen = true;
      store.saveSettings();
    }
    document.body.classList.add('entering');
    el.style.setProperty('--intro-fade', `${fadeS}s`);
    // The room is built before the fade opens over it, rather than one
    // statement after. A room that renders under an opaque overlay cannot be
    // caught half drawn; a room that renders under a fade that has already
    // started can, and the threshold is four doors and six paragraphs of type
    // arriving at once. It is one statement either way.
    onDone();
    el.classList.add('dissolve');
    // The scene keeps drawing for the whole of the fade, and that is the point
    // rather than an oversight. What the film could not do, at any length it
    // was ever cut to, was end underneath its own dissolve without standing
    // there as a still picture at falling opacity. A drawn scene has no last
    // frame to run out of, so the fade opens over something that is still
    // moving every time.
    setTimeout(() => {
      cancelAnimationFrame(raf);
      el.hidden = true;
      el.style.removeProperty('--intro-fade');
      document.body.classList.remove('entering');
    }, fadeS * 1000);
  };
  const finishForReview = () => finish(false);
  finishFirstRunIntro = finishForReview;

  // Enter, Escape and Space belong to the evening while it is running, and are
  // handed back the moment it is not
  function onIntroKey(e) {
    if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== ' ') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    finish();
  }
  function cleanupIntro() {
    document.removeEventListener('keydown', onIntroKey, true);
    removeEventListener('resize', fit);
    clearTimeout(cutoff);
    clearTimeout(letterCap);
  }

  // The evening is as long as it is. There is no film to measure any more, and
  // so no armCutoff, no remainingFilm, and no six second fallback for a file
  // that never arrived: the one number here is the score above.
  cutoff = setTimeout(finish, sceneSeconds(brief) * 1000);

  el.addEventListener('click', finish);
  $('#introSkip')?.addEventListener('click', (e) => { e.stopPropagation(); finish(); });
  document.addEventListener('keydown', onIntroKey, true);
}

// ---------- init ----------

async function init() {
  setWriteFailedHandler(() => {
    // callers give their own, more specific sentence; this net catches the rest
    setTimeout(() => {
      if (Date.now() - lastToastAt > 450) {
        toast('this browser refused to save. export your atlas before you lose it', 6000);
      }
    }, 80);
  });
  // Before the records are read, and therefore before anything can be written
  // back over them.
  //
  // A device from before may be holding photographs inline in the records
  // themselves, and this build's places carry no photos field at all, so the
  // first write of that key destroys them. The first write is not an edit the
  // person makes: it is the healing write inside store.load(), two lines below,
  // which gives an undated record a date. That is why this is awaited here
  // rather than left to the durable work at the end of init, where the notice
  // and the snapshot live. By then it would be reading pictures that had
  // already gone.
  //
  // On a device that never kept one this is a single string scan and returns
  // without opening a database or writing anything, so the await costs a
  // microtask and nothing else.
  //
  // Nothing in here throws, and it is caught anyway. This is the first line of
  // the app: an atlas that will not open because one picture was damaged is a
  // far worse day than a picture that could not be moved, and a lift that
  // failed has changed nothing, so there is nothing to report and everything
  // to go on with.
  const eraseRecovered = await recoverInterruptedErase();
  try { await photoStore.liftInlinePictures(); }
  catch { /* the pictures are exactly where they were */ }
  store.load();
  if (!eraseRecovered) {
    setTimeout(() => toast('an interrupted erase is still waiting for this browser. close other Resonate tabs and reload', 9000), 500);
  }
  // If a stored key would not parse, the store has sealed it rather than
  // handing back an empty list, and nothing will be written over it until a
  // person says so. This is the loudest thing the app can say, and it is said
  // before anything else happens, because the alternative is an atlas that
  // looks empty and becomes empty on the next keystroke.
  const damaged = unreadableKeys();
  if (damaged.length) setTimeout(() => tellAboutDamage(damaged), 400);
  applyWorldState();
  renderFieldWord();

  // the durable work happens after the field is standing, never in its way
  setTimeout(async () => {
    // A device from before is still holding photographs and is owed the offer.
    // Raised and never awaited, for two reasons: the question waits for the
    // evening and then for an answer that may not come until tonight, and
    // the snapshot below is not the person's to be kept waiting for.
    if (!alreadyTold()) {
      photoStore.photographCount().then(n => { if (n) offerTheFarewell(n); });
    }
    // null is a database that would not open; [] is one holding nothing. Both
    // mean a snapshot is worth attempting, and for opposite reasons, so the
    // two are kept apart rather than folded into each other by `|| []`. The
    // refusal may be this visit's only one, and open() no longer remembers a
    // refusal, so asking again is a real second chance. Whether it worked is
    // said under `kept where`, which is where a person goes to find out.
    const keys = await photoStore.snapshotKeys();
    const newest = keys === null ? null : keys.sort().pop();
    const stale = !newest || (Date.now() - Date.parse(newest)) > 24 * 3600 * 1000;
    if (stale && store.places.length) {
      const put = await photoStore.snapshotPut(store.recordsJSON());
      if (put !== null) await photoStore.snapshotPrune(3);
    }
  }, 2500);

  // something was shared into the app. the worker kept it here rather than
  // putting it on the wire, so it is read out of this device's own store.
  const q = new URLSearchParams(location.search);
  const shareFailed = q.get('shared') === '0';
  if (q.has('shared') || q.has('title') || q.has('text') || q.has('url')) {
    // an older install may still arrive by query: honour it, then wipe it
    const fromQuery = (q.has('title') || q.has('text') || q.has('url'))
      ? { title: q.get('title') || '', text: q.get('text') || '', url: q.get('url') || '' }
      : null;
    history.replaceState(null, '', location.pathname + location.hash);
    // the worker says plainly when it could not keep what was shared. a
    // person who shared a place is owed that, rather than an app that opens
    // as though nothing had happened.
    if (shareFailed) {
      setTimeout(() => toast('this device could not keep the share. nothing was sent; try again or add it manually', 7000), 900);
    }
    setTimeout(async () => {
      const waiting = await peekShared();
      const first = waiting[0];
      // Parse and present before deleting the durable inbox record. In
      // particular, a malformed percent escape in a Google place path used to
      // throw only after the record had already been forgotten.
      if (first) {
        const found = inspectShared(first.item);
        if (found) {
          await receiveShared(first.item, found);
          await forgetShared(first.key);
        } else {
          toast('that share could not be read, so it was left in the inbox', 7000);
        }
      }
      else if (fromQuery) receiveShared(fromQuery);
      for (const rest of waiting.slice(1)) {
        if (!inspectShared(rest.item)) continue;
        if (inboxWrite([...inboxRead(), rest.item])) await forgetShared(rest.key);
      }
    }, 1000);
  } else {
    setTimeout(async () => {
      for (const w of await peekShared()) {
        if (!inspectShared(w.item)) continue;
        if (inboxWrite([...inboxRead(), w.item])) await forgetShared(w.key);
      }
      drainInbox();
    }, 3000);
  }

  // A member returns from the payment desk with a checkout session on the url.
  // The session becomes a key, and the url is wiped clean of it: a checkout id
  // left in a history entry is a credential lying about in a place people
  // paste from. The other two returns, a payment abandoned and a trip to the
  // billing portal, carry no session and only open the room.
  const backFromDoor = new URLSearchParams(location.search).get('club');
  const withSession = /^cs_[A-Za-z0-9_]+$/.test(backFromDoor || '');
  if (withSession && clubBase() && !store.settings.clubKey) {
    (async () => {
      try {
        const got = await clubClient().door(backFromDoor);
        store.settings.clubKey = got.key; store.saveSettings();
        openSurface('clubOverlay', renderClub);
        toast(got.again ? 'welcome back. the key was already on this side' : 'welcome. your key is kept on this device');
      } catch (e) {
        toast(`${e.message || 'the door did not answer'}. the club room, from the index, can take the session again`);
      }
      history.replaceState(null, '', location.pathname + location.hash);
    })();
  } else if (backFromDoor) {
    if (store.settings.clubKey || !withSession) openSurface('clubOverlay', renderClub);
    history.replaceState(null, '', location.pathname + location.hash);
  }

  // Marks read under an older arithmetic, sent back for the words. This is the
  // sweep half of the version gate: maySend already refuses such a pairing, so
  // nothing can leave over one either way, but a row still saying `verified`
  // over a mark the app no longer computes is a row that lies to the only
  // person who could fix it. Sent back to `returned`, which is the state that
  // says both halves are held and nobody has read this one, and the room
  // already draws that with `the mark` on it and no way to send.
  //
  // The mark goes with the state. What is stored is a cache of what markOf last
  // said, and leaving eight characters of a retired hash under the word
  // `unverified` would offer somebody a string to read that is not the string
  // their correspondent is looking at.
  //
  // Synchronous, and before the box is asked, because a letter arriving is the
  // one thing that paints this room without anybody opening it.
  for (const p of store.letters.pairs) {
    const next = onVersion(p);
    if (next !== p.state) store.updatePair(p.id, { state: next, mark: '' });
  }

  // The box, asked at the three moments a letter could have arrived without
  // this tab being told: the visit starting, the tab coming back to the front,
  // and the network returning. The fourth is a person opening the room, and it
  // lives in showContacts, where the room is. Not on a timer, because a timer
  // that polls a club every minute is a device announcing to it how long
  // somebody sat with the app open, and that is a thing the club has no
  // business learning.
  //
  // The boot call waits, for the same reason everything else at boot waits: the
  // first seconds belong to the map and to whatever the person arrived holding.
  setTimeout(() => lookInTheBox(), 4000);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lookInTheBox();
  });
  addEventListener('online', () => lookInTheBox());

  // The fix follows the screen. Going away stops the watch and keeps the last
  // answer; coming back reads its age, drops it if it has gone stale, and only
  // picks the watch up again for a fix that is still worth following.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { mapView.stopWatchingHere(); return; }
    if (!state.here) return;
    if (!hereNow()) { paintSort(); return; }
    askWhereYouAre(null, { fly: false, quiet: true });
  });

  mapView.setRouteClickHandler((id) => selectRoute(id, { fly: false }));
  mapView.initMap({
    onMarkerClick: (id) => selectPlace(id, { fly: false }),
    onCorrClick: (corrId, placeId) => openForeignPlate(corrId, placeId),
    onLongPress: (lat, lng) => proposeAdd(lat, lng),
    onPointerMove: (lat, lng) => { $('#coordsReadout .fm-dms').textContent = fmtDMS(lat, lng); },
    onViewChange: debounce((view) => {
      store.settings.lastView = view;
      store.saveSettings();
      const c = mapView.getCenter();
      $('#coordsReadout .fm-dms').textContent = fmtDMS(c.lat, c.lng);
      if (state.sort === 'distance' && !$('#indexOverlay').hidden) renderList();
    }, 300),
  });
  applyTheme();
  pushCorrespondentsToMap();

  const places = allPlaces();
  if (store.settings.lastView) mapView.setView(store.settings.lastView);
  else if (places.length) mapView.fitAll(places);

  const c0 = mapView.getCenter();
  $('#coordsReadout .fm-dms').textContent = fmtDMS(c0.lat, c0.lng);

  renderAll();

  // A remembered permission is restored only after the map and every review
  // surface are ready. A tool can be invoked the moment it is registered; it
  // must never open onto a half-built app. Registration itself remains in the
  // background so the consent, pagehide and BFCache listeners below are wired
  // while an experimental runtime is still answering. Failure is a capability
  // report in Settings, not a failed or privacy-blind boot.
  void syncAgentAccess();

  // the welcome: the hint that teaches the one gesture, and the name's pulse.
  // it starts when the field is actually revealed, never behind a cover, so
  // it is never burned invisible and marked as shown.
  const startWelcome = () => {
    // The hint lives inside the name mark, so a hint switched on while the mark
    // is mid walk is dragged across the field at title size and shrunk on the
    // way, which is the one thing walkNameHome hides it to prevent. It waits
    // for an arrival where the name is still in the middle.
    if (!store.settings.indexSeen && !store.settings.hintShown
      && document.body.classList.contains('hero')) {
      $('#fmHint').hidden = false;
      store.settings.hintShown = true;
      store.saveSettings();
      setTimeout(() => { $('#fmHint').hidden = true; }, 12000);
    }
    document.body.classList.add('greet');
    setTimeout(() => document.body.classList.remove('greet'), 5600);
  };

  // plain words, then a choice: nothing is seeded and nobody is named until
  // the visitor has said which start they want
  let thresholdWired = false;

  // The first-run door is wired before the evening, not after it.
  //
  // runIntro calls its callback synchronously when it decides not to play,
  // which it does for anyone whose device asks for less movement. The
  // callback's openThreshold() therefore used to resolve to the module level
  // no-op above, and a brand new visitor on such a device met an empty field
  // with a wordmark on it and no way in but a question mark in the corner.
  // Nothing threw. `chosen` stayed false, so it happened again every visit.
  //
  // Order is the whole fix: nothing that opens a surface may be handed to
  // something that might call it back before this function has finished.
  setThresholdOpener(function openThreshold() {
    const th = $('#threshold');
    if (thresholdWired) return raiseDialog(th, 'What Resonate is');
    thresholdWired = true;
    // What `done` does once an answer is real, written on its own because one
    // of the four doors cannot know it has an answer until its room closes.
    // The lines are said twice rather than shared: `done` marks the choice
    // before it drops this screen and greets after the caller has seeded, and
    // that order is load bearing.
    const answered = () => {
      store.settings.chosen = true;
      store.saveSettings();
      navigator.storage?.persist?.().catch?.(() => {});
      startWelcome();
    };
    const done = (fn) => {
      store.settings.chosen = true;
      store.saveSettings();
      dropDialog(th);
      // ask the browser to treat this data as worth keeping, now that it exists
      navigator.storage?.persist?.().catch?.(() => {});
      fn?.();
      startWelcome();
    };
    // What the first door does, said before it is pressed.
    //
    // Two things are true of these records and they are not the same thing, so
    // the copy names them apart.
    //
    // In your atlas: opening a full atlas is one explicit act, and it is that
    // act which puts them here. From then on they are counted when two atlases
    // are compared and they travel under the person's byline, like anything
    // else the person keeps. Nothing in them says the person has been
    // anywhere, which is the whole of what an atlas may not invent.
    //
    // In your words: a different question, answered by writing. The mark this
    // app keeps on them, `sample` in the store, is neither ownership nor
    // provenance; it means untouched-starter, and its only job is that one
    // word in your room can still send back what nobody has written in. The
    // moment a record is edited the mark clears and the bulk undo lets go of
    // it, which is not the same as every sentence in it becoming the person's
    // own: rename a place and its note is still the prose that came with it. What it can still do is put a place in somebody's atlas
    // without saying how many, from whom, or what happens to them afterwards.
    // So the door says it, in the numbers the atlas actually holds rather than
    // in numbers typed onto a page.
    const seed = demoData();
    const ways = (seed.routes || []).length;
    const shelf = (seed.books || []).length;
    $('#thFullWhat').textContent = `The example contains ${seed.places.length} real places`
      + (ways ? ` and ${ways} path${ways === 1 ? '' : 's'}` : '')
      + (shelf ? ` and ${shelf} book${shelf === 1 ? '' : 's'}` : '')
      + `, plus ${seed.correspondents?.length || 0} example people. Opening it adds nothing. Save individual recommendations, or choose “Use as my atlas.”`;
    $('#thFull').addEventListener('click', () => {
      dropDialog(th);
      previewDemo();
    });
    $('#thEmpty').addEventListener('click', () => done(() => {
      // an atlas with no tags cannot file anything: the vocabulary comes
      // even when the places do not
      if (!store.tags.length) {
        Object.values(baseTags()).forEach(t => store.addTag(t));
        renderAll();
      }
      // Starting empty is an explicit request to write the first place. Land
      // in the one field that does it, with the keyboard already asked for by
      // the press that brought the person here.
      openKeepChooser();
    }));
    // the third way in: this browser is new, but the atlas is not
    $('#thImport').addEventListener('click', () => {
      const file = $('#importFile');
      file.onchange = () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        readArchiveFile(f, async (parsed) => {
          // The word here says "this browser is new, but the atlas is not",
          // and it means a restore. A person can arrive at it holding somebody
          // else's file instead, and used to be told their friend's atlas was
          // not a resonate export. It is one, and it opens the way it would
          // have opened as a link: the threshold steps aside first, because a
          // visit belongs on the field and not under a first-run choice.
          const { kind } = classifyFile(parsed);
          if (kind !== 'private_archive' && kind !== 'unknown') {
            return done(() => openResonateFile(parsed));
          }
          const r = await bringHome(parsed, { replace: true });
          if (!r.ok) {
            if (r.why === 'lossy') return sayWhatWasLost(r.lost, { verb: 'come home' });
            if (r.why === 'unreadable') return toast('that file isn’t a resonate export');
            return toast('this device would not save it, so nothing changed');
          }
          done(() => {
            renderAll();
            if (store.places.length) mapView.fitAll(store.places);
            const counts = [
              [r.now.places, 'place'],
              [r.now.routes, 'path'],
              [r.now.books, 'book'],
            ].filter(([n]) => n);
            const total = counts.reduce((n, [amount]) => n + amount, 0);
            const home = counts.map(([n, noun]) => `${n} ${noun}${n === 1 ? '' : 's'}`).join(' · ')
              || 'your atlas';
            if (total) openIndex();
            const nPics = photographsSetAside(r.setAside);
            toast(nPics
              ? `welcome back. ${home} ${total === 1 || !total ? 'is' : 'are'} home. this version keeps no photographs, and your file still has its ${nPics}`
              : `welcome back. ${home} ${total === 1 || !total ? 'is' : 'are'} home`, nPics ? 9000 : undefined);
          });
        });
      };
      file.click();
    });
    // The fourth way in: the atlas is not on this device and never was a file.
    //
    // The tags come first, exactly as they do for an empty start, because a
    // restore that does not arrive still has to leave a working atlas behind
    // it. Then the club room, with the field for the key already holding the
    // focus, because that field is the entire errand and asking a person to
    // find it after all this would be the walk again in miniature.
    //
    // A door that leads to a key field has not been walked through yet. This
    // one used to call done() on the way in, which marks the start chosen and
    // drops this screen for good. So a newcomer who pressed the warmest word on
    // the screen out of curiosity, met a room whose first offer is a price, and
    // closed it again was left on an empty field having spent their only first
    // run screen, and no reload brought it back. The answer waits for the room
    // to close now, and it counts only if something came home or a key was
    // kept. Nothing else waits: the tags are written and the screen is already
    // out of the way.
    $('#thMember').addEventListener('click', () => {
      if (!store.tags.length) {
        Object.values(baseTags()).forEach(t => store.addTag(t));
        renderAll();
      }
      dropDialog(th);
      onClubClosed = () => {
        onClubClosed = null;
        const home = store.places.length || store.routes.length || store.books.length;
        if (home || store.settings.clubKey) return answered();
        raiseDialog(th, 'What Resonate is');
      };
      openSurface('clubOverlay', renderClub);
      $('#clubKeyIn')?.focus();
    });
    $('#thHow').addEventListener('click', () => {
      // reading is not choosing: the door reopens when the reading is done
      dropDialog(th);
      const spared = leaveHero;
      setHeroExit(() => {});
      onHowClosed = () => {
        onHowClosed = null;
        setHeroExit(spared);
        if (!store.settings.chosen && !(store.places.length + store.routes.length + store.books.length)) {
          raiseDialog(th, 'What Resonate is');
        }
      };
      openSurface('howOverlay');
    });
    raiseDialog(th, 'What Resonate is');
  });

  // read the link first: a visitor who was handed something is answering a
  // person, not starting an atlas, and must never be offered a first-run
  // choice over the top of it. an atlas that already exists has answered
  // that question too.
  // Asked before the report opens, because opening one clears the hash it was
  // read from. The evening is skipped for a person who arrived holding something,
  // and a thanks used to clear its own hash on the way in and then be shown
  // the whole evening, with the moment it came for playing behind the titles.
  const holding = arrivedHolding();
  const payload = parseShareHash();
  if (payload) openReport(payload);

  // The opening is a first encounter, not a toll on every return. Once seen,
  // a reload goes directly to the useful surface.
  //
  // It is short, it is the same each time, and it is the first thing this app
  // is: ways drawn out of the dark, coming to rest, dissolving into a map. The
  // only person who does not get it is the one whose device has asked for less
  // movement, and that is their instruction rather than our guess. A returning
  // visitor gets the whole of it at a little over a third of the length, which
  // is what "brief" means.
  // A returning visit opens on the index, not the bare field. The places are
  // what a person comes back to do something with: find one, compose from
  // them, read what arrived. The evening still dissolves into the map first,
  // because that is what this app is, and the field stands one Escape or one
  // press beneath the board. First visits keep the threshold, and anyone
  // arriving holding something is taken to the thing they are holding.
  const atlasSize = store.places.length + store.routes.length + store.books.length;
  const indexFirst = !payload && !holding
    && atlasSize > 0;

  // The one question the board waits on is asked now, while the evening is
  // still running, rather than after it.
  //
  // It used to be asked when the evening ended, and the answer comes from the
  // picture store, which is a database that opens at its own pace. On a slow
  // device that put the board a visible moment behind the map: the field
  // appeared, a person reached for it, and the board arrived under their
  // finger and took the press. Asked here, the answer is in hand before the
  // dissolve, so on a returning visit the board is simply what is there,
  // and a press is always the person's own.
  const floorIsClear = indexFirst
    ? photoStore.photographCount().then(n => !n).catch(() => true)
    : Promise.resolve(false);

  // Where the visit came to rest, written down once the boot has stopped
  // deciding. A person never reads it; it is here because "has the app
  // finished arriving?" was until now a question only a stopwatch could
  // answer, and a stopwatch is not an answer.
  const settled = (where) => { document.body.dataset.entry = where; };

  const directEntry = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  runIntro(() => {
    // `backFromDoor` is in this list because the club door no longer answers
    // the first run question on the way in. A member sent to the payment desk
    // comes back with `chosen` still false, and without this the threshold
    // would rise, at z 2400, over the very room they were sent back to.
    if (store.settings.chosen || atlasSize || payload || backFromDoor) {
      if (payload) { settled('letter'); return; }
      // the board yields to anything the boot has to say. the photographs
      // notice waits for a free floor, and the risen board is a surface, so
      // a board raised first would keep that notice waiting forever: the
      // person is owed the notice, and the board can wait a visit. damaged
      // keys are known synchronously; the picture count is asked first and
      // the board rises only on a boot with nothing else to deliver.
      if (indexFirst && !modalUp() && !unreadableKeys().length) {
        floorIsClear.then(clear => {
          if (clear && !modalUp()) openIndex();
          settled(clear ? 'board' : 'field');
        });
        return;
      }
      startWelcome();
      settled('field');
      return;
    }
    openThreshold();
    settled('threshold');
    // Someone who arrived holding something did not come for a title
    // sequence. A folio, an ask, an atlas, a place shared in from a phone, or
    // a return from the club door: the thing they came for is already
    // rendered underneath, and the evening would be sitting on top of it. The
    // evening is for arriving at Resonate, not for arriving at a person.
  }, { brief: false, skip: holding || directEntry || !!store.settings.introSeen });

  setHeroExit(() => {
    if (!document.body.classList.contains('hero')) return;
    walkNameHome();
  });
  // the wordmark is for arriving at Resonate, not for arriving at a person:
  // the same cleared hash that used to hand a thanks the whole evening also left
  // the title standing over the moment it came for
  const fieldArrival = store.settings.chosen || atlasSize > 0 || backFromDoor;
  if (!holding && !indexFirst && fieldArrival) {
    document.body.classList.add('hero');
    const exit = () => {
      if (!$('#intro').hidden || modalUp()) {
        ['keydown', 'wheel'].forEach(ev =>
          document.addEventListener(ev, exit, { once: true, passive: true }));
        return;
      }
      leaveHero();
    };
    mapView.onFirstUse(exit);
    ['keydown', 'wheel'].forEach(ev =>
      document.addEventListener(ev, exit, { once: true, passive: true }));
    $('#fmCommand').addEventListener('click', exit, { once: true });
    $('#fmIndex').addEventListener('click', exit, { once: true });
    // The coordinates fly the field to where you stand, which is the field in
    // use by any reading of it, and the title stayed across the middle of the
    // screen sitting on top of the marks that press had just asked for.
    $('#coordsReadout').addEventListener('click', exit, { once: true });
    // A right-click in the middle of the field is the field in use too: it is
    // the gesture that marks a place. While the name stands there the press
    // lands on a button instead, the browser selects the word, and no proposal
    // opens, so a person's first `mark this spot` could be eaten by the title.
    // Leaflet hears nothing outside its own container, so the word hands the
    // point on and steps aside. leaveHero rather than exit, because exit
    // bounces off its own guard and would leave the giant word over the form.
    $('#fmIndex').addEventListener('contextmenu', (e) => {
      if (!document.body.classList.contains('hero')) return;
      e.preventDefault();
      leaveHero();
      const at = mapView.pointOf(e);
      if (at) proposeAdd(at.lat, at.lng);
    });
  }

  setTimeout(() => document.body.classList.remove('boot'), 700);

  // The bar had one word and it burned the letter. A visit is opened from a
  // report, the report is the only copy the reader has of what was sent, and
  // the only road back to it was the link in their messages, which nothing
  // here ever said. So the letter stands beside the leaving: the payload the
  // visit was opened from is held on state.visiting, and this word raises it.
  //
  // Built here rather than in the shell because the shell's word budget is
  // spent, and because a word for a road that may not exist has no business
  // standing in the markup. It ends the visit before it raises the report: the
  // bar sits above a report in the stacking order and outside what a modal
  // makes inert, and the report offers the field again in its own foot.
  const visitLetter = document.createElement('button');
  visitLetter.id = 'visitLetter';
  visitLetter.className = 'word-btn quiet';
  visitLetter.textContent = 'the letter';
  visitLetter.addEventListener('click', () => {
    const held = state.visiting?.letter;
    const example = !!state.visiting?.example;
    if (!held) return;
    endVisit();
    openReport(held, { example });
  });
  $('#visitLeave').before(visitLetter);
  $('#visitLeave').addEventListener('click', leaveVisit);
  // the corner that says where the field is looking also takes you to where
  // you stand: locate flies the map itself (setView), and the fix is kept so
  // "nearest" means nearest you from here on
  $('#coordsReadout').addEventListener('click', () => {
    askWhereYouAre(() => { paintSort(); toast('where you stand'); });
  });

  // corner marks
  $('#fmIndex').addEventListener('click', () => {
    $('#indexOverlay').hidden ? openIndex() : closeSurface('indexOverlay');
  });
  $('#fmCommand').addEventListener('click', togglePalette);
  $('#thBack').addEventListener('click', () => dropDialog($('#threshold')));
  $('#fmHelp').addEventListener('click', () => {
    // wherever you are, the opening is one press away
    closeSurface('indexOverlay'); closeSurface('howOverlay');
    showOpening();
  });
  $('#hbDone').addEventListener('click', () => {
    const bar = $('#handBar');
    bar.onkeydown = null;
    dropDialog(bar);
  });
  // a report's close word, present in every letter, wired here once
  $('#reportOverlay').addEventListener('click', (e) => {
    if (e.target.id !== 'rpX') return;
    closeReport();
  });
  $('#indexClose').addEventListener('click', () => closeSurface('indexOverlay'));
  $('#fieldWord').addEventListener('click', turnField);
  $('#themeWord').addEventListener('click', () => {
    // day, night, or whatever this device is doing: one press moves along,
    // so following the system is somewhere you can get back to
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(store.settings.theme) + 1) % order.length];
    setTheme(next);
  });

  // the index is the hub: every surface reachable as a word
  $('#indexGo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    // the index stays open beneath: closing what you opened returns you to it,
    // so reading one explanation does not cost you the others
    VERBS[b.dataset.go]?.run();
  });

  // tapping the open field puts the plate away
  mapView.getMap().on('click', () => {
    if (!$('#plate').hidden) closeSurface('plate');
    if (state.pendingAdd) cancelAdd();
  });

  // command line
  palette.input = $('#paletteInput');
  palette.results = $('#paletteResults');
  $('#paletteClose').addEventListener('click', () => popSurface());
  $('#paletteOverlay').addEventListener('click', (e) => { if (e.target === $('#paletteOverlay')) popSurface(); });
  palette.input.addEventListener('input', () => renderPaletteResults(palette.input.value.trim()));
  palette.input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // Results read from top to bottom, so the arrows move the same way.
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      palette.hl = Math.max(0, Math.min(palette.rows.length - 1, palette.hl + dir));
      const rows = $$('.cmd-row', palette.results);
      rows.forEach((r, i) => r.classList.toggle('hl', i === palette.hl));
      syncPaletteActive();
      // and the box goes with it. The list can genuinely run past the box now
      // that an empty bar offers every city a person keeps places in, and the
      // highlight used to walk straight out of the top of it while the box
      // stayed where it was: Enter then acted on a row nobody could see.
      //
      // `nearest` moves only enough to reveal the active row, so holding an
      // arrow does not scroll the page underneath.
      rows[palette.hl]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // act on what is visibly highlighted, never on a stale index, and never
      // on a bar nobody has typed into: its first row hands over a folio
      // titled with somebody's top city, and a person who opened the bar and
      // pressed enter to see what would happen chose nothing. an arrow or a
      // press chooses; then this acts.
      if (palette.hl < 0) return;
      const el = palette.results.querySelector('.cmd-row.hl') || palette.results.querySelector('.cmd-row');
      if (el) activateRow(parseInt(el.dataset.i, 10));
    }
  });

  // index controls
  $('#kindSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    state.filters.kind = b.dataset.kind;
    state.gather = null;
    paintAtlasControls();
    renderChips();
    renderList();
    syncMarkers();
    applyWorldState();
  });
  $('#statusSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    setStatusFilter(b.dataset.status);
  });
  // The arrangement is one cycling word, the idiom the footer already taught:
  // the tone word cycles, the theme word cycles, and now the order does. Four
  // buttons and a reveal row used to stand here for a choice of four; each
  // press now moves one along and applies at once, so the list itself is the
  // preview. "nearest" measures from the middle of the field until a fix is
  // held, which paintSort already says.
  //
  // Landing on that word now asks the device, and that is half the phone
  // story. `findMe` was reachable by typing `near` into the command palette,
  // and the corner that flies you to yourself was `display: none` under 761px.
  // So on the one device that is actually carried to places, there was no way
  // to ask where you were except to know a word you had never been told. This
  // is a control that already exists, on every width, whose own label was
  // already promising the thing. The corner is a door on a phone now too, and
  // the two are not the same act: this one arranges the list from you and
  // leaves the field alone, which is why it asks with `fly: false`.
  //
  // It asks and does not wait: the list reorders from the middle of the field
  // now, and again from you when the device answers, which askWhereYouAre
  // does on its own. Nobody is held in front of a spinner for a sort.
  //
  // It asks on settling, not on passing. The four stations are invisible until
  // they are stepped through, so the only way to reach `by city` was through
  // `nearest`, and landing there raised the device's own permission sheet over
  // somebody on their way somewhere else; a refusal collected in passing was
  // then re-announced on every later lap. So the ask waits for the word to stop
  // moving. A press inside the beat cancels it, and only a word still saying
  // `nearest` once the hand has left asks anything. The list is arranged from
  // the middle of the field meanwhile, which is what the word already says it
  // measures from.
  let sortSettling = null;
  const SORT_SETTLE_MS = 700;
  $('#sortWord').addEventListener('click', () => {
    const orders = ['recent', 'name', 'distance', 'city'];
    state.sort = orders[(orders.indexOf(state.sort) + 1) % orders.length];
    clearTimeout(sortSettling);
    if (state.sort === 'distance' && !hereNow()) {
      sortSettling = setTimeout(() => {
        // a board that has been closed is not a screen to raise a sheet over
        if (state.sort !== 'distance' || hereNow() || $('#indexOverlay').hidden) return;
        askWhereYouAre(null, { fly: false });
      }, SORT_SETTLE_MS);
    }
    paintSort();
    renderList();
  });
  revealRow('#filterWord', '#filterChips');

  // posters close
  $$('.poster [data-close]').forEach(b => b.addEventListener('click', () => {
    const poster = b.closest('.poster');
    closeSurface(poster.id);
  }));

  // add-confirm
  // a form submits: by its button, by enter, by whatever a person's device does
  $('#addConfirm').addEventListener('submit', (e) => { e.preventDefault(); commitAdd(); });
  $('#addConfirmCancel').addEventListener('click', cancelAdd);
  $('#addConfirm').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelAdd(); }
  });
  $('#addConfirmInput').addEventListener('input', (e) => { e.target.dataset.typed = '1'; });

  // photo capture + drop
  $('#shootFile').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) addFromPhoto(f);
  });
  $('#gpxFile').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) addFromGPX(f);
  });
  let dragDepth = 0;
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])];
    const gpx = files.find(x => /\.gpx$/i.test(x.name) || x.type.includes('gpx'));
    if (gpx) return addFromGPX(gpx);
    const img = files.find(x => x.type.startsWith('image/'));
    if (img) addFromPhoto(img);
  });

  // mobile: swipe up from the bottom edge = index
  let edgeY = 0;
  addEventListener('touchstart', (e) => {
    if (modalUp() || surfaces.length) { edgeY = 0; return; }
    const t = e.touches[0];
    if (document.elementFromPoint(t.clientX, t.clientY)?.closest('.fm')) { edgeY = 0; return; }
    const y = t.clientY;
    edgeY = (innerHeight - y < 34 && innerHeight - y > 6) ? y : 0;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (edgeY && edgeY - e.touches[0].clientY > 56) { openIndex(); edgeY = 0; }
  }, { passive: true });
  visualViewport?.addEventListener('resize', () => {
    $('#paletteOverlay').style.paddingBottom = `${Math.max(0, innerHeight - visualViewport.height) + 20}px`;
  });

  // The last events a browser reliably gives before a page goes away, and on
  // a phone often the only ones: a tab switched, an app backgrounded, a
  // window closed. Whatever is still on its way to disk goes now.
  addEventListener('pagehide', () => {
    flushWrites();
    // A browser may queue a tool call while a BFCache document is inactive and
    // run it as that document returns. End this page's session now: consent
    // could be revoked from another tab while the document is suspended, and
    // its queued storage event is not an adequate privacy boundary.
    agentPageActive = false;
    void syncAgentAccess();
  });
  addEventListener('pageshow', (event) => {
    // Storage events are suspended with a BFCache document. Read the durable
    // choice before looking at the runtime: a revocation made in another tab
    // while this one slept must never be followed by a transient reconnect.
    if (event.persisted) {
      store.load();
      renderAll();
      pushCorrespondentsToMap();
    }
    agentPageActive = true;
    void syncAgentAccess();
  });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushWrites(); });
  addEventListener('beforeunload', flushWrites);

  window.addEventListener('resize', debounce(() => mapView.invalidate(), 150));

  // Another tab wrote the atlas: take its truth rather than overwriting it.
  // Reading and repainting the whole atlas may wait for a burst of writes to
  // settle. Consent may not: a tool must be gone before the storage event
  // returns, not a quarter-second later with the rest of the repaint.
  const refreshFromStorage = debounce(() => {
    store.load();
    renderAll();
    pushCorrespondentsToMap();
  }, 250);
  const disclosureStorageKeys = new Set([
    'resonate.places.v1', 'resonate.routes.v1', 'resonate.books.v1',
    'resonate.tags.v1', 'resonate.settings.v1',
  ]);
  window.addEventListener('storage', (event) => {
    if (event.key && !String(event.key).startsWith('resonate.')) return;
    let loadedNow = false;
    const loadDisclosureNow = () => {
      try { store.load(); }
      catch { store.settings.agentAccess = false; }
      loadedNow = true;
      // Usually this is the same target and therefore registration-stable.
      // It also catches a durable revocation observed during the fresh read.
      void syncAgentAccess();
    };
    if (event.key === 'resonate.settings.v1' || event.key === null) {
      let allowed = false;
      try {
        const saved = event.key === null ? null : JSON.parse(event.newValue || 'null');
        allowed = !!saved && typeof saved === 'object' && !Array.isArray(saved)
          && saved.agentAccess === true;
      } catch { /* damaged or missing settings fail closed */ }
      const wasAllowed = store.settings.agentAccess === true;
      if (wasAllowed && !allowed) {
        // Revoke against the in-memory session first. The full store refresh
        // below is deliberately later, but no tool remains live for it.
        store.settings.agentAccess = false;
        void syncAgentAccess();
      } else if (!wasAllowed && allowed) {
        // A source tab may have made a record private immediately before it
        // granted access. Load that durable atlas before registration so the
        // first tool call cannot observe the stale, wider disclosure here.
        loadDisclosureNow();
      }
    }
    // A privacy change is time-sensitive for every outward door, not only for
    // a live assistant session. Refresh the in-memory disclosure before this
    // event returns, while leaving the comparatively expensive map and list
    // repaint on the debounce below. Each exit still rereads durable state at
    // its own boundary to cover an event that has not been delivered yet.
    if (!loadedNow && disclosureStorageKeys.has(event.key)) loadDisclosureNow();
    refreshFromStorage();
  });

  // an atlas that already exists deserves the browser's protection
  if (store.settings.chosen || store.places.length) {
    navigator.storage?.persist?.().catch?.(() => {});
  }

  // keyboard
  document.addEventListener('keydown', (e) => {
    // while the evening stands, no key opens anything behind it. it keeps
    // enter, escape and space for itself; without this the others would open a
    // surface nobody can see and hand it a keyboard nobody can use. the test is
    // written the long way round on purpose: no evening means no bar, never a
    // keyboard that does nothing
    if ($('#intro')?.hidden === false) return;
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) ||
      document.activeElement?.isContentEditable;
    // the command line is a shortcut like any other: it may not open behind
    // a dialog that has the floor. escape alone reaches past everything.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      if (modalUp() && topSurface() !== 'paletteOverlay') return;
      e.preventDefault(); togglePalette(); return;
    }
    if (e.key === 'Escape') {
      // A question the house raised holds the keys as well as the focus. Both
      // asks stop the press at their own box; this is the same rule said once
      // for both, for the press that lands anywhere else. The sheet itself
      // holds the focus for the moment before its first word takes it, and a
      // press in that moment used to reach past an aria-modal dialog and take a
      // surface down behind it, one per press, where nobody could see it.
      if (!$('#askBox').hidden || !$('#nameAsk').hidden) return;
      if (state.pendingAdd) { cancelAdd(); return; }
      if (state.visiting) { leaveVisit(); return; }
      if (!$('#reportOverlay').hidden) { closeReport(); return; }
      const th = $('#threshold');
      if (th && !th.hidden && th.classList.contains('revisited')) { dropDialog(th); return; }
      if (popSurface()) return;
    }
    if (inField) return;
    // a shortcut may not act on a field that a dialog has taken out of reach
    if (modalUp()) return;
    if (e.key === '/') { e.preventDefault(); togglePalette(); return; }
    const acc = [...accessionMap().entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const step = (d) => {
      if (!acc.length) return;
      const i = acc.indexOf(state.selectedId);
      const id = acc[(i + d + acc.length) % acc.length] ?? acc[0];
      selectPlace(id, { fly: true });
    };
    const keys = {
      i: () => $('#indexOverlay').hidden ? openIndex() : closeSurface('indexOverlay'),
      j: () => step(1), k: () => step(-1),
      '+': mapView.zoomIn, '=': mapView.zoomIn, '-': mapView.zoomOut,
      0: () => mapView.fitAll(filteredPlaces()),
      t: () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'),
      g: VERBS.locate.run, s: shareMap,
      // the mark in the corner and this key are the same question, so they
      // must be the same answer
      '?': () => { closeSurface('indexOverlay'); closeSurface('howOverlay'); showOpening(); },
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); return; }
    if (/^[1-9]$/.test(e.key)) {
      const t = allTags()[+e.key - 1];
      if (!t) return;
      state.filters.tags.has(t.id) ? state.filters.tags.delete(t.id) : state.filters.tags.add(t.id);
      renderChips(); renderList(); syncMarkers(); applyWorldState();
    }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      paintDeviceState();
      if (!hadController) { hadController = true; return; }
      toast('a new release is ready', 9000, {
        word: 'reload now',
        run: () => location.reload(),
      });
    });
    // Installing the full offline atlas during first paint competes with the
    // map for the same mobile connection. The current page needs none of that
    // traffic to work, so begin only after its own resources have finished;
    // idle time keeps the install out of the first post-load gesture as well.
    const registerOfflineShell = () => {
      const go = () => navigator.serviceWorker.register('sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(paintDeviceState)
        .catch(() => paintDeviceState());
      if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2000 });
      else setTimeout(go, 0);
    };
    if (document.readyState === 'complete') registerOfflineShell();
    else addEventListener('load', registerOfflineShell, { once: true });
  }
}

init();
