// find.js — the key an atlas is already organised by, and the words a question
// is made of.
//
// Two rules live here for the same reason. Both decide what a person is shown,
// both are pure arithmetic over records, and neither could be tested where it
// used to live: app.js reaches for a document on its first line, so no node
// test can import it, and the two rules most in need of pinning sat in the one
// file nothing could open.
//
// The first is the city. buildSheet has grouped the printed sheet under city
// headings since the day it was typeset, and it computed that heading inline.
// The composer, the command line and the index all offer the same heading as
// something a person can press, which only holds if every one of them computes
// it identically, today and after the next edit. So the key is written once
// here, and the sheet asks for it like everybody else.
//
// The second is the question. See wordsOf.

// ---------- the city ----------

// A place with no city waits under the words the printed sheet has always
// used for it, so the composer and the page agree even about the absence.
export const PLACELESS = 'off the map';

// A city is written the way the atlas holds it, and it is never translated.
// An atlas that stores Lisboa is not corrected to Lisbon: that is the world's
// own name for the place, written by the person who stood in it. The same goes
// for Kraków, for München, for 東京. Nothing here maps one name onto another,
// and nothing added later should: a table of the "real" names of cities is a
// claim about whose language is the real one, and this app has no business
// making it.
//
// The country rides along because two cities share a name more often than
// people expect, and a folio titled for the wrong one is a small betrayal.
export function cityLabel(rec) {
  return [rec && rec.city, rec && rec.country].filter(Boolean).join(', ') || PLACELESS;
}

// ---------- one spelling, so one city is one city ----------
//
// A Map key is compared code point by code point, so the key above splits on a
// difference no reader can see. "Basel" and "Basel " are two cities. So are a
// München whose umlaut is one character and a München whose umlaut is two,
// which is what happens when one record came from a phone's keyboard and the
// next from a service that answers in the other normal form. The index draws
// two bands that read identically, the command line offers the same city
// twice, and pressing either composes half a folio.
//
// So a spelling is settled once, where the record is made, and never where it
// is read. A key that normalised as it read would have to be spelled the same
// way in the composer, the index, the sheet, the command line and the export,
// forever, and the first surface to forget would split the city again. There
// is one place a place comes into being, and this is called from there.
//
// What it settles is spacing and the two ways Unicode writes the same letter.
// It does not touch case and it never should: deciding between Basel and basel
// means deciding whose writing of the name is the real one, and that is the
// judgement cityLabel refuses above, for the same reason.
//
// A record made before this keeps the spelling it was made with until it is
// next written, which is the honest bound on a rule that lives at the door
// rather than in the reading.
export function oneSpelling(s) {
  return String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim();
}

// The records under each city, in the order the records themselves arrived.
// This is what the sheet prints: an entry's position on a printed page is the
// position it was written in, and nothing about paper wants that disturbed.
export function groupByCity(records) {
  const groups = new Map();
  for (const rec of records || []) {
    const key = cityLabel(rec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }
  return groups;
}

// The same grouping, ordered for choosing rather than for reading.
//
// The order is: the cities you hold most places in first, ties settled
// alphabetically by the label itself, and the placeless last however many of
// them there are. Choosing is not reading. On a page of cities offered to a
// hand, the city you keep nine places in is almost always the one meant, and
// the records with no city at all are the ones nobody goes looking for.
//
// `first` is a city somebody has just pressed, and it comes before all of
// that. A ranking is a guess about what was wanted; a press is not a guess,
// and a page that opens anywhere other than where the press pointed reads as
// though the press was never heard.
export function citiesHeld(records, first = '') {
  return [...groupByCity(records).entries()]
    .map(([label, places]) => ({ label, places }))
    .sort((a, b) => {
      const af = !!first && a.label === first;
      const bf = !!first && b.label === first;
      if (af !== bf) return af ? -1 : 1;
      const an = a.label === PLACELESS;
      const bn = b.label === PLACELESS;
      if (an !== bn) return an ? 1 : -1;
      return b.places.length - a.places.length || a.label.localeCompare(b.label);
    });
}

// ---------- the question ----------

// What counts as a letter, anywhere in the world. A word ends where one of
// these stops, which is how punctuation stays out of the answer: a question
// mark is not part of the word in front of it, and neither is a comma.
const LETTER = /[\p{L}\p{N}]/u;
const NOT_LETTER = /[^\p{L}\p{N}]+/u;

// A script that does not put spaces between its words has already been cut
// into whole words by the split, so its two-character words are words. This
// is a fact about how Unicode writes those scripts down, not a judgement
// about which words matter, which is the distinction the rule below turns on.
const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u;

// The words of a question, and the reason there is no list of them.
//
// The old matcher took every whitespace-separated run in the question and
// asked whether it appeared anywhere inside a place, as a substring. So "what
// should we do in Lisbon?" matched "do" against every place in LonDON, "in"
// against BerlIN and against SpaIN, and "we" against AntWErp, and the ask
// report printed the total at the person as though their atlas had answered.
// It has been printing that inflated number since the day it shipped.
//
// The obvious repair is a list of English words to throw away. It is the wrong
// repair. Such a list is a tax paid forever by every reader of every other
// language, it has to be maintained by someone who speaks all of them, and it
// fails on the first question written in German, where "wir" and "was" are not
// on it and "die" is a word somebody's bar is called.
//
// Two rules with no vocabulary in them do the same work and keep doing it in
// any language. A word is at least three characters long, which is the whole
// of what killed "do", "in" and "we". And a word matches on its own edges, so
// "the" does not answer for Athens and "art" does not answer for Cartagena.
export function wordsOf(q) {
  return String(q == null ? '' : q)
    .toLowerCase()
    .split(NOT_LETTER)
    .filter(w => w.length > 2 || (w.length > 0 && UNSPACED.test(w)));
}

// Is the needle in there with no letter in front of it, and, behind it,
// either no letter at all or exactly one?
//
// Written as a scan rather than as a pattern, because the needle comes from a
// stranger's question and building a regular expression out of it would mean
// escaping it correctly forever.
function standsAlone(h, w, give) {
  for (let i = h.indexOf(w); i !== -1; i = h.indexOf(w, i + 1)) {
    if (i > 0 && LETTER.test(h[i - 1])) continue;
    const after = h[i + w.length] || '';
    if (!LETTER.test(after)) return true;
    if (give && !LETTER.test(h[i + w.length + 1] || '')) return true;
  }
  return false;
}

// Does this haystack contain that word, standing on its own?
//
// A word stands on its own when the characters touching it are not letters.
// That rule alone is why "the" does not answer for Athens and "art" does not
// answer for Cartagena, and it stays.
//
// One letter of give at the end, and why there is still no stemmer.
//
// The edges alone answered nothing to "a good bar" in an atlas that holds
// Wine Bars, and an ask nothing answers prints a report with no way to reply
// on it: the whole exchange stops on one letter. The repairs with names are a
// stemmer, which is one language's endings written down, and a word list,
// which is the same tax in another shape. Both have to be maintained by
// somebody who speaks every language this app is used in.
//
// So: two words are the same word here when one is the other plus a single
// letter at the end. bar and bars. taco and tacos. praia and praias. Hund and
// Hunde. Adding one letter is the commonest thing a language does to count
// with, and the rule holds in both directions, so it does not matter which of
// the two the question happened to use. Only at the end, because a letter in
// front changes a word far more often than a letter behind it: art and cart
// are not the same word, and the edge rule keeps saying so.
//
// What it does not cover, said plainly, because a rule that overstates itself
// is worse than a strict one.
//
// An ending that replaces the last letter rather than adding one: vino and
// vini, pizza and pizze, most of how Italian counts. An ending longer than a
// letter: bakery and bakeries, bar and bares, Haus and Häuser, child and
// children. A word that inflects at the front or in the middle, which is much
// of what a case system does. Extending to a substitution would reach the
// Italian plurals and would also make bar answer for bat, ban and bad, which
// is a worse trade at three letters than the one being fixed.
//
// And it will now and then join two words that are genuinely different and
// happen to differ by one final letter, so a question about a bar can be
// answered by a barn. That is the price. It is paid in both directions, it is
// the same price in every language, and it is smaller than answering nothing.
export function hasWord(hay, word) {
  const w = String(word == null ? '' : word).toLowerCase();
  if (!w) return false;
  const h = String(hay == null ? '' : hay).toLowerCase();
  // the give is not offered to a needle of one or two characters. wordsOf
  // already refuses those out of a spaced question, and a script that writes
  // whole words in two characters is not counting anything with a suffix.
  if (standsAlone(h, w, w.length > 2)) return true;
  // and the other direction: a question written "bars" is answered by an
  // atlas that holds "bar". the shortened needle is held to its own edges, so
  // bars does not reach barn as well by going round twice.
  const last = w[w.length - 1];
  return w.length > 3 && LETTER.test(last) && standsAlone(h, w.slice(0, -1), false);
}

// Does this record answer that question? One word is enough: a person asking
// for wine bars in Lisbon is answered by a wine bar, and answered by a place
// in Lisbon, and would rather be handed both than neither.
//
// The tags are read through a name function because a tag travels as an id,
// and the atlas that holds the id is the only thing that knows the word.
export function answers(rec, words, nameOf = () => '') {
  if (!rec || !words || !words.length) return false;
  const tags = Array.isArray(rec.tags) ? rec.tags : [];
  const hay = [rec.name, rec.city, rec.country, rec.note, ...tags.map(t => nameOf(t) || '')]
    .filter(Boolean).join(' ').toLowerCase();
  return words.some(w => hasWord(hay, w));
}

// ---------- a title, read as a question ----------
//
// The folio composer's title field titled the folio and did nothing else, and
// that is where the whole city feature was lost. Somebody on a phone opened
// the composer, typed Basel, and went on looking at fifteen places grouped by
// city with Tokyo at the top and nothing enclosed. Every one of the gestures
// they were reaching for existed: the command bar offers the cities you keep
// places in, and pressing one opens a composer already titled and already
// full. But the command bar is one way in, and it is not the obvious one. The
// composer reached directly had learned none of it.
//
// So the title is read as a question while it is typed, with the matcher the
// ask already uses, and the rows that answer it are the rows that stand.
// Nothing new is invented for the reading: a person who types Basel means the
// same thing in a title as in an ask, and two matchers for one word drift
// apart the first afternoon either of them is improved.


// The city a typed title names, out of the cities this person actually holds.
//
// Held, and never a table of the world's cities. The offer is only worth
// making over places already on the shelf: a city nobody has a place in is a
// suggestion to go and get one, which is not what a composer is for, and a
// press that enclosed nothing would be a promise broken in one gesture.
//
// The most held city answers first, because citiesHeld has already ranked them
// that way and for the same reason: on a page offered to a hand, the city you
// keep nine places in is almost always the one that was meant.
//
// The placeless are not among them, exactly as in the command line. A folio
// needs a title, and off the map is not a city anybody asked for.
// The city a title is reaching for while it is still being typed.
//
// A prefix, and deliberately not the matcher above. answers() and hasWord()
// are built for a question somebody has finished asking, where "do" must not
// reach every place in London and one letter of give is all a plural needs. A
// person typing into a field has finished nothing. At "Bas" they mean Basel,
// and a composer that waits for the last letter is waiting for no reason: it
// was measured doing exactly that, showing all eighteen places at B, Ba and
// Bas, and only moving at Basel.
//
// Any word of what has been typed, against any word of a city held. So "basel
// bars" finds Basel on its first word, and a title that names no city finds
// nothing and changes nothing. One letter is enough to answer, because nothing
// is hidden by the answer: the city rises and the rest of the atlas stays
// under it, so the cost of being eager is a band that moves.
//
// Held cities only, and never a table of the world's. The city you keep nine
// places in answers before the city you keep one in, because citiesHeld has
// already ranked them that way.
export function cityTyped(records, q) {
  const typed = String(q == null ? '' : q).toLowerCase().split(NOT_LETTER).filter(Boolean);
  if (!typed.length) return null;
  const groups = citiesHeld(records).filter(g => g.label !== PLACELESS);
  const starts = (text) => {
    const parts = String(text || '').toLowerCase().split(NOT_LETTER).filter(Boolean);
    return typed.some(w => parts.some(part => part.startsWith(w)));
  };
  // The town before the country it stands in. Reading the whole label at once
  // answered "por" with Lisboa, because Lisboa is in Portugal and is held more
  // often than Porto, so the country of the bigger city hid the smaller city
  // that was actually being typed. Two passes, and a country only answers when
  // no town does: "por" is Porto, "portugal" is still the Portuguese city with
  // the most places in it.
  return groups.find(g => starts(g.places[0] && g.places[0].city))
    || groups.find(g => starts(g.label))
    || null;
}

