// mock.mjs — the club, pretended, for local work.
//
// The same doors and the same answers as the worker, held in memory, with
// Stripe replaced by a handshake: the payment desk makes its own sessions, and
// a pretended checkout page marks one paid and sends the browser home. Run it,
// point settings.clubUrl at it, and the whole membership can be walked from
// the join to the burn without an account anywhere.
//
//   node club/mock.mjs        (port 5179)

import http from 'node:http';
import {
  mintKey, isKey, isSecret, isCommitment, commitmentOf, standingOf, LIMITS, GRACE_S,
  routeFor, splitCap, isMsgId, isCapId,
} from './src/validate.js';
import { BOX_LIMITS, capIdOf } from './src/letterbox.js';

const members = new Map();  // key -> { sub, until, standing, site }
const subs = new Map();     // subId -> key
const sessions = new Map(); // session id -> { commitment, site, paid }

// The vault, in the two parts the worker keeps it in.
//
// The mock used to hold the envelope inline with its revision, which was the
// same shape the worker had then. The worker's vault is now a pointer object
// and a store of immutable ciphertext, and a mock that keeps the old shape
// cannot be walked through the failures the new one is built to survive. So
// this keeps both parts too: `heads` is what the durable object holds, `objects`
// is what R2 holds, and a seal here is an upload and then a rotation, in that
// order, exactly as it is over there.
const heads = new Map();   // key -> { rev, current: {id,bytes,at}, previous: {...}|null }
const objects = new Map(); // object name -> Buffer

// The letterboxes, kept the way the durable objects keep them: one per route,
// never per key, so a test that reaches a box has to arrive by an address it
// was actually given. `until` is the box's own copy of the recipient's
// paid-until, stamped when they authenticate, which is what lets a post be
// refused without the mock looking up whose box it is.
// caps are held by the same id the worker hands back, derived by the same
// function from src/letterbox.js: the mock is a different store and must never
// be a different protocol.
// `looks` is counted here and nowhere in the worker: it is how many times this
// box has been asked what it holds, which is the only way a test can tell an
// app that asked from an app that happened to be told. Nothing pushes and there
// is no timer, so a letter appearing on a screen proves only that some look
// happened, and a look four seconds after boot lands before the letter on one
// machine and after it on another. That race passed for a week.
const boxes = new Map();   // route -> { until, caps: Set<capId>, letters: Map<id,{bytes,at,body}>, looks }

// The same secret the real club derives keys and routes under. Here it is a
// constant rather than a secret, because the mock mints nothing anyone pays
// for; what matters is that routeFor is the same function on both sides.
const MINT = 'mock-mint-secret';

const boxAt = route => {
  if (!boxes.has(route)) boxes.set(route, { until: 0, caps: new Set(), letters: new Map(), looks: 0 });
  return boxes.get(route);
};

const POST_REFUSALS = {
  nobox: 'there is no box at that address. ask for a fresh introduction',
  notaletter: 'that is too short to be a letter',
  closed: 'that box is closed. its membership has lapsed, and it takes nothing until it comes back',
  nocap: 'that introduction has been withdrawn. ask for a fresh one',
  again: 'that letter is already waiting there',
  full: 'that box is full. it holds fifty letters and they have to be read first',
  heavy: 'that box has no room left. four megabytes is all of it',
  big: 'that letter is too big to post. a quarter of a megabyte is the most one carries',
};

// Where the next seal is told to die.
//
// A club that only ever works is a club whose recovery has never been seen. A
// browser cannot unplug a worker halfway, so the mock is asked to stop at a
// named moment instead: after the bytes are written and before the pointer
// moves, or after the pointer moves and before the answer is sent. Both are
// the real orders of events, and both are supposed to be survivable.
//
// One shot, and only on the mock. The worker has no such lever and never will.
let dieAt = '';
// how many seals actually arrived, which is not always how many were sent: a
// browser may retry a put whose connection died before any answer came back,
// and a test that assumes one attempt is measuring its own assumption
let seals = 0;

// What this desk says it is, and the fifth lever the real club does not have.
//
// The worker reads its mode off the shape of the Stripe secret it was handed;
// the mock has no secret and no Stripe, so it holds the answer as a value and
// lets a test set it. That is the whole point of it being here: the dangerous
// case is a live desk under an app that says nothing is charged, and the only
// way to walk that case is to be able to say so.
let desk = { live: false, price: 'price_mock', ready: true };

// How long the club takes to say what it is holding.
//
// The club room paints before it has heard back, and what it paints is a
// guess. A test that wants to see the room mid-guess cannot ask for the gap:
// it is a few milliseconds wide on a machine doing nothing, and it opened on
// two runs in seventy-five. So the mock is asked to be slow on purpose, and
// the race becomes a wait, which is a thing a test can state.
//
// Reads only. A slow write would be a different lever and no test wants one.
let slowMs = 0;
const hold = () => (slowMs ? new Promise(f => setTimeout(f, slowMs)) : null);

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const newRev = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const newObjectName = key => `vault/${key}/${hex(crypto.getRandomValues(new Uint8Array(16)))}`;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,if-match,if-none-match,x-cap',
  'access-control-expose-headers': 'x-sealed-at,x-arrived-at,etag',
};

const send = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...headers });
  res.end(JSON.stringify(obj));
};

const read = req => new Promise(resolve => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const nowS = Math.floor(Date.now() / 1000);

  // what this desk is. no key is needed to reach it, as at the worker
  if (url.pathname === '/desk' && req.method === 'GET') {
    return send(res, 200, { ...desk });
  }
  if (url.pathname === '/desk' && req.method === 'POST') {
    // the lever: `?live=1` makes this desk claim to be taking real money, which
    // is the one state the app must refuse to put a card into
    for (const [k, cast] of [['live', v => v === '1'], ['ready', v => v === '1'], ['price', String]]) {
      const v = url.searchParams.get(k);
      if (v !== null) desk[k] = cast(v);
    }
    return send(res, 200, { ...desk });
  }

  // the payment desk. no key is needed to reach it, as at the worker, and it
  // writes the commitment onto the session exactly as Stripe's metadata holds it
  if (url.pathname === '/checkout' && req.method === 'POST') {
    let body; try { body = JSON.parse((await read(req)).toString()); } catch { return send(res, 400, { error: 'json' }); }
    if (!isCommitment(body?.claim)) return send(res, 400, { error: 'that is not a commitment' });
    const site = String(req.headers.origin || 'http://localhost:5178').replace(/\/$/, '');
    const session = `cs_mock${hex(crypto.getRandomValues(new Uint8Array(8)))}`;
    sessions.set(session, { commitment: body.claim, site, paid: false });
    return send(res, 200, { session, url: `http://localhost:5179/pay?session=${session}` });
  }

  // the pretended checkout page: it takes no card, marks the session paid, and
  // sends the browser home the way Stripe's success url does
  if (url.pathname === '/pay' && req.method === 'GET') {
    const session = String(url.searchParams.get('session') || '');
    const s = sessions.get(session);
    if (!s) { res.writeHead(404, CORS); return res.end('no such session'); }
    s.paid = true;
    res.writeHead(302, { location: `${s.site}/?club=${session}`, ...CORS });
    return res.end();
  }

  if (url.pathname === '/door' && req.method === 'POST') {
    let body; try { body = JSON.parse((await read(req)).toString()); } catch { return send(res, 400, { error: 'json' }); }
    const session = String(body?.session || '');
    const secret = String(body?.secret || '');
    if (!isSecret(secret)) return send(res, 400, { error: 'that is not what opens a door' });
    const s = sessions.get(session);
    if (!s || !s.paid) return send(res, 403, { error: 'the door only opens on a paid subscription' });
    // the whole point of the commitment: the device that began this session is
    // the device that is handed the key, and no other
    if (s.commitment !== await commitmentOf(secret)) {
      return send(res, 403, { error: 'this membership was begun on another device, and only that device holds what opens it' });
    }
    // the mock has no Stripe, so a session stands for its own subscription
    const sub = `sub_${session}`;
    const known = subs.get(sub);
    if (known) return send(res, 200, { key: known, until: members.get(known).until, again: true });
    const key = mintKey(crypto.getRandomValues(new Uint8Array(16)));
    const until = nowS + 30 * 24 * 3600;
    members.set(key, { sub, until, standing: 'good', cus: `cus_mock${sub}`, site: s.site });
    subs.set(sub, key);
    return send(res, 200, { key, until });
  }

  // The third lever the real club does not have, and the only one that belongs
  // to nobody: it is a property of this process rather than of a membership,
  // so it stands above the key check with the payment desk.
  if (url.pathname === '/slow' && req.method === 'POST') {
    slowMs = Math.max(0, Math.min(10_000, Number(url.searchParams.get('ms')) || 0));
    return send(res, 200, { slowMs });
  }

  const auth = req.headers.authorization || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!isKey(key) || !members.has(key)) return send(res, 401, { error: 'no key' });
  const member = members.get(key);
  const standing = standingOf(member, nowS);

  if (url.pathname === '/membership' && req.method === 'GET') {
    return send(res, 200, { standing, until: member.until, leaving: false });
  }
  if (url.pathname === '/portal' && req.method === 'POST') {
    if (!member.cus) return send(res, 409, { error: 'this membership has no billing account on file' });
    // stripe's portal, pretended: it returns where it would have sent them back to
    return send(res, 200, { url: `${member.site || 'http://localhost:5178'}/?club=back` });
  }
  if (url.pathname === '/lapse' && req.method === 'POST') {
    // a lever the real club does not have: for trying the lapsed state
    member.until = nowS - GRACE_S - 10;
    return send(res, 200, { lapsed: true });
  }
  if (url.pathname === '/die' && req.method === 'POST') {
    // the second lever the real club does not have: where the next seal stops
    dieAt = String(url.searchParams.get('at') || '');
    if (url.searchParams.get('reset')) seals = 0;
    return send(res, 200, { dieAt, seals });
  }
  if (url.pathname === '/die' && req.method === 'GET') {
    return send(res, 200, { dieAt, seals });
  }
  if (url.pathname === '/looks' && req.method === 'GET') {
    // the fourth lever the real club does not have: how many times this box has
    // been asked what it holds. It is read and never reset, and reading it does
    // not count as a look, so a test can bracket one gesture and state what it
    // cost. It answers before the letterbox block below because it is a
    // question about this box rather than a door into it.
    //
    // `boxes.get` rather than `boxAt`, because a lever that measures must not
    // also make: boxAt creates the box it is asked about, and a box that exists
    // because somebody counted it is a box a later refusal cannot refuse.
    return send(res, 200, { looks: boxes.get(await routeFor(key, MINT))?.looks || 0 });
  }
  // ---- the letterbox ----
  //
  // Every route sits below the key check above, which is decision 3 in the same
  // place the worker puts it: a direct exchange needs both people in the club.
  if (url.pathname === '/letters' || url.pathname.startsWith('/letters/')) {
    const mine = await routeFor(key, MINT);
    const rest = url.pathname.slice('/letters'.length).replace(/^\//, '');

    if (rest === 'post' && req.method === 'POST') {
      if (standing !== 'good') return send(res, 402, { error: 'the membership has lapsed' });
      const cap = splitCap(req.headers['x-cap']);
      if (!cap) return send(res, 400, { error: 'that is not an address this club can deliver to' });
      const id = url.searchParams.get('id') || '';
      if (!isMsgId(id)) return send(res, 400, { error: 'a letter is posted under its own message id' });
      const body = await read(req);
      const refuse = why => send(res, { nobox: 404, closed: 403, nocap: 403, again: 409, full: 507, heavy: 507, big: 413, notaletter: 400 }[why], { error: POST_REFUSALS[why] });
      if (body.length > BOX_LIMITS.letterBytes) return refuse('big');
      if (body.length < BOX_LIMITS.least) return refuse('notaletter');
      // absent and closed are two different sentences, and the difference is
      // whether the box exists at all rather than what date it holds
      const box = boxes.get(cap.route);
      if (!box) return refuse('nobox');
      if (!box.until || nowS > box.until + GRACE_S) return refuse('closed');
      if (!box.caps.has(await capIdOf(cap.secret))) return refuse('nocap');
      if (box.letters.has(id)) return refuse('again');
      if (box.letters.size >= BOX_LIMITS.count) return refuse('full');
      const held = [...box.letters.values()].reduce((a, l) => a + l.bytes, 0);
      if (held + body.length > BOX_LIMITS.total) return refuse('heavy');
      box.letters.set(id, { bytes: body.length, at: Date.now(), body });
      return send(res, 200, { posted: true, waiting: box.letters.size });
    }

    if (rest === '' && req.method === 'GET') {
      const box = boxAt(mine);
      box.looks += 1;
      if (standing === 'good') box.until = Math.max(box.until, member.until);
      const letters = [...box.letters.entries()]
        .map(([id, l]) => ({ id, bytes: l.bytes, at: l.at }))
        .sort((a, b) => a.at - b.at);
      return send(res, 200, {
        route: mine, letters, caps: [...box.caps],
        count: letters.length, bytes: letters.reduce((a, l) => a + l.bytes, 0), until: box.until,
      });
    }

    if (rest === 'cap' && req.method === 'POST') {
      if (standing !== 'good') return send(res, 402, { error: 'the membership has lapsed' });
      const box = boxAt(mine);
      box.until = Math.max(box.until, member.until);
      if (box.caps.size >= BOX_LIMITS.caps) {
        return send(res, 429, { error: 'this box already has as many correspondents as it holds' });
      }
      const secret = mintKey(crypto.getRandomValues(new Uint8Array(16))).slice(3);
      const id = await capIdOf(secret);
      box.caps.add(id);
      return send(res, 200, { cap: `${mine}.${secret}`, id });
    }

    if (rest.startsWith('cap/') && req.method === 'DELETE') {
      const id = rest.slice(4);
      if (!isCapId(id)) return send(res, 400, { error: 'that is not a correspondent of this box' });
      const box = boxAt(mine);
      if (!box.caps.delete(id)) return send(res, 404, { error: 'that correspondent is not on this box' });
      return send(res, 200, { revoked: true });
    }

    if (isMsgId(rest) && req.method === 'GET') {
      const got = boxAt(mine).letters.get(rest);
      if (!got) return send(res, 404, { error: 'no letter of that name is waiting' });
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'x-arrived-at': String(got.at),
        ...CORS,
      });
      return res.end(got.body);
    }

    if (isMsgId(rest) && req.method === 'DELETE') {
      if (!boxAt(mine).letters.delete(rest)) return send(res, 404, { error: 'no letter of that name is waiting' });
      return send(res, 200, { gone: true });
    }

    if (rest === '' && req.method === 'DELETE') {
      boxes.delete(mine);
      return send(res, 200, { gone: true });
    }

    return send(res, 404, { error: 'nothing lives here' });
  }

  if (url.pathname === '/vault') {
    if (req.method === 'PUT') {
      seals += 1;
      if (standing !== 'good') return send(res, 402, { error: 'the membership has lapsed' });
      // the body is drained first so keep-alive stays honest, then the
      // preconditions decide, in the same order the worker decides them
      const buf = await read(req);
      const head = heads.get(key);
      const rev = head?.rev || '';
      const tag = rev ? { etag: `"${rev}"` } : {};
      const ifMatch = req.headers['if-match'];
      const ifNone = req.headers['if-none-match'];
      if (ifMatch !== undefined) {
        if (!rev || ifMatch.trim() !== `"${rev}"`) {
          return send(res, 412, { error: 'the vault has moved on. read it again and seal over what it now holds' }, tag);
        }
      } else if (ifNone !== undefined) {
        if (ifNone.trim() !== '*') return send(res, 400, { error: 'if-none-match takes a star and nothing else' });
        if (rev) return send(res, 412, { error: 'the vault already holds an envelope' }, tag);
      } else {
        return send(res, 428, { error: 'a seal must say what it replaces: if-match, or if-none-match: *' }, tag);
      }
      if (buf.length < 24) return send(res, 400, { error: 'not sealed' });
      if (buf.length > LIMITS.vaultBytes) return send(res, 413, { error: 'too large' });

      // upload, then rotate. the two moments a seal can die between are named
      // here because they are the two the design says are survivable.
      const at = new Date().toISOString();
      const name = newObjectName(key);
      objects.set(name, buf);
      if (dieAt === 'upload') {
        // the response socket, not the request: destroying the request leaves
        // the client waiting on an answer that will never come, which is a hang
        // rather than a failure, and a hang is not what a worker dying looks
        // like from the other end
        dieAt = '';
        res.destroy();
        return;
      }
      const evicted = head?.previous?.id || null;
      heads.set(key, {
        rev: newRev(),
        current: { id: name, bytes: buf.length, at },
        previous: head?.current || null,
      });
      if (evicted) objects.delete(evicted);
      const meta = { bytes: buf.length, at, rev: heads.get(key).rev };
      if (dieAt === 'commit') {
        // the rotation landed and the answer never arrived. the member's device
        // holds a revision that has moved, and must find that out by asking.
        dieAt = '';
        res.destroy();
        return;
      }
      return send(res, 200, meta, { etag: `"${meta.rev}"` });
    }
    if (req.method === 'GET') {
      await hold();
      const head = heads.get(key);
      const wantPrev = !!url.searchParams.get('prev');
      const slot = wantPrev ? head?.previous : head?.current;
      if (!slot) return send(res, 404, { error: 'empty' });
      const buf = objects.get(slot.id);
      if (!buf) return send(res, 503, { error: 'the club cannot read that envelope back' });
      const headers = {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'x-sealed-at': slot.at,
        ...CORS,
      };
      if (!wantPrev) headers.etag = `"${head.rev}"`;
      res.writeHead(200, headers);
      return res.end(buf);
    }
    if (req.method === 'DELETE') {
      const head = heads.get(key);
      for (const id of [head?.current?.id, head?.previous?.id].filter(Boolean)) objects.delete(id);
      heads.delete(key);
      return send(res, 200, { gone: true });
    }
  }
  return send(res, 404, { error: 'nothing lives here' });
}).listen(5179, () => console.log('the pretended club stands at http://localhost:5179'));
