// kinship.js — the discerning-individual engine.
// Trust here is not followers or stars: it is measured taste. Two atlases
// resonate when (1) their common ground agrees, (2) they care about the same
// tags, and (3) where they diverge, the divergence is interesting: a
// correspondent strong where you are blank expands you rather than mismatching.

import { haversineKm } from './geocode.js?v=rf158';

const SAME_PLACE_KM = 0.15; // within ~150m = the same place

// A place speaks in words now. The old number is still read, so an atlas
// handed over by an older device still says what it meant.
// Keeping a place is the recommendation, so standing behind one means having
// been there and kept it anyway. A place still wanted is hope, not counsel.
function stands(p) { return p.status === 'visited'; }
// a turning away is only legible in atlases from before this: a low number
// said it plainly. nothing written today says dislike, on purpose.
function turnsAway(p) {
  const r = Number(p.rating) || 0;
  return r > 0 && r <= 2;
}
// how strongly a place is offered, on the scale the blend already expects
function convictionOf(p) {
  return stands(p) ? 0.9 : 0.35;
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// evidence lines carry our own <b>/<i> markup, so every foreign value
// interpolated into them must arrive inert
function escv(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// tag distribution keyed by normalized tag NAME (ids differ across atlases)
function tagVector(atlas) {
  const tagName = new Map(atlas.tags.map(t => [t.id, norm(t.name)]));
  const v = new Map();
  for (const p of atlas.places) {
    for (const tid of p.tags) {
      const name = tagName.get(tid);
      if (!name) continue;
      v.set(name, (v.get(name) || 0) + 1);
    }
  }
  return v;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const x = a.get(k) || 0, y = b.get(k) || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function samePlace(a, b) {
  if (haversineKm(a, b) > SAME_PLACE_KM) return false;
  const an = norm(a.name), bn = norm(b.name);
  return an.includes(bn) || bn.includes(an) || haversineKm(a, b) < 0.04;
}

// mine, theirs: {tags, places}. Returns the full resonance reading.
export function resonance(mine, theirs) {
  const myTagProfile = tagVector(mine);
  const theirTagProfile = tagVector(theirs);
  const theirTagName = new Map(theirs.tags.map(t => [t.id, norm(t.name)]));
  const theirTagLabel = new Map(theirs.tags.map(t => [t.id, t.name]));

  // 1 — common ground and whether it agrees
  const common = [];
  for (const tp of theirs.places) {
    const mp = mine.places.find(p => samePlace(p, tp));
    if (!mp) continue;
    // an atlas has exactly two words, went and want to go, so common ground
    // is spoken in those words and no others: both went, both want, or the
    // split pair named by who did which. the split where they went and you
    // still want to go is the most useful overlap there is: an aspiration,
    // validated.
    const bothLove = stands(mp) && stands(tp);
    const bothWant = !stands(mp) && !stands(tp);
    const theyWent = stands(tp) && !stands(mp);
    const youWent = stands(mp) && !stands(tp);
    const disagree = (stands(mp) && turnsAway(tp)) || (stands(tp) && turnsAway(mp));
    common.push({ mine: mp, theirs: tp, bothLove, bothWant, theyWent, youWent, disagree, agree: bothLove && !disagree });
  }
  const loved = common.filter(c => c.bothLove).length;
  const wanted = common.filter(c => c.bothWant).length;
  const theirLead = common.filter(c => c.theyWent).length;
  const yourLead = common.filter(c => c.youWent).length;
  const disagreed = common.filter(c => c.disagree).length;
  const groundScore = common.length
    ? Math.min(1, (loved * 1.0 + (common.length - loved - disagreed) * 0.45 - disagreed * 0.6) / Math.max(3, common.length))
    : 0;

  // 2. tag alignment: the same words, used with the same weight
  const alignment = cosine(myTagProfile, theirTagProfile);
  const aligned = [...theirTagProfile.keys()]
    .filter(k => (myTagProfile.get(k) || 0) >= 2 && theirTagProfile.get(k) >= 2)
    .sort((a, b) => (theirTagProfile.get(b) + (myTagProfile.get(b) || 0)) - (theirTagProfile.get(a) + (myTagProfile.get(a) || 0)));

  // 3. the open mind: tags they use often and you barely use at all
  const expansion = [...theirTagProfile.keys()]
    .filter(k => theirTagProfile.get(k) >= 3 && (myTagProfile.get(k) || 0) <= 1)
    .sort((a, b) => theirTagProfile.get(b) - theirTagProfile.get(a));

  // blended score: ground counts double when it exists; expansion is a mild bonus
  const hasGround = common.length > 0;
  const score = Math.max(0, Math.min(1,
    (hasGround ? 0.5 * groundScore + 0.38 * alignment : 0.62 * alignment) +
    0.12 * Math.min(1, expansion.length / 3)
  ));

  // their picks for you: strong conviction, under tags you already use or that open ground,
  // and not already yours
  const picks = theirs.places
    .filter(tp => !mine.places.some(p => samePlace(p, tp)))
    .map(tp => {
      const names = tp.tags.map(t => theirTagName.get(t)).filter(Boolean);
      const affinity = Math.max(0, ...names.map(d => myTagProfile.get(d) || 0));
      const expands = names.some(d => expansion.includes(d));
      const conviction = convictionOf(tp);
      const note = tp.note ? 0.1 : 0;
      return {
        place: tp,
        tagLabels: tp.tags.map(t => theirTagLabel.get(t)).filter(Boolean),
        expands,
        weight: conviction + note + Math.min(0.5, affinity * 0.08) + (expands ? 0.22 : 0),
      };
    })
    .sort((a, b) => b.weight - a.weight);

  // where in the world you overlap, by name, so the verdict can be checked
  const myCities = new Set(mine.places.map(p => norm(p.city)).filter(Boolean));
  const sharedCities = [...new Set(theirs.places.map(p => p.city).filter(c => c && myCities.has(norm(c))))].slice(0, 6);

  return {
    score,
    common,
    loved,
    wanted,
    theirLead,
    yourLead,
    disagreed,
    alignment,
    alignedTags: aligned,
    expansionTags: expansion,
    sharedCities,
    mySize: mine.places.length,
    theirSize: theirs.places.length,
    picks,
  };
}

// The grounds a verdict rests on, in plain countable claims. A word without
// its evidence is still an opaque judgement, however honest the word.
export function grounds(r) {
  const g = [];
  if (r.common.length) {
    g.push({ n: r.common.length, of: `place${r.common.length === 1 ? '' : 's'} you both hold` });
  }
  if (r.loved) {
    g.push({ n: r.loved, of: `you have both been to and kept` });
  }
  if (r.wanted) {
    g.push({ n: r.wanted, of: `you both want to go to` });
  }
  if (r.disagreed) {
    g.push({ n: r.disagreed, of: 'where you do not agree' });
  }
  if (r.sharedCities.length) {
    g.push({ n: r.sharedCities.length, of: `cit${r.sharedCities.length === 1 ? 'y' : 'ies'} you both keep places in`,
      detail: r.sharedCities.join(', ') });
  }
  if (r.alignedTags.length) {
    g.push({ n: r.alignedTags.length, of: 'tags you both use often',
      detail: r.alignedTags.slice(0, 4).join(', ') });
  }
  const news = r.picks.length;
  if (news) g.push({ n: news, of: 'they know that you do not' });
  return g;
}

// The verdict: one word from a five-word lexicon, never a number.
//
// Two of the five were renamed. `faint` and `audible` named loudness, which is
// not what any of this measures, and `audible` had a second life four lines
// away in the same row as the word for a voice whose places are drawn on the
// field. `glancing` is a contact that touches at a point and passes.
// `sympathetic` is the term of the art: a string sounding because another one
// did, which is exactly the pair this band exists to describe, two atlases
// that never meet and file the world under the same words.
//
// Each rung once carried a sentence of its own, and every one of them was
// either too vague to be wrong or specific enough to be false: "you keep much
// of the same world" printed above "no overlaps yet" whenever two atlases
// matched on vocabulary alone. The score behind the word blends three separate
// quantities, and no one sentence is true of every pair that lands on a band.
// What the word rests on is counted underneath it, line by line, and those
// lines can be checked.
//
// A reader with no atlas is not distant from anybody. There is nothing on
// their side to stand at a distance from. Every rung of this lexicon is a claim
// about two atlases, and against an empty one the score is computed from an
// empty set, lands at zero and comes out `distant`: the first word this app
// ever says about somebody's friend, printed huge under their name, counted
// from nothing. That is the same objection the sentences under the rungs died
// of, one comment up. So the commonest arrival of all, a friend handing their
// atlas to a person who has never used this, gets no word, and the lines below
// say the true thing in its place.
//
// The test is `=== 0` rather than a falsy check, because a reading built by
// hand carries no size at all and must keep the old road.
export function verdict(r) {
  if (r.mySize === 0) return { word: '' };
  const s = r.score;
  if (s < 0.15) return { word: 'mostly new to you' };
  if (s < 0.35) return { word: 'a little overlap' };
  if (s < 0.55) return { word: 'some overlap' };
  if (s < 0.75) return { word: 'much in common' };
  return { word: 'very close' };
}

// kinship spoken in three registers — specific claims, never a blended score
export function evidenceLines(r, name) {
  const lines = [];
  // Nothing here can be counted against an atlas that does not exist yet: no
  // overlaps, no sections read, no ground barely touched. One sentence instead,
  // and it is checkable.
  if (r.mySize === 0) return ['your atlas is empty, so everything here is new to you'];
  if (r.common.length) {
    // matter of fact, in the atlas's own two words and no others. the split
    // pair is named by who did which, because "they went, you want to go" is
    // the most useful overlap there is: an aspiration, validated.
    const who = escv(name) || 'they';
    const parts = [];
    if (r.loved) parts.push(`<b>${r.loved}</b> you both went`);
    if (r.wanted) parts.push(`<b>${r.wanted}</b> you both want to go`);
    if (r.theirLead) parts.push(`<b>${r.theirLead}</b> ${who} went, you want to go`);
    if (r.yourLead) parts.push(`<b>${r.yourLead}</b> you went, ${who} want${name ? 's' : ''} to go`);
    lines.push(parts.join(' \u00b7 '));
  } else {
    lines.push('no shared places yet');
  }
  if (r.alignedTags.length) {
    lines.push(`you both use <i>${r.alignedTags.slice(0, 2).map(escv).join('</i> and <i>')}</i> tags`);
  } else if (r.alignment < 0.25) {
    lines.push('your atlases cover different kinds of places');
  }
  if (r.expansionTags.length) {
    const d = escv(r.expansionTags[0]);
    const n = r.picks.filter(p => p.expands).length;
    lines.push(n
      ? `${escv(name) || 'they'} shared <b>${n}</b> <i>${d}</i> place${n > 1 ? 's' : ''} that may be new to you`
      : `${escv(name) || 'they'} shared more <i>${d}</i> places than you keep`);
  }
  return lines;
}

// A phrase that blended the counts back into prose stood here, unimported by
// anything, carrying a second set of thresholds of its own. Two lexicons for
// one measurement is one too many: the one that is read is `verdict` above,
// and the countable claims are `evidenceLines`.
