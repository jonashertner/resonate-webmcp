// marks.js — the documents, set in type.
//
// The specification, the threats, the method and the standards are written in
// markdown, and they stay that way: it is the form a person auditing this
// wants, it is what a repository diffs cleanly, and SECURITY.md is a name
// GitHub itself looks for. But a link that hands someone a file to download is
// a link nobody presses, so the same source is set here instead. One source,
// two readings, and no copy that can drift out of step with the other.
//
// A reader written here rather than a library, for one reason: the grammar
// these documents use fits on a page. Headings, fenced code, inline code,
// bold, italic, two kinds of list, and paragraphs. Every rule below is tested
// against the real documents, which is worth more than a general parser
// nothing here exercises.
//
// The order is the only subtle thing. Everything is escaped before any rule
// runs, so no markup written in a document can become markup on the page, and
// code spans are lifted out before the emphasis rules so that `vault:<key>`
// stays the four characters it says rather than an unclosed tag.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// A document may point somewhere, but only somewhere a browser can safely go.
// A scheme is not a detail: javascript: in a link is a script, and this reader
// is the one place a document's own words become a page.
const goodHref = (u) => /^(https?:\/\/|mailto:[^\s@]+@[^\s@]+|\.{0,2}\/|#|(?:[\w.-]+\/)*[\w.-]+\.md(\?|#|$)|[\w.-]+\.(html|txt)(\?|#|$))/i.test(u);

// The word a link uses after ?d=, and the file it means. A name out of the
// address bar is never a path: this list is the only way to name a file, so no
// ../ and no other origin can be asked for, whatever is typed. It lives here
// rather than in the page that reads it, because the same list decides the
// question below, and two copies of it would be one copy too many.
export const PAGES = {
  spec: 'SPEC.md',
  threats: 'THREATS.md',
  method: 'METHOD.md',
  security: 'SECURITY.md',
  assistant: 'ASSISTANT-ACCESS.md',
  terms: 'TERMS.md',
  privacy: 'PRIVACY.md',
  support: 'SUPPORT.md',
};

// The documents that are published before they are true.
//
// Empty, and the emptiness is the point rather than an oversight. Two documents
// stood here for as long as they said PUT-THE-LEGAL-NAME-HERE where a seller
// belongs: reachable, so the people helping to get them right could read them,
// and behind a word, so that nobody met a contract with a hole in it. The last
// placeholder is filled, so the curtain comes down.
//
// The mechanism stays, and it stays because the next unfinished document will
// arrive the same way. A test binds this list to the reason for it in both
// directions: a document with a placeholder left in it must be named here, and
// a document with none must not be, so filling the last placeholder is what
// takes the curtain down rather than somebody remembering to.
//
// The word was never a lock and this was never access control. The site is
// static, there is no server here to refuse anything, and the file keeps its own
// address for anyone who asks for it directly. What it stopped was a search
// engine and a passer by. It stopped nobody who looked, and it was not written
// down anywhere as though it did.
export const UNFINISHED = [];

// A word this site once answered to, and the word it means now. This is not a
// eighth document, which is why it is not in the list above: nothing links
// here, nothing offers it, and it names no file of its own.
//
// It exists because an address was written into files that left. Every copy
// handed to an assistant before this release carries
// `terms: ".../read.html?d=agents"` inside it, and those files are somewhere
// this app cannot reach. Renaming the document turned every one of those
// addresses into "Nothing here", which is the worst answer a contract can give:
// the file says what it is held to, and the address it names denies it.
//
// The lesson is worth stating once rather than relearning. A word that only
// ever appeared in the source can be renamed freely. A word written into a
// portable file has left, and keeping it answering is part of the format from
// then on. This one costs a line and is kept indefinitely.
export const PAGE_ALIASES = {
  agents: 'assistant',
};

const DOCUMENTS = new Map(Object.entries(PAGES).map(([word, file]) => [file.toLowerCase(), word]));

// The documents point at one another the way a repository expects: a link to
// METHOD.md written inside THREATS.md is right in a checkout, right on GitHub,
// and right in a diff. It is wrong on the site, where following it hands the
// reader the raw markdown and undoes the one thing this file exists to do. So a
// link naming a document this reader sets becomes that document, set. One
// source, two readings, again.
//
// Only a relative link. An absolute url belongs to whoever it names, and is
// left exactly as it was written even when it ends in the same five letters.
function reroute(url) {
  if (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith('//')) return url;
  const path = url.replace(/[?#].*$/, '');
  const word = DOCUMENTS.get(path.slice(path.lastIndexOf('/') + 1).toLowerCase());
  if (!word) return url;
  const fragment = /#.*$/.exec(url);   // a link into a section keeps its place
  return `read.html?d=${word}${fragment ? fragment[0] : ''}`;
}

// A held code span is marked with a null character while the emphasis rules
// run over the rest of the line. It cannot occur in a document that arrived as
// text, which is what makes it safe to borrow, and it never survives: the last
// rule puts every span back.
const HOLD = '\u0000';

function inline(text) {
  const held = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, code) => `${HOLD}${held.push(code) - 1}${HOLD}`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, words, url) =>
    (goodHref(url) ? `<a href="${reroute(url)}">${words}</a>` : whole));
  return s.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_, i) => `<code>${held[+i]}</code>`);
}

// what interrupts a paragraph: a fence, a heading, or either kind of list
const BREAKS = /^(```|#{1,4}\s|[-*]\s|\d+\.\s)/;

export function render(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  const shut = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const open = (kind) => { if (list !== kind) { shut(); out.push(`<${kind}>`); list = kind; } };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      shut();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      // a fence the document never closed still ends here, at the last line,
      // rather than swallowing the rest of the page into a grey box
      i += 1;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      shut();
      const level = head[1].length;
      out.push(`<h${level}>${inline(head[2])}</h${level}>`);
      i += 1;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) { open('ul'); out.push(`<li>${inline(bullet[1])}</li>`); i += 1; continue; }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) { open('ol'); out.push(`<li>${inline(numbered[1])}</li>`); i += 1; continue; }

    if (!line.trim()) { shut(); i += 1; continue; }

    // These documents are wrapped for the person editing them, not for the
    // person reading them, so a paragraph runs to the blank line and the
    // wrapping is thrown away.
    shut();
    const para = [];
    while (i < lines.length && lines[i].trim() && !BREAKS.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  shut();
  return out.join('\n');
}

// the first heading, for the tab: a document should not be called Resonate
// when it has told you its own name on its first line
export function title(md) {
  const m = /^#\s+(.*)$/m.exec(String(md == null ? '' : md));
  return m ? m[1].trim() : '';
}
