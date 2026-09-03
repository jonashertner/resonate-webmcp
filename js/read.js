// read.js — one page, the documents that travel with the atlas.
//
// The documents used to be linked as files. A browser handed most people a
// download or a wall of unset text, so the sentence "none of this asks to be
// believed" ended at a link nobody pressed. They are set as pages now, from
// the same markdown, which stays the only copy.

// PAGES is the word a link uses after ?d= and the file it means. A name out of
// the address bar is never a path: that list is the only way to name a file, so
// no ../ and no other origin can be asked for, whatever is typed. It is kept
// beside the reader that sets the documents, because the same list is what lets
// a link between two documents point here instead of at the raw file.
import { render, title, PAGES, PAGE_ALIASES, UNFINISHED } from './marks.js?v=rf158';

// The word that stands in front of an unfinished document, kept as a digest so
// that reading this file does not hand it over. That is the only thing the
// digest buys. Anyone who wants the document can ask the origin for the file
// itself, which is a static host answering as it should, so this is a curtain
// and is described as one wherever it is described at all.
const KEPT = '1ff76191fcd7a7ef0505da5769cd3517aaadd117cb2a05c8587b1e90118ab882';
const REMEMBERED = 'resonate.reading.v1';

const body = document.querySelector('#readBody');
const readStatus = document.querySelector('#readStatus');
const requested = (new URLSearchParams(location.search).get('d') || '').toLowerCase();

// A status region announces mutations, not the prose it was born carrying.
// Let it enter the accessibility tree empty, then name a genuinely pending
// read after the first paint. A document that arrives sooner proceeds straight
// to its more useful ready announcement.
requestAnimationFrame(() => {
  if (body.hasAttribute('aria-busy')) readStatus.textContent = 'Loading document.';
});

// An older word is answered, and then corrected in the address bar, so the
// reader arrives at the document and leaves with the name it is called now.
// Reaching past the aliases with hasOwnProperty for the same reason as below:
// `?d=constructor` is a word an object answers to and a document is not.
const asked = Object.prototype.hasOwnProperty.call(PAGE_ALIASES, requested)
  ? PAGE_ALIASES[requested]
  : requested;
const file = Object.prototype.hasOwnProperty.call(PAGES, asked) ? PAGES[asked] : null;

if (file && asked !== requested) {
  history.replaceState(null, '', `read.html?d=${encodeURIComponent(asked)}`);
}

function set(html, announcement = 'Document ready.') {
  body.innerHTML = html;
  body.removeAttribute('aria-busy');
  readStatus.textContent = announcement;
}

function show() {
  fetch(file, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((md) => {
      set(render(md));
      const named = title(md);
      if (named) document.title = `${named} · Resonate`;
    })
    .catch(() => set('<h1>Not read</h1><p>This one needs a connection once. '
      + 'After that it stays on the device with everything else. '
      + '<a href="./">The atlas is this way</a>.</p>', 'Document could not be loaded.'));
}

const said = (word) => crypto.subtle
  .digest('SHA-256', new TextEncoder().encode(`resonate-reading:${word.trim().toLowerCase()}`))
  .then((sum) => [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, '0')).join(''));

// A device that has been given the word keeps it, so that a person reading both
// documents is asked once rather than at every link. What is kept is the fact
// that it was answered and never the word itself.
const told = () => {
  try { return localStorage.getItem(REMEMBERED) === 'yes'; } catch { return false; }
};

function ask() {
  // a document that is not finished should not be the thing a search engine has
  // of this site, whatever it makes of a page it cannot open
  document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow');
  document.title = 'Not finished yet · Resonate';
  set('<h1>Not finished yet</h1>'
    + '<p>This one is still being written, and parts of it say what they will say '
    + 'rather than what is true. It is here so that the people helping to get it '
    + 'right can read it.</p>'
    + '<form class="read-gate" id="readGate">'
    + '<label for="readWord">If you were given the word, it goes here.</label>'
    + '<input id="readWord" type="password" autocomplete="off" autocapitalize="off" '
    + 'autocorrect="off" spellcheck="false">'
    + '<button type="submit">Read it</button>'
    + '<p class="read-no" id="readNo" role="alert" hidden>That is not the word.</p>'
    + '</form>'
    + '<p>Everything else this site keeps is open, and <a href="./">the atlas is this way</a>.</p>',
  'Document access required.');

  const form = document.querySelector('#readGate');
  const field = document.querySelector('#readWord');
  const no = document.querySelector('#readNo');
  field.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    said(field.value).then((sum) => {
      if (sum !== KEPT) {
        no.hidden = false;
        field.select();
        return;
      }
      try { localStorage.setItem(REMEMBERED, 'yes'); } catch { /* a device that keeps nothing asks again */ }
      show();
    });
  });
}

if (!file) {
  set('<h1>Nothing here</h1><p>This address does not name a document this site keeps. '
    + '<a href="./">The atlas is this way</a>.</p>', 'Document not found.');
} else if (UNFINISHED.includes(asked) && !told()) {
  ask();
} else {
  show();
}
