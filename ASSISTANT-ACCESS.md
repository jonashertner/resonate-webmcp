# An atlas, read by a machine

This is the contract for anything that is not a person reading a Resonate atlas. It is short
because the surface is small on purpose, and the smallness is the point.

## What there is

Two doors, one disclosure.

In a browser that supports WebMCP, one zero-data tool named
`review_assistant_access` is available before consent. It accepts no input, returns no atlas
data, and can only open a dedicated in-app review; it cannot grant access. If the person has
not yet chosen how to start the atlas, it brings that human setup forward and asks the agent
to retry afterward, still without reading data. If the person
presses **Allow access**, the browser replaces that review tool with five data tools. They can
summarize and search the atlas, including the recommendation trail on disclosed records, show
one item, or prepare a place or a collection on screen. Those five tools are registered only after
that choice, only in this page, and never for another origin. The choice remains on in this
browser until the person presses **Stop access**. Turning it off unregisters the five tools and
restores only the zero-data review tool.
Most browsers do not support this proposed interface yet, and nothing is implied when it is
absent.

In every browser, a person can open **assistant copy** under *export formats*, review the
disclosure, and download one document themselves. Nothing is downloaded on the first press.

Both doors read the atlas a person hands a friend: the same records and the same fields,
chosen by the same function under the same rules. An assistant is given what a friend is
given, and not one field more. The file adds only facts about the copy: when it was written,
and the terms it was handed over under. The browser tools add no account, server address,
background process, key, or cross-origin exposure.

That is the promise, and it is checked rather than asserted. If it ever stops being true,
this document is wrong and the code is the thing to trust.

```json
{
  "app": "resonate",
  "kind": "assistant_copy",
  "exportedAt": "2026-08-10T09:12:44.108Z",
  "terms": "https://resonate.select/read.html?d=assistant",
  "disclosure": {
    "v": 6,
    "kind": "atlas",
    "author": "",
    "tags":   [{ "id": "", "name": "", "emoji": "", "color": "" }],
    "places": [{ "id": "", "name": "", "lat": 0, "lng": 0, "address": "", "city": "",
                 "country": "", "countryCode": "", "tags": [], "status": "", "rating": 0,
                 "note": "", "url": "", "prov": [{ "name": "", "at": "" }] }],
    "routes": [{ "id": "", "name": "", "city": "", "country": "", "tags": [], "status": "",
                 "rating": 0, "note": "", "url": "", "km": 0, "ascent": 0, "descent": 0,
                 "high": 0, "low": 0, "hours": 0, "loop": false,
                 "path": [{ "lat": 0, "lng": 0, "ele": 0 }] }],
    "books":  [{ "id": "", "title": "", "author": "", "year": "", "placeId": "",
                 "tags": [], "status": "", "note": "", "url": "",
                 "prov": [{ "name": "", "at": "" }] }]
  }
}
```

`v` is 6 when no books ride, and 8 when they do, so a build that has never heard of a shelf
refuses the whole file out loud rather than keeping the places and dropping the books in
silence. A book's `author` is the writer of the book, not a byline. `year` is a string,
because a year on a shelf is something a person wrote rather than something to do sums on.
`placeId` names the place the book answers to, and it appears only when that place is in the
same disclosure: a book tied to a place that was not handed over arrives free, carrying no
pointer to what was withheld. `status` on a book reads `visited` as read, under the same
first-person rule as everything else.

Read `kind` before anything else. It is there so that nothing has to be inferred from shape:
`assistant_copy` is this file, `atlas` is a handover a person sent to a person, and a private
archive says `version` instead. The atlas is nested under `disclosure` for the same reason.
Anything this copy grows in a later release grows beside `disclosure` and never inside it, so
a field meant for an assistant can never arrive looking like part of what a person shares.

`path` is the disclosed walk in full, point by point, in the order it was walked. `ele` is
metres above sea level and is absent where no reading was taken. A copy like this one has
room for the whole shape. A handover sent as a link does not, and carries a coarser encoded
line under `p` instead, so a route read out of a link and a route read out of this file are
the same walk at two resolutions.

`prov`, on a place or a book, is the road that record travelled to reach this atlas: the
people who each kept it before, oldest first, each with the date they took it. A route
carries no `prov` at all.

The browser overview counts the names that occur on those disclosed roads. Browser search can
narrow by an exact `recommended_by` name and returns at most the four nearest steps of a
matching road. Those names and dates were already in the reviewed disclosure; the tools do not
read the separate People list or anything kept beneath a person.

## What it does not contain, so absence is never read as absence

A place, path, or book marked **Excluded from sharing**. A book's tie to a place the file does not itself
carry. Every voice, and
everything kept under one. Every folio. Another person's atlas. Any top-level byline but the
person's own. The first and last 250 m of any path marked **Start and end hidden when shared**, and
any such path too short to lose it. Dates a record was made or touched. Photographs, which
this app does not keep at all. Every setting, and the club key.

**Excluded from links, shared files, direct messages, print, and assistant access. Included in private backups.**

A record is the one place where another person's name can still appear, and it is not an
exception to the line above. `author` is the byline of the person handing this file over, and
there is only ever one of those. `prov`, on a record, is the road that record travelled to
reach them: the people who each kept it before. That road is part of the record, and the
person chose to hand the record over.

If a city holds no places here, that means the file was not given them. It does not mean the
person has never been.

## The one thing that may not be said

**`status: "visited"` is a first-person claim by the person whose atlas this is. A byline may
name them, but a byline is not required. Nobody else may make that claim for them.**

An assistant has been nowhere. It has stood in no doorway, waited for no table, and walked no
path. It may report what a person said. It may not say it, and it may not write a record that
says it on their behalf. The same holds for anything that means the person went, stayed,
returned, loved or would return.

This is not a style rule. The whole of this app's matching rests on a person having actually
been somewhere: two atlases are compared by where both people have stood. A machine-written
"visited" is not a small inaccuracy, it is a false witness inside the one measurement the
product is for.

What may be said instead: what was found, in named sources; what a named person said, quoted;
what was checked, and on what date.

## What may be proposed

The browser tools take a proposal and never an edit. A place proposal is drawn on the map
and laid out field by field. A person reads it and presses **Add to my atlas** before a
record exists. It begins as *want to go*. A collection proposal opens the ordinary composer;
closing it untouched saves nothing, and sharing remains a separate review and press.

A proposal may reach: a name, a point, an address, a city, a country, a link, a line about
the place, and the words it is filed under.

A proposal may never reach: whether a person has been somewhere, what they thought of it, the
shape of a walk they took, how far or how high it was, whether a record is included in sharing,
who handed it to them, or when they first kept it.

A recorded path is the strongest case and it is refused structurally rather than by rule: a
path is a recording of where a body went, and a record with fewer than two real points is not
a path at all.

## What these doors are for

Reading. Answering a question about places a person already keeps. Preparing something they
will read and decide about.

That is what the person is providing access for. The file's `terms` address records the
instruction. Recording it is the whole of what a file can do. A sentence written in JSON
cannot stop whoever holds the file from copying it, keeping it, training on it or processing
it in any other way, and a copy already handed over cannot be recalled. What is written here
is what was asked for. It is not a restriction this file is able to impose.

The direct tools label every returned atlas field as untrusted content, cap each result, and
expose nothing cross-origin. Those are signals and bounds, not a cure for prompt injection.
Whoever provides the browser assistant may still process or retain what it reads under their
own terms. Permission here is permission to disclose this slice of the atlas to that
assistant; it is not a promise about what the assistant does afterwards.

Each result is a native, versioned object. It says whether the call succeeded, what it did,
whether the visible view changed, and separately whether anything was saved or shared.
Expected refusals are returned with a short machine-readable reason instead of disappearing
behind a browser's generic error. Search returns a cursor when more disclosed matches remain;
that cursor belongs to the exact search and exact disclosed result set, and is refused if
either has changed. Every input is checked again by Resonate because a browser's schema is a
description, not an authorization boundary.

The browser may cancel an individual call at any time. Resonate also checks the active consent
session before and after every call. Entering the back-forward cache ends that session; on
return, the durable setting is read before tools can be registered again. This keeps a call
queued by a suspended page from outracing a revocation made in another tab.

## Where the rest is written

[The method by which two atlases are compared](METHOD.md), [the threats this app
answers](THREATS.md), and [the exact bytes of the encrypted backup](SECURITY.md) are each
written down and served as pages.
