// map.js — the field: inked tiles, resonance marks, the ripple, correspondents

/* global L */

// CARTO began marking anonymous tiles on 2026-08-26. This browser-delivered
// key is visible to visitors and dedicated to this site; do not reuse it.
// One value serves both drawings so day and night cannot drift apart again.
const CARTO_KEY = 'cb1_2nhv_1_bcb72a392063a741c117917e'; // gitleaks:allow — public browser credential
const TILE = {
  light: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
  dark: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
};

// A retina tile carries roughly four times as many pixels. Keep that detail on
// ordinary connections; use the standard drawing only when the browser has
// explicitly said that data is scarce. Network Information is not present in
// every engine, so absence means no downgrade rather than a guess.
export function useStandardTileDensity(connection = (
  typeof navigator === 'undefined' ? null
    : navigator.connection || navigator.mozConnection || navigator.webkitConnection
)) {
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  return connection?.saveData === true
    || effectiveType === 'slow-2g'
    || effectiveType === '2g'
    || effectiveType === '3g';
}

export function cartoTileTemplate(mode, connection) {
  const template = TILE[mode] || TILE.light;
  return useStandardTileDensity(connection) ? template.replace('{r}', '') : template;
}

const RM = matchMedia('(prefers-reduced-motion: reduce)');

// how close two marks have to be before the field gathers them into one ring.
// named once, because the press that opens a ring has to be decided against
// the same number that closed it.
const CLUSTER_R = 44;

let map;
let tileLayer;
let clusterGroup;
let corrLayer;
let routeLayer;
let routeCursor;
const routesById = new Map();
const markersById = new Map();
const nameById = new Map();
let labelDirections = new Map();
let selectedIdRef = null;
let labelRevealFrame = 0;

// Leaflet puts the named point fourteen pixels from its tooltip and its own
// direction class contributes another six. The offset is ours; the margin is
// read from the live tooltip rule below so a vendor change cannot quietly make
// this arithmetic stale. Eight pixels around the glass and its fixed words is
// the same small breath the type needs visually, not merely a collision test.
const LABEL_OFFSET = 14;
const LABEL_CLEARANCE = 8;

export function initMap({ onMarkerClick, onCorrClick, onLongPress, onPointerMove, onViewChange }) {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true,
    zoomSnap: 0.5,
    minZoom: 2,
    maxZoom: 20,
    maxBounds: [[-85, -540], [85, 540]],
    maxBoundsViscosity: 0.8,
    // An uncapped fast swipe can coast for more than ten seconds in WebKit:
    // the field has stopped feeling attached to the hand long before then,
    // and settled labels cannot safely return while it is still moving.
    inertiaMaxSpeed: 900,
    fadeAnimation: false,
  });
  map.setView([32, 8], 2.5);

  // Somebody else's marks stand under your own, and under a ring.
  //
  // Leaflet stacks one pane by how far south a thing sits, so what is on top
  // of what was being decided by a few metres of latitude between two layers
  // that have nothing to do with each other. Two things came of that, and both
  // were reported as the same sentence: pressing a place went to the wrong one.
  //
  // A voice's marks never gather, by design: the floor below hides them at
  // world zoom rather than giving the field a second kind of circle. So a
  // voice's mark is a single mark at full size standing next to a ring, and a
  // held place is by definition at an address you already carry. Twenty metres
  // down the street from a ring is three pixels at street zoom, which is inside
  // the twenty two pixel circle a mark answers to and one rank above it. The
  // ring's own centre was somebody else's mark, and the press that should have
  // opened the ring opened a plate instead. A ring cannot be covered: it is the
  // only thing on the field that stands for more than one place, and nothing
  // that stands for one may answer in its place.
  //
  // The same tie decided a shared address by document order, which is to say by
  // accident: two marks on one point, and the one that answered was the one
  // whose layer happened to be added last. It was a voice. On your own field
  // your own record answers first; theirs is in voices, filed under the person,
  // which is where somebody goes to read what somebody else said.
  //
  // A floor of its own settles both, once, rather than at every latitude.
  // markerPane is 600 and holds the marks and the rings.
  map.createPane('corrPane');
  map.getPane('corrPane').style.zIndex = 580;

  clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: CLUSTER_R,
    // the legs of an opened ring, drawn in the field's own ink. the plugin's
    // default is a hardcoded #222, which is a dark line on a dark ground: on
    // the night theme the marks fanned out and appeared to be attached to
    // nothing.
    spiderLegPolylineOptions: { weight: 1, opacity: 1, className: 'spider-leg' },
    spiderfyOnMaxZoom: true,
    zoomToBoundsOnClick: false,
    iconCreateFunction(cluster) {
      const n = cluster.getChildCount();
      const s = n < 10 ? 36 : n < 50 ? 42 : 48;
      // The plugin creates the keyboard button *after* asking for its icon.
      // Name that outer button on the next task: the labelled drawing inside
      // it is not used as the button's accessible name by any of the three
      // browser engines.
      setTimeout(() => {
        const el = cluster.getElement?.() || cluster._icon;
        if (el) {
          const label = `${n} places here, together`;
          el.setAttribute('aria-label', label);
          el.setAttribute('title', label);
        }
      }, 0);
      return L.divIcon({
        html: `<div class="station" role="img" aria-label="${n} places here, together">
            <svg width="${s}" height="${s}" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="17.5" class="st-ring"/>
            </svg><span class="station-n">${n}</span></div>`,
        className: 'station-icon',
        iconSize: [s, s],
      });
    },
  });
  map.addLayer(clusterGroup);

  // A ring that is pressed comes apart. Every time, with no second guess.
  //
  // It did not, and the reason was two decisions that only bite together.
  // `zoomToBoundsOnClick: false` turns off markercluster's own click handler
  // so the fly below can carry the overlay's padding, and that handler is also
  // the only thing that ever spiders a ring open: it decides between zooming
  // and spidering, and switching it off kept the zoom and threw the spider
  // away. Then the fly was capped at zoom 16, where the ring still gathers
  // anything within about seventy-five metres. So pressing a ring over two
  // restaurants on one street flew you there, landed, and left the same ring
  // sitting on top of them. The app looked like it had picked one place and
  // gone to it, which is exactly what a person would report seeing.
  //
  // The rule now is measured rather than guessed, and it is measured at the
  // deepest zoom the ring could ever be flown to. `getBoundsZoom` is already
  // clamped by the map's own maximum, so projecting the ring's corners there
  // says in pixels what the fly would actually achieve. If the whole ring
  // still fits inside the radius that gathered it, no zoom will separate it
  // and the only honest answer is to lay the marks out around the ring.
  //
  // Asking whether a deeper zoom EXISTS is the wrong question, and was tried
  // first: a ring over three doors a metre apart can always be flown deeper,
  // and arriving there changes nothing. One press has to be enough, or the
  // person presses a second time on a ring that looks exactly as it did.
  //
  // The 16 is gone. It only ever bound when the marks were close enough that
  // the cap was the thing keeping them together; a ring spanning a city still
  // frames to the ring, because bounds decide that and always did.
  // markercluster refuses to spider a ring while it is animating, and a refusal
  // here is a press that did nothing at all. That window is not theoretical:
  // the field is often still settling from the framing that brought a person
  // to the ring they are pressing, and the whole press was swallowed. So the
  // press waits for the animation to end instead of being dropped on it.
  //
  // `_inZoomAnimation` is the same field the plugin's own guard reads, so
  // reading it here is exactly as reliable as the refusal it anticipates, and
  // `animationend` is fired immediately after that field is lowered. The wait
  // re-arms, because animations nest. If the ring is gone by the time the
  // field settles, its icon is gone with it and there is nothing left to open,
  // which is the right answer rather than a missing case.
  const openTheRing = (cluster) => {
    if (clusterGroup._inZoomAnimation) {
      clusterGroup.once('animationend', () => openTheRing(cluster));
      return;
    }
    if (cluster._icon) cluster.spiderfy();
  };

  clusterGroup.on('clusterclick', (e) => {
    const cluster = e.layer;
    const b = cluster.getBounds();
    const deepest = map.getBoundsZoom(b, false);
    const across = map.project(b.getNorthEast(), deepest)
      .distanceTo(map.project(b.getSouthWest(), deepest));
    if (across <= CLUSTER_R) { openTheRing(cluster); return; }
    if (RM.matches) map.fitBounds(b, { ...overlayPadding(), animate: false });
    else map.flyToBounds(b, { ...overlayPadding(), duration: 0.5 });
  });

  // ways go under the marks: a line is ground, a mark is a decision
  routeLayer = L.layerGroup();
  map.addLayer(routeLayer);

  corrLayer = L.layerGroup();
  map.addLayer(corrLayer);
  markersById._onCorrClick = onCorrClick;

  // right-click / long-press proposes a fix; plain taps only pan and select
  map.on('contextmenu', (e) => onLongPress?.(e.latlng.lat, e.latlng.lng));

  map.on('mousemove', (e) => onPointerMove?.(e.latlng.lat, e.latlng.lng));
  map.on('moveend zoomend', () => {
    const c = map.getCenter();
    onViewChange?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });
  map.on('zoomend', () => refreshCorrVisibility());
  // Type belongs to the settled field. During a flight its old collision plan
  // is no longer true: a name can briefly cross the glass edge or one of the
  // fixed words before moveend gives it a safe side again. Keep the names
  // quiet for that interval, then reveal the newly planned arrangement on the
  // next painted frame. Cancelling the pending reveal matters when one flight
  // hands straight into another.
  map.on('movestart', () => {
    if (labelRevealFrame) cancelAnimationFrame(labelRevealFrame);
    labelRevealFrame = 0;
    map.getContainer().classList.add('map-labels-moving');
  });
  // A selected name remains permanent below the all-labels threshold too, so
  // every settled move must reconsider its safe side, not only street views
  // where all names are standing.
  map.on('moveend', () => {
    try {
      refreshLabels();
    } finally {
      // A future label or font defect must not leave the whole atlas unnamed.
      // The thrown error still reaches diagnostics after finally schedules the
      // reveal; only the collateral visual failure is contained here.
      labelRevealFrame = requestAnimationFrame(() => {
        labelRevealFrame = 0;
        map.getContainer().classList.remove('map-labels-moving');
      });
    }
  });

  markersById._onMarkerClick = onMarkerClick;
  return map;
}

// ---------- ways: the line, cased so it reads over any ground ----------

let onRouteClick = null;
export function setRouteClickHandler(fn) { onRouteClick = fn; }

export function renderRoutes(routes, tagById, selectedId) {
  if (!routeLayer) return;
  routeLayer.clearLayers();
  routesById.clear();
  (routes || []).forEach(r => {
    if (!Array.isArray(r.path) || r.path.length < 2) return;
    const latlngs = r.path.map(p => [p.lat, p.lng]);
    const sel = r.id === selectedId;
    const hue = hueOf(r, tagById);
    const tone = Number.isFinite(hue) ? `--mk-hue:${hue};` : '';

    // the casing carries the field's own colour, so linework beneath can
    // never break the line; the way itself is drawn over it
    const casing = L.polyline(latlngs, {
      className: 'way-casing',
      interactive: false,
      weight: sel ? 11 : 8,
      opacity: 1,
      lineJoin: 'round', lineCap: 'round',
    });
    const way = L.polyline(latlngs, {
      className: `way${sel ? ' sel' : ''}${r.status === 'wishlist' ? ' wish' : ''}`,
      weight: sel ? 4.4 : 3,
      opacity: 1,
      lineJoin: 'round', lineCap: 'round',
    });
    way.on('click', (e) => { L.DomEvent.stop(e); onRouteClick?.(r.id); });

    // where it begins and where it ends
    const cap = (ll, cls) => {
      const marker = L.marker(ll, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
        className: 'way-cap-icon',
        html: `<div class="way-cap ${cls}" style="${tone}"><svg width="18" height="18" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="6" class="wc-halo"/>
            <circle cx="9" cy="9" r="6" class="wc-ring"/>
          </svg></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9],
        }),
      });
      // Leaflet gives every div icon role=button, including these purely
      // decorative ends of a path. Keep them out of keyboard and reader
      // navigation; the path itself is the control they describe.
      marker.on('add', () => {
        const el = marker.getElement?.();
        if (!el) return;
        el.setAttribute('role', 'presentation');
        el.setAttribute('aria-hidden', 'true');
        el.removeAttribute('tabindex');
      });
      return marker;
    };

    routeLayer.addLayer(casing);
    routeLayer.addLayer(way);
    if (Number.isFinite(hue)) way.getElement()?.style.setProperty('--mk-hue', hue);
    if (!r.loop) {
      routeLayer.addLayer(cap(latlngs[0], 'start'));
      routeLayer.addLayer(cap(latlngs[latlngs.length - 1], 'end'));
    } else {
      routeLayer.addLayer(cap(latlngs[0], 'start'));
    }
    routesById.set(r.id, way);
  });
}

// a finger on the profile puts a light on the hill
export function setRouteCursor(lat, lng) {
  if (!routeLayer) return;
  if (lat === null || lat === undefined) {
    if (routeCursor) { routeLayer.removeLayer(routeCursor); routeCursor = null; }
    return;
  }
  if (!routeCursor) {
    routeCursor = L.marker([lat, lng], {
      interactive: false,
      zIndexOffset: 800,
      icon: L.divIcon({
        className: 'way-cursor-icon',
        html: `<div class="way-cursor"><svg width="26" height="26" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="8" class="wcur-halo"/>
            <circle cx="13" cy="13" r="8" class="wcur-ring"/>
            <circle cx="13" cy="13" r="2.6" class="wcur-dot"/>
          </svg></div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      }),
    });
    routeLayer.addLayer(routeCursor);
  } else {
    routeCursor.setLatLng([lat, lng]);
  }
}

export function frameRoute(route) {
  if (!map || !Array.isArray(route?.path) || route.path.length < 2) return;
  const b = L.latLngBounds(route.path.map(p => [p.lat, p.lng]));
  if (RM.matches) map.fitBounds(b, { ...overlayPadding(), maxZoom: 16, animate: false });
  else map.flyToBounds(b, { ...overlayPadding(), maxZoom: 16, duration: 0.7 });
}

// the first time a hand touches the field, whoever is waiting is told
export function onFirstUse(fn) {
  // only a hand counts: zoomstart also fires for the app's own framing
  const once = () => {
    fn();
    map.off('dragstart', once);
    map.off('click', once);
    clusterGroup?.off('clusterclick', once);
  };
  map.on('dragstart', once);
  map.on('click', once);
  // A ring is a mark that happens to stand for several, and Leaflet does not
  // let a press on one reach the map underneath. So pressing a ring was a hand
  // on the field that nobody was told about, and the title went on standing
  // over the very places that press was opening. A press on a single mark is
  // already covered: it opens a plate, and openSurface walks the name home.
  clusterGroup?.on('clusterclick', once);
}

// The point of the field under a pointer event that landed on something
// standing over it. Leaflet hears only what happens inside its own container,
// and the wordmark is not in it.
export function pointOf(ev) {
  return map ? map.mouseEventToLatLng(ev) : null;
}

export function setBasemap(mode /* 'light' | 'dark' */) {
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(cartoTileTemplate(mode), {
    attribution: '',
    subdomains: 'abcd',
    maxZoom: 20,
  });
  tileLayer.addTo(map);
}

// ---------- resonance marks (yours) ----------

function seedFor(id) {
  return -(Math.abs([...String(id)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 5200);
}

export function sigAngle(id) {
  return (Math.abs([...String(id)].reduce((a, c) => a * 33 + c.charCodeAt(0), 5)) % 12) * 30;
}

const MARK_BOX = 44; // a thumb needs this much, even if the ring is smaller
const MARK_C = MARK_BOX / 2;

function markHTML(place, selected, hue) {
  const wish = place.status === 'wishlist';
  const tone = Number.isFinite(hue) ? `--mk-hue:${hue};` : '';
  // sig lands inside an attribute: it is a number or it is nothing
  const graft = place.provenance
    ? `<circle class="graft" cx="${MARK_C}" cy="${MARK_C}" r="13.5" pathLength="360" style="--sig:${Number(place.provenance.sig) || 0}deg"/>`
    : '';
  return `<div class="mark${wish ? ' wish' : ''}${selected ? ' sel' : ''}" style="${tone}--seed:${seedFor(place.id)}ms">
    <svg width="${MARK_BOX}" height="${MARK_BOX}" viewBox="0 0 ${MARK_BOX} ${MARK_BOX}">
      <circle cx="${MARK_C}" cy="${MARK_C}" r="${MARK_C}" class="mk-hit"/>
      ${graft}
      <circle cx="${MARK_C}" cy="${MARK_C}" r="9" class="mk-halo"/>
      <circle cx="${MARK_C}" cy="${MARK_C}" r="9" class="mk-ring"/>
      <circle cx="${MARK_C}" cy="${MARK_C}" r="2.8" class="mk-dot"/>
    </svg></div>`;
}

function makeIcon(place, selected, hue) {
  return L.divIcon({
    className: 'mark-icon',
    html: markHTML(place, selected, hue),
    iconSize: [MARK_BOX, MARK_BOX],
    iconAnchor: [MARK_C, MARK_C],
  });
}

// what a mark says to a reader who cannot see its colour: the name, the
// tag the hue stands for, and whether it has been visited
function markLabel(place, tagById) {
  const t = place.tags?.length ? tagById?.(place.tags[0]) : null;
  return [
    place.name,
    t?.name ? t.name.toLowerCase() : '',
    place.status === 'wishlist' ? 'want to go' : 'been',
  ].filter(Boolean).join(', ');
}

// Leaflet applies `alt` only to image icons. Resonate uses div icons, so the
// keyboard-reachable marker needs its name on the element Leaflet actually
// gives role=button. A title is useful to a pointer; aria-label is the name.
function nameMarker(marker, label) {
  const el = marker.getElement?.();
  if (el) el.setAttribute('aria-label', label);
}

// the hue of a place is the hue of the first tag it was filed under
function hueOf(place, tagById) {
  const t = place.tags && place.tags.length ? tagById?.(place.tags[0]) : null;
  return t && Number.isFinite(t.hue) ? t.hue : null;
}

export function renderMarkers(places, tagById, selectedId) {
  selectedIdRef = selectedId;
  clusterGroup.clearLayers();
  markersById.clear();
  nameById.clear();
  places.forEach(place => {
    const label = markLabel(place, tagById);
    const marker = L.marker([place.lat, place.lng], {
      icon: makeIcon(place, place.id === selectedId, hueOf(place, tagById)),
      riseOnHover: true,
      keyboard: true,
      alt: label,
      title: label,
    });
    marker.on('add', () => nameMarker(marker, label));
    marker.on('click', () => markersById._onMarkerClick?.(place.id));
    markersById.set(place.id, marker);
    nameById.set(place.id, { name: place.name, wish: place.status === 'wishlist' });
    clusterGroup.addLayer(marker);
  });
  refreshLabels(true);
}

export function refreshMarkerIcon(place, tagById, selected) {
  if (selected) selectedIdRef = place.id;
  else if (selectedIdRef === place.id) selectedIdRef = null;
  const m = markersById.get(place.id);
  if (!m) return;
  m.setIcon(makeIcon(place, selected, hueOf(place, tagById)));
  nameMarker(m, markLabel(place, tagById));
  nameById.set(place.id, { name: place.name, wish: place.status === 'wishlist' });
  refreshLabels(place.id);
}

// ---------- the ripple: the field acknowledges a fix ----------

// the acknowledgement lands once the flight is over, so it spreads from the
// place itself rather than from where the place used to be on screen
export function rippleWhenSettled(lat, lng) {
  if (RM.matches) return;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    map.off('moveend', go);
    ripple(lat, lng);
  };
  map.once('moveend', go);
  setTimeout(go, 750);
}

// Where a point is on the screen, once the field has stopped moving.
//
// A heart that arrives is drawn over the place that earned it, and the field
// is usually still flying there when the payload lands. Asking mid-flight
// would put the moment where the place was rather than where it is. The
// timeout is the same insurance rippleWhenSettled carries: a flight that never
// fires moveend must not swallow the moment.
export function pointWhenSettled(lat, lng, fn) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    map.off('moveend', go);
    fn(map.latLngToContainerPoint([lat, lng]), map.getContainer());
  };
  if (RM.matches) { go(); return; }
  map.once('moveend', go);
  setTimeout(go, 900);
}

export function ripple(lat, lng) {
  if (RM.matches) return;
  const container = map.getContainer();
  container.querySelector('.field-ripple')?.remove();
  const pt = map.latLngToContainerPoint([lat, lng]);
  const el = document.createElement('div');
  el.className = 'field-ripple';
  el.style.cssText = `left:${pt.x}px;top:${pt.y}px`;
  container.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// ---------- typeset labels, staged by zoom ----------

function labelDirection(m) {
  const pt = map.latLngToContainerPoint(m.getLatLng());
  return pt.x > map.getSize().x - 200 ? 'left' : 'right';
}

function boxesMeet(a, b) {
  return a.right > b.left && a.left < b.right
    && a.bottom > b.top && a.top < b.bottom;
}

function fieldChromeBoxes() {
  return [...document.querySelectorAll('.fm')].flatMap(el => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (el.hidden || style.display === 'none' || style.visibility === 'hidden'
      || Number(style.opacity) <= 0 || box.width <= 0 || box.height <= 0) return [];
    return [{
      left: box.left - LABEL_CLEARANCE,
      right: box.right + LABEL_CLEARANCE,
      top: box.top - LABEL_CLEARANCE,
      bottom: box.bottom + LABEL_CLEARANCE,
    }];
  });
}

// Work from the type the browser has actually shaped. Canvas text metrics do
// not include the variable font's line box, and a guessed character count is
// exactly how a long name gets one pixel off the left edge on one engine. The
// probe is never painted or exposed to assistive technology; it exists only
// for this synchronous measurement pass and is removed before labels bind.
function labelPlan(ids) {
  const plan = new Map();
  if (!ids.size) return plan;

  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;display:block;transform:none';
  document.body.appendChild(probe);

  const mapBox = map.getContainer().getBoundingClientRect();
  const bounds = {
    left: Math.max(0, mapBox.left) + LABEL_CLEARANCE,
    right: Math.min(innerWidth, mapBox.right) - LABEL_CLEARANCE,
    top: Math.max(0, mapBox.top) + LABEL_CLEARANCE,
    bottom: Math.min(innerHeight, mapBox.bottom) - LABEL_CLEARANCE,
  };
  const chrome = fieldChromeBoxes();
  const printed = [];

  ids.forEach(id => {
    const marker = markersById.get(id);
    const rec = nameById.get(id);
    if (!marker || !rec) return;

    probe.className = `leaflet-tooltip map-label${rec.wish ? ' wish' : ''} leaflet-tooltip-right`;
    probe.textContent = rec.name;
    const size = probe.getBoundingClientRect();
    const point = map.latLngToContainerPoint(marker.getLatLng());
    const first = labelDirection(marker);

    for (const direction of [first, first === 'right' ? 'left' : 'right']) {
      probe.classList.remove('leaflet-tooltip-left', 'leaflet-tooltip-right');
      probe.classList.add(`leaflet-tooltip-${direction}`);
      const margin = parseFloat(getComputedStyle(probe).marginLeft) || 0;
      const anchor = mapBox.left + point.x + (direction === 'right' ? LABEL_OFFSET : -LABEL_OFFSET);
      const left = anchor + margin - (direction === 'left' ? size.width : 0);
      const top = mapBox.top + point.y - size.height / 2;
      const box = { left, right: left + size.width, top, bottom: top + size.height };
      const inside = box.left >= bounds.left && box.right <= bounds.right
        && box.top >= bounds.top && box.bottom <= bounds.bottom;
      const crossesFurniture = chrome.some(item => boxesMeet(box, item));
      const crossesName = printed.some(item => boxesMeet(box, item));
      if (!inside || crossesFurniture || crossesName) continue;
      plan.set(id, direction);
      printed.push(box);
      break;
    }
  });

  probe.remove();
  return plan;
}

function bindLabel(id, m) {
  const rec = nameById.get(id);
  if (!rec) return;
  const shouldShow = labelDirections.has(id);
  const dir = labelDirections.get(id) || labelDirection(m);
  if (m.getTooltip()) m.unbindTooltip();
  const node = document.createElement('span');
  node.textContent = rec.name;
  m.bindTooltip(node, {
    permanent: shouldShow,
    direction: dir,
    offset: [dir === 'left' ? -LABEL_OFFSET : LABEL_OFFSET, 0],
    className: `map-label${rec.wish ? ' wish' : ''}`,
    opacity: 1,
  });
}

// two names must never be printed over each other: a label is only kept
// where no label already stands
function declutter() {
  const kept = [];
  const taken = [];
  [...markersById.entries()]
    .sort((a, b) => (a[0] === selectedIdRef ? -1 : b[0] === selectedIdRef ? 1 : 0))
    .forEach(([id, m]) => {
      const pt = map.latLngToContainerPoint(m.getLatLng());
      const clash = taken.some(q => Math.abs(q.x - pt.x) < 150 && Math.abs(q.y - pt.y) < 22);
      if (clash) return;
      taken.push(pt);
      kept.push(id);
    });
  return new Set(kept);
}

function refreshLabels(force = false) {
  if (!map) return;
  const show = map.getZoom() >= 12 && markersById.size <= 40;
  const selected = map.getZoom() >= 7 && selectedIdRef && markersById.has(selectedIdRef);

  // Panning a large, low-zoom atlas changes neither permanent-label state nor
  // any hover tooltip. This is the common mobile-map path and must stay a true
  // no-op after the initial bindings have been made.
  if (!force && !show && !selected && !labelDirections.size) return;

  const available = show ? declutter() : new Set();
  const candidates = new Set();
  // The thing somebody selected gets first claim on a safe name. If a nearby
  // permanent label has to become hover-only, that is quieter than making the
  // explicit selection lose its name.
  if (selected) candidates.add(selectedIdRef);
  available.forEach(id => candidates.add(id));
  const nextDirections = labelPlan(candidates);
  const changed = new Set();

  if (force === true) {
    markersById.forEach((_marker, id) => changed.add(id));
  } else {
    const planned = new Set([...labelDirections.keys(), ...nextDirections.keys()]);
    planned.forEach(id => {
      if (labelDirections.get(id) !== nextDirections.get(id)) changed.add(id);
    });
    // A record edit can change the hover copy or the wish styling while its
    // permanent direction remains the same.
    if (typeof force === 'string') changed.add(force);
  }

  labelDirections = nextDirections;
  changed.forEach(id => {
    const marker = markersById.get(id);
    if (marker) bindLabel(id, marker);
  });
}

// ---------- correspondents: aperture marks in counter-ink ----------

let corrData = [];

function apertureHTML(sig) {
  // The delay is worked out here because css cannot divide an angle by an
  // angle: calc(var(--sig) / 30deg * -0.6s) is taken by blink and by webkit and
  // rejected outright by gecko, where the whole declaration falls out and every
  // correspondent mark on the field breathes on the same beat of the 7s cycle.
  // Dropping the unit does not help, because an angle over a number is still an
  // angle and an angle times a time is nothing: measured at 0s in all three.
  // sig is already a number here, so the division belongs here.
  return `<div class="mark corr" style="--sig:${sig}deg;--corr-delay:${(-0.6 * sig / 30).toFixed(2)}s">
    <svg width="${MARK_BOX}" height="${MARK_BOX}" viewBox="0 0 ${MARK_BOX} ${MARK_BOX}">
      <circle cx="${MARK_C}" cy="${MARK_C}" r="${MARK_C}" class="mk-hit"/>
      <circle class="mk-halo" cx="${MARK_C}" cy="${MARK_C}" r="9.4"/>
      <circle class="corr-arcs" cx="${MARK_C}" cy="${MARK_C}" r="9.4" pathLength="360"/>
      <circle class="corr-pole" cx="${MARK_C}" cy="${MARK_C}" r="2"/>
    </svg></div>`;
}

export function setCorrespondents(corrs) {
  corrData = corrs;
  refreshCorrVisibility();
}

// The floor below exists so a field browsed whole is not a haze of other
// people's marks: at world zoom a contact's places land inside the same few
// pixels and none of them can be read or pressed.
//
// It has one exception, and the exception is the only reason the field ever
// moves to a contact at all. Keeping an atlas fits the map to the places it
// carried and says these are their places; a visit fits the map to the guest's
// places and puts their name in a bar at the top. An atlas spanning two
// continents fits at zoom 2, well under the floor, so both of those doors used
// to land on an empty world under a sentence claiming otherwise: the marks the
// view was moved for were exactly the marks the floor threw away, and it fires
// on every zoomend, so a contact was gone again every time the world was
// looked at whole.
//
// So the floor is held open while a person stands in a view that was put there
// for somebody's marks, and it comes back when that reason ends. app.js sets it
// where it moves the field for a contact and clears it where a visit or a
// letter is left.
let corrHeld = false;

export function holdCorrMarks(held) {
  corrHeld = !!held;
  refreshCorrVisibility();
}

function refreshCorrVisibility() {
  if (!corrLayer) return;
  corrLayer.clearLayers();
  if (!corrHeld && map.getZoom() < 5) return;
  corrData.filter(c => c.visible !== false).forEach(c => {
    const sig = sigAngle(c.id);
    c.places.forEach(p => {
      const label = `${p.name}, after ${c.name}`;
      const mk = L.marker([p.lat, p.lng], {
        // the floor under the marks and the rings, made in initMap
        pane: 'corrPane',
        keyboard: true,
        alt: label,
        title: label,
        icon: L.divIcon({
          className: 'mark-icon',
          html: apertureHTML(sig),
          iconSize: [MARK_BOX, MARK_BOX],
          iconAnchor: [MARK_C, MARK_C],
        }),
      });
      mk.on('add', () => nameMarker(mk, label));
      const node = document.createElement('span');
      node.textContent = p.name;
      mk.bindTooltip(node, { direction: 'right', offset: [14, 0], className: 'map-label corr-label' });
      mk.on('click', () => markersById._onCorrClick?.(c.id, p.id));
      corrLayer.addLayer(mk);
    });
  });
}

// ---------- view control ----------

function plateOpen() {
  const el = document.getElementById('plate');
  return el && !el.hidden;
}

function overlayPadding() {
  if (window.innerWidth <= 760) {
    return {
      paddingTopLeft: [36, 72],
      paddingBottomRight: [36, plateOpen() ? Math.round(window.innerHeight * 0.64) + 24 : 84],
    };
  }
  return {
    paddingTopLeft: [64, 80],
    paddingBottomRight: [plateOpen() ? Math.min(480, Math.round(window.innerWidth * 0.36)) : 64, 90],
  };
}

export function fitAll(places) {
  if (!places.length) return;
  if (places.length === 1) { map.setView([places[0].lat, places[0].lng], 13); return; }
  const bounds = L.latLngBounds(places.map(p => [p.lat, p.lng]));
  map.fitBounds(bounds, { ...overlayPadding(), maxZoom: 14 });
}

export function flyToPlace(place, zoom) {
  const targetZoom = Math.max(map.getZoom(), zoom ?? 14);
  const pt = map.project(L.latLng(place.lat, place.lng), targetZoom);
  if (window.innerWidth > 760) pt.x += Math.min(220, window.innerWidth * 0.15);
  else pt.y += Math.round(window.innerHeight * 0.26);
  if (RM.matches) map.setView(map.unproject(pt, targetZoom), targetZoom);
  else map.flyTo(map.unproject(pt, targetZoom), targetZoom, { duration: 0.65, easeLinearity: 0.25 });
}

// A point being named is the only thing on screen that matters, so the field
// goes to it and gets close enough to recognise a corner. It is lifted clear
// of the naming panel rather than centred: a person needs to see the spot they
// are describing while they describe it, and the panel owns the lower third.
export function flyToMark(lat, lng) {
  const targetZoom = Math.max(map.getZoom(), 16);
  const pt = map.project(L.latLng(lat, lng), targetZoom);
  pt.y += Math.round(window.innerHeight * 0.20);
  const to = map.unproject(pt, targetZoom);
  if (RM.matches) map.setView(to, targetZoom);
  else map.flyTo(to, targetZoom, { duration: 0.7, easeLinearity: 0.24 });
}

export function setView(view) {
  if (view && Number.isFinite(view.lat)) map.setView([view.lat, view.lng], view.zoom ?? 4);
}

export function getCenter() {
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng };
}

export function getZoom() { return map.getZoom(); }
export function zoomIn() { map.zoomIn(); }
export function zoomOut() { map.zoomOut(); }

// ---------- where you stand ----------
//
// You are not a place, and for a long time you were drawn as one: a six-pixel
// hollow ring in ink, on a field where every place is a hollow ring in its
// tag's colour. Standing in Basel put that ring a centimetre from Markthalle
// Basel and nothing on the screen said which was which. A colour would not
// have fixed it either, because the tags own the colours and the next tag
// takes the one you chose.
//
// So the difference is in kind rather than in hue. A place is a ring: a
// decision, a point, an outline somebody drew. You are the opposite figure,
// filled and soft edged, and you are not a point at all.
//
// That last part is the honest half. A device answers `locate` with a
// coordinate *and an accuracy*, and the old dot threw the accuracy away and
// drew six pixels regardless, which claims a metre when the answer was three
// kilometres of cell tower. The disc below is drawn in metres through
// `L.circle`, so it is the device's own number at the map's own scale: a good
// fix is a tight disc under your dot, a poor one is a wide pale field, and
// zooming in on a bad fix spreads it out rather than pretending. Nothing else
// on the field is measured in ground units, which is the second reason it
// cannot be mistaken for a mark.
let hereLayer;
let hereWatching = false;

function drawHere(latlng, accuracy) {
  if (!hereLayer) {
    const group = L.layerGroup().addTo(map);
    // The opacities are set here and not only in the stylesheet. Leaflet
    // writes `fill-opacity` as an SVG attribute, and an attribute it writes
    // and a rule nobody wrote do not fight: the dot came out at Leaflet's
    // default 0.2 and read as a smudge on the tiles. Colour stays in CSS,
    // where the themes can reach it. Whether a shape is solid is geometry.
    //
    // The disc is an `L.circle`, whose radius is metres of ground; the dot is
    // an `L.circleMarker`, whose radius is pixels of screen. Two classes that
    // differ by one word, and the whole honesty of this mark sits on the
    // difference.
    const disc = L.circle(latlng, {
      radius: 0, stroke: false, fillOpacity: 0.09,
      className: 'here-disc', interactive: false,
    }).addTo(group);
    const dot = L.circleMarker(latlng, {
      radius: 4.5, weight: 2.5, fillOpacity: 1,
      className: 'here-dot', interactive: false,
    }).addTo(group);
    hereLayer = { group, disc, dot };
  }
  // An accuracy the device declines to give is not an accuracy of zero. A
  // missing number draws no disc at all rather than a disc that says perfect.
  hereLayer.disc.setLatLng(latlng);
  hereLayer.disc.setRadius(Number.isFinite(accuracy) ? accuracy : 0);
  hereLayer.dot.setLatLng(latlng);
}

// The fix is a layer and not a stamp. `watch` keeps the same two shapes and
// moves them, so walking a street moves the dot instead of leaving yesterday's
// dot behind claiming to be you.
export function locate(onDone, onError, { watch = false, fly = true } = {}) {
  // The field is taken to you once, on the answer that made it worth taking.
  //
  // Leaflet's own `setView` is not used, because a watch calls it on every
  // update the device sends: you press the word, the field flies to you, you
  // pan two streets over to look at something, and the next tick of a GPS
  // nobody asked to keep talking snatches the field back. It happens again a
  // few seconds later, and there is no way to tell the app to stop except to
  // close it. Flying once is the behaviour anybody expected from a press;
  // flying forever is a fight with the map.
  let flown = false;
  const found = (e) => {
    drawHere(e.latlng, e.accuracy);
    if (fly && !flown) {
      flown = true;
      map.setView(e.latlng, Math.max(map.getZoom(), 14));
    }
    onDone?.({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: e.accuracy });
  };
  // The code is carried out rather than swallowed. A timeout and a refusal
  // arrive on the same event and mean opposite things: one is a device still
  // trying, the other is a device that will never answer again.
  const failed = (e) => onError?.({ code: e?.code, message: e?.message });
  if (watch) {
    if (hereWatching) return;
    // The pair is kept so `forgetHere` can take off exactly these two. A bare
    // `map.off('locationfound')` would also take off a one-shot locate that
    // somebody else started and is still waiting on.
    hereWatching = { found, failed };
    map.on('locationfound', found);
    map.on('locationerror', failed);
  } else {
    map.once('locationfound', found);
    map.once('locationerror', failed);
  }
  map.locate({ setView: false, enableHighAccuracy: false, watch });
}

// A fix that is old is a claim about now that stopped being true, so there is
// a way to take it off the field rather than only ways to put it on.
export function forgetHere() {
  stopWatchingHere();
  if (hereLayer) { map.removeLayer(hereLayer.group); hereLayer = undefined; }
}

// Watching costs the battery of a device somebody is carrying around a city,
// which is the whole audience. A tab nobody is looking at has no use for a dot
// nobody can see, so the watch stops with the screen and the last fix stays
// drawn and stays timestamped; whoever comes back reads the clock and decides
// whether it is still true. `watchPosition` left running behind a locked phone
// is the version of this that gets the app deleted.
export function stopWatchingHere() {
  map.stopLocate();
  if (hereWatching) {
    map.off('locationfound', hereWatching.found);
    map.off('locationerror', hereWatching.failed);
    hereWatching = false;
  }
}

export function watchingHere() { return !!hereWatching; }

let previewMarker = null;
export function previewPin(lat, lng) {
  clearPreview();
  previewMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'mark-icon',
      html: `<div class="mark wish proposed"><svg width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="8" class="mk-ring"/>
        <circle cx="15" cy="15" r="2.4" class="mk-dot"/>
      </svg></div>`,
      iconSize: [30, 30], iconAnchor: [15, 15],
    }),
    interactive: false,
  }).addTo(map);
}
export function clearPreview() {
  if (previewMarker) { map.removeLayer(previewMarker); previewMarker = null; }
}

export function invalidate() { map.invalidateSize(); }
export function getMap() { return map; }
export function closeAddPopup() { /* superseded by the add-confirm line; kept for callers */ }
