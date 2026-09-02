// marks.test.mjs — the reader that sets the documents in type.
//
// This is the one place in the whole app where text that was written as a
// document becomes markup on a page, so most of what follows is about the
// escaping rather than about the typography. The documents are ours, which
// lowers the stakes and does not remove them: a specification quotes byte
// formats, and `vault:<key>` looks exactly like an unclosed tag.
//
// The last group runs the real documents through, because a reader that
// handles invented input and mangles SPEC.md would be worse than none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, title, esc } from '../js/marks.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ---------- nothing a document says becomes something the page does ----------

test('a tag written in a document arrives as words', () => {
  const html = render('An <img src=x onerror=alert(1)> in the prose.');
  assert.ok(!html.includes('<img'), 'a tag survived');
  assert.ok(html.includes('&lt;img'), 'and it should be readable as text');
});

test('a script fence is printed, not run', () => {
  const html = render('```\n<script>alert(1)</script>\n```');
  assert.ok(!html.includes('<script'), 'a script tag survived a fence');
  assert.ok(html.includes('&lt;script&gt;'), 'the fence should show what it says');
});

test('a link to a script is left as the text it was', () => {
  const html = render('Press [here](javascript:alert(1)) now.');
  assert.ok(!html.includes('<a '), 'a javascript: url became a link');
  assert.ok(html.includes('[here]'), 'and the words should simply stand');
});

test('a link somewhere a browser can go is a link', () => {
  assert.match(render('[notes](NOTES.md)'), /<a href="NOTES\.md">notes<\/a>/);
  assert.match(render('[osm](https://openstreetmap.org)'), /<a href="https:\/\/openstreetmap\.org">osm<\/a>/);
  assert.match(render('[up](../index.html)'), /<a href="\.\.\/index\.html">up<\/a>/);
  assert.match(render('[mail](mailto:hello@example.test)'),
    /<a href="mailto:hello@example\.test">mail<\/a>/);
});

test('a link to a document this reader sets points at the reader', () => {
  // A document linking a sibling document writes the filename, and it is right
  // to: that link works in a checkout, on GitHub, and in a diff. On the site it
  // handed over the raw markdown, which is the one thing this file exists to
  // stop. The standards document really did link METHOD.md that way before
  // it was retired with the newsstand; the rule outlives its first offender.
  assert.match(render('The method is [written down](METHOD.md).'),
    /<a href="read\.html\?d=method">written down<\/a>/);
  assert.match(render('[the method](METHOD.md)'),
    /<a href="read\.html\?d=method">the method<\/a>/);
  assert.match(render('[the threats](/THREATS.md)'),
    /<a href="read\.html\?d=threats">the threats<\/a>/);

  // the specification lives in a directory here and at the root when served.
  // the reader knows it by name, so either address finds it.
  assert.match(render('[the bytes](club/SPEC.md)'),
    /<a href="read\.html\?d=spec">the bytes<\/a>/);
  assert.match(render('[the bytes](./SPEC.md)'),
    /<a href="read\.html\?d=spec">the bytes<\/a>/);

  // a link into a section keeps its place
  assert.match(render('[the count](METHOD.md#counting)'),
    /<a href="read\.html\?d=method#counting">the count<\/a>/);

  // a document this site does not set keeps exactly the link it was given
  assert.match(render('[notes](NOTES.md)'), /<a href="NOTES\.md">/);

  // and an address somewhere else is that address's own business, whatever it
  // happens to end in: this reader does not redirect other people's links.
  assert.match(render('[theirs](https://example.com/METHOD.md)'),
    /<a href="https:\/\/example\.com\/METHOD\.md">theirs<\/a>/);
});

test('a quote mark in a link cannot leave the attribute', () => {
  // the url is escaped before the anchor is built, so a quote is &quot;
  const html = render('[x](/a"onmouseover="alert(1))');
  assert.ok(!html.includes('onmouseover="alert'), 'an attribute was broken open');
});

test('the held code spans never survive into the page', () => {
  const html = render('One `a` two `b` three `c`.');
  assert.ok(!html.includes('\u0000'), 'a placeholder was left on the page');
  assert.equal((html.match(/<code>/g) || []).length, 3);
});

// ---------- the grammar the documents actually use ----------

test('a heading keeps its level', () => {
  assert.equal(render('# One'), '<h1>One</h1>');
  assert.equal(render('## Two'), '<h2>Two</h2>');
  assert.equal(render('#### Four'), '<h4>Four</h4>');
  assert.equal(render('#nospace'), '<p>#nospace</p>', 'a hash without a space is prose');
});

test('a paragraph is unwrapped, because the wrapping was for the editor', () => {
  assert.equal(render('one\ntwo\nthree'), '<p>one two three</p>');
  assert.equal(render('one\n\ntwo'), '<p>one</p>\n<p>two</p>');
});

test('emphasis, and a code span that is left alone inside it', () => {
  assert.equal(render('a **bold** word'), '<p>a <b>bold</b> word</p>');
  assert.equal(render('an *italic* word'), '<p>an <i>italic</i> word</p>');
  assert.equal(render('the `**not bold**` span'),
    '<p>the <code>**not bold**</code> span</p>',
    'emphasis ran inside a code span');
});

test('a code span holding angle brackets stays four characters', () => {
  assert.equal(render('the `vault:<key>` shape'),
    '<p>the <code>vault:&lt;key&gt;</code> shape</p>');
});

test('both kinds of list, and where they stop', () => {
  assert.equal(render('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(render('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  assert.equal(render('- a\n\nafter'), '<ul>\n<li>a</li>\n</ul>\n<p>after</p>');
  assert.equal(render('- a\n1. b'), '<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>',
    'one kind of list ran into the other');
});

test('a fence that was never closed still ends', () => {
  const html = render('```\nopen\nand never shut');
  assert.equal(html, '<pre><code>open\nand never shut</code></pre>');
});

test('nothing at all is nothing at all', () => {
  assert.equal(render(''), '');
  assert.equal(render(null), '');
  assert.equal(render(undefined), '');
  assert.equal(title(''), '');
});

test('the title is the document naming itself', () => {
  assert.equal(title('# The club, in bytes\n\nprose'), 'The club, in bytes');
  assert.equal(title('prose first\n\n# Later'), 'Later');
  assert.equal(title('## only a second level'), '');
});

test('escaping is total, and does not double back on itself', () => {
  assert.equal(esc('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(render('AT&T'), '<p>AT&amp;T</p>');
  assert.ok(!render('AT&amp;T').includes('&amp;amp;amp;'), 'escaping ran twice');
});

// ---------- the real documents ----------

const DOCS = ['club/SPEC.md', 'THREATS.md', 'METHOD.md', 'SECURITY.md'];

test('every published document sets without leaving markup behind', () => {
  for (const doc of DOCS) {
    const source = read(doc);
    const html = render(source);

    assert.ok(html.length > 200, `${doc} set to almost nothing`);
    assert.ok(!html.includes('\u0000'), `${doc} left a placeholder on the page`);

    // every tag the reader emits is one the reader is allowed to emit
    const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[1].toLowerCase());
    const allowed = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'b', 'i', 'code', 'pre', 'a']);
    for (const tag of new Set(tags)) {
      assert.ok(allowed.has(tag), `${doc} produced an unexpected <${tag}>`);
    }

    // the fences balance: an odd count would mean one swallowed the document
    const fences = (source.match(/^```/gm) || []).length;
    assert.equal(fences % 2, 0, `${doc} has an unclosed fence`);
    assert.equal((html.match(/<pre>/g) || []).length, fences / 2, `${doc} lost a code block`);

    // and the document says its own name
    assert.ok(title(source).length > 2, `${doc} has no first heading to be called by`);
  }
});

test('the specification survives its own byte shapes', () => {
  // SPEC.md is the hard one: it quotes storage keys that look like tags.
  // The shapes moved when the vault moved off KV, so this reads the ones that
  // exist now: a membership key, and the name a ciphertext object is written
  // under. Both carry angle brackets, which is the whole hazard.
  const html = render(read('club/SPEC.md'));
  assert.ok(html.includes('<code>member:&lt;key&gt;</code>'), 'a storage shape was not set as code');
  assert.ok(html.includes('&lt;forty-eight lowercase hex characters&gt;'),
    'the object name was not set as code');
  assert.ok(!/<key>/.test(html), 'a quoted shape became a tag');
});
