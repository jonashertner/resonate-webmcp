// evening.js — the light the opening is drawn in.
//
// The opening was one fixed picture, then two, one for each theme. This is the
// third answer and it is meant to be the last: the theme still decides whether
// the ground is paper or ink, which is not negotiable and is the reason the
// two-picture change was made in the first place, and everything else about
// the light comes from the clock that is already on the device.
//
// Two dials. Both continuous, neither ever announced.
//
//   The hour says where in the day you are: 0 at the two horizons, +1 at the
//   top of the arc, -1 in the middle of the night. That position picks the
//   colour, and it picks it the same way in every month, because the colour of
//   twilight is a fact about being at the horizon and not about the date. Dawn
//   and dusk are the amber hours; the top of the day and the middle of the
//   night are the two quiet ends, nearly colourless.
//
//   The year says how high the arc gets, and that is the whole of the season.
//   A midwinter sun climbs about half as far as a midsummer one, so the light
//   is thinner all day, the pool of it sits lower on the ground and carries
//   less far, and the day itself is shorter at both ends: seven in the morning
//   is dark in December and broad in June. Nothing recolours noon. Winter is
//   not a blue filter over the middle of the day, it is a sun that never gets
//   up, and drawing it as the second thing is what makes it read as a season
//   rather than as a setting somebody chose.
//
// Nobody is asked anything. The date and the hour are on the device already,
// and the one other thing read here, the name of the time zone, is on the
// device already too and is used for exactly one fact: which side of the
// equator the light is coming from. No location is requested, nothing is
// measured, nothing is looked up, and nothing leaves. That is the whole reason
// the light is built out of arithmetic rather than out of a sunrise table
// somebody would have to be asked their position to be found in. It is also
// the reason it is worth building at all: an app whose promise is that nothing
// leaves the device should look like a thing that knows where it is standing
// without having asked.
//
// Latitude is the one thing genuinely unknowable from a clock, so the day here
// never stretches more than two and a half hours either side of twelve. That is
// an hour short in Tromso and an hour long in Nairobi and it is never wrong in
// a way anybody can see, because what is being drawn is a room at a time of
// year and not an almanac.
//
// One property is deliberate and is worth stating because it is what makes the
// whole thing feel like a place rather than a trick: the same instant always
// gives the same light. Nothing here is random, nothing is remembered between
// visits, and two people opening the app in the same hour on the same day see
// the same picture. A composition that shuffled itself would be a novelty. This
// is supposed to be the light in the room.

// Where the year runs backwards.
//
// A list, and lists go stale, so it holds only the zones where the year is
// actually felt as warm and cold: the near-equatorial ones are left out on
// purpose, because there the answer is a coin toss and the picture is the same
// either way. A zone this does not recognise is treated as northern, which is
// where most of the people and nearly all of the seasonal feeling are.
const SOUTH = new RegExp('^(?:'
  + 'Australia/|Antarctica/'
  + '|Atlantic/Stanley'
  + '|Indian/(?:Kerguelen|Mauritius|Reunion)'
  + '|Pacific/(?:Auckland|Chatham|Norfolk|Fiji|Noumea|Port_Moresby|Guadalcanal'
    + '|Efate|Tongatapu|Apia|Pago_Pago|Tahiti|Rarotonga|Easter)'
  + '|America/(?:Argentina/|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima'
    + '|Punta_Arenas|Campo_Grande|Cuiaba|Bahia|Recife|Maceio|Araguaina'
    + '|Santarem|Porto_Velho|Rio_Branco|Noronha)'
  + '|Africa/(?:Johannesburg|Windhoek|Harare|Maputo|Lusaka|Gaborone|Maseru'
    + '|Mbabane|Blantyre|Luanda|Lubumbashi)'
  + ')');

export function hemisphere(zone) {
  return SOUTH.test(String(zone || '')) ? -1 : 1;
}

// The device's own zone, asked for in the one way that cannot fail loudly. A
// browser without Intl, or one that answers nothing, gets the northern year,
// which is a picture and not an error.
export function deviceZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
  catch { return ''; }
}

// Smoothstep between control points, so the joins are not corners. Every ramp
// in this file arrives at each knot with no slope, which is what makes the
// whole picture drift instead of stepping: there is no minute of any day where
// the light changes faster than the minute before it. `k` picks the column, so
// one table can carry two numbers that have to move together.
function ramp(stops, x, k = 1) {
  if (x <= stops[0][0]) return stops[0][k];
  for (let i = 1; i < stops.length; i++) {
    if (x > stops[i][0]) continue;
    const a = stops[i - 1];
    const b = stops[i];
    const f = (x - a[0]) / (b[0] - a[0]);
    return a[k] + (b[k] - a[k]) * (f * f * (3 - 2 * f));
  }
  return stops[stops.length - 1][k];
}

// oklab to sRGB, by the published matrices. The app writes its own palette in
// oklch and this is the one place that has to hand a canvas plain bytes, so the
// conversion lives here rather than being approximated in hexadecimal by hand.
function rgb(L, a, b) {
  const l3 = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
  ].map(v => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(c * 255)));
  });
}

const triple = (L, a, b) => rgb(L, a, b).join(', ');
const hex = (L, a, b) => '#' + rgb(L, a, b).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

// The two dials, from a moment and a zone. Exported because everything below
// is a taste decision and this part is arithmetic: a test can walk a whole year
// through here and say what the picture is being asked to do.
export function dials(when, zone) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
  const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  // the day, carried as a fraction so the year moves with the hour rather than
  // at midnight
  const first = new Date(d.getFullYear(), 0, 1);
  const doy = (d - first) / 864e5;
  const year = hemisphere(zone) * Math.cos(2 * Math.PI * (doy - 171.5) / 365.25);

  // Daylight, and the honest ceiling on it. Solar noon is held at half past
  // twelve for everybody: a zone is an hour wide and clocks move for summer,
  // and chasing either would be pretending to a precision the input does not
  // have.
  const day = 12 + 2.4 * year;
  const rise = 12.5 - day / 2;
  const set = 12.5 + day / 2;

  // Two numbers, and keeping them apart is the point.
  //
  // `arc` is where in the day you are, from horizon to horizon, and it reaches
  // the top of its own day whatever the month. `sun` is how high that actually
  // got, which in midwinter is about half of midsummer. The first picks the
  // colour, because twilight is amber for the reason that the light is coming
  // in along the ground, and that reason arrives at every sunset of the year.
  // The second decides how much light there is and where it falls, because a
  // sun that never gets up is the entire difference between January and July.
  //
  // Fusing them, which is what this did at first, hands the season one job it
  // cannot do: recolouring a noon that the table deliberately leaves colourless.
  // The measured result was a January noon and a July noon five bytes apart on
  // one channel, which is a claim in a comment and nothing on a screen.
  //
  // Zurich swings between about twenty and sixty five degrees, which is a ratio
  // of two fifths. This keeps a little back from that, for the same reason the
  // day is never stretched past two and a half hours: latitude is the one thing
  // a clock cannot tell you, and the picture leans north without ever claiming
  // to be an almanac.
  const high = 0.72 + 0.28 * year;
  let arc;
  if (hour >= rise && hour <= set) {
    arc = Math.sin(Math.PI * (hour - rise) / day);
    return { hour, year, arc, sun: arc * high, rise, set };
  }
  const night = 24 - day;
  const since = hour > set ? hour - set : hour + 24 - set;
  // Below the horizon the ceiling does not apply: a winter night is not a
  // shallower night, it is a longer and a deeper one, and `day` already said so.
  arc = -Math.sin(Math.PI * since / night);
  return { hour, year, arc, sun: arc, rise, set };
}

// The colour of the light, given as the two axes of oklab and not as a hue.
//
// That is the load-bearing decision in this file. A hue is an angle, and an
// angle has two roads between the blue of night and the amber of the horizon:
// one goes round through violet and magenta, the other through green, and both
// are somebody else's app. Read as a pair of coordinates the same journey goes
// straight across the middle, and the middle of that space is no colour at all,
// so twilight arrives the way twilight actually arrives: the blue lets go, there
// is a minute of nothing, and then the gold takes. It cannot go purple. Not at
// some hour nobody tested, not in a hemisphere nobody visited. There is no
// purple on the line.
//
// Read the table down and the shape of a day is in it. The two ends are the
// quiet ones: the middle of the night is blue, the top of the day is nearly
// colourless and a shade cool, which is what a sun high overhead is. All the
// colour there is sits in the hour either side of the horizon, twice, which is
// also when somebody is most likely to be opening anything.
//
// It is indexed by the arc and not by the altitude, so a December dusk and a
// June dusk are the same amber. They differ in how long they last and in how
// much light is left around them, which is the difference a person would
// actually name if you asked them.
//
//        arc        a        b
const LIGHT = [
  [-1.00, -0.0026, -0.0170],
  [-0.40, -0.0040, -0.0200],
  [-0.12,  0.0045,  0.0090],
  [ 0.00,  0.0185,  0.0365],
  [ 0.25,  0.0102,  0.0284],
  [ 0.65,  0.0020,  0.0090],
  [ 1.00, -0.0008, -0.0025],
];

// Everything the drawing needs, and nothing it does not: a ground colour, a
// pool of light with a place and a reach, the ink the ways are drawn in, and
// the colour the corners are taken down with.
//
// The two themes hold the same shape and differ only in which end of the
// lightness scale they live at. Neither is allowed to cross into the other's
// half: a person who keeps this app in day is never shown a dark screen, at
// three in the morning in January or at any other hour of any other day.
export function evening(theme, when, zone) {
  const { hour, year, arc, sun } = dials(when, zone);
  const up = (sun + 1) / 2;                       // 0 at the depth of night, 1 at the top of a summer day
  const glow = Math.exp(-(((arc - 0.06) / 0.30) ** 2));   // 1 at the horizon, gone by the top of the arc

  // The season has one lever on colour and it is a magnitude: summer says more
  // of whatever the hour already is, winter says less. It cannot flip a sign,
  // and that is not a limitation to work around, it is the guarantee. An added
  // offset could pull a warm point across into the quadrant where a is positive
  // and b is negative, and there is only one colour in that quadrant. A scale
  // moves every point along the line it already sits on, towards the colourless
  // middle or away from it, so the whole year is confined to the road the table
  // draws and the road has no purple on it.
  //
  // So the season is mostly not here. It is in `sun`, which is how high the
  // light got, and it comes out as amount and as position rather than as tint.
  const k = 1 + 0.18 * year;
  const la = ramp(LIGHT, arc, 1) * k;
  const lb = ramp(LIGHT, arc, 2) * k;

  // Every surface takes the same light, at its own strength. Nothing here names
  // a colour of its own, so nothing can drift out of agreement with the rest:
  // the ground, the pool, the letters and the corners are one temperature, and
  // the second number is only how much of it each is allowed.
  const dark = theme !== 'light';
  const p = dark ? {
    // the night the app shipped with was a flat #0A0908 behind the canvas, and
    // that is where the ground still sits at three in the morning. What is new
    // is that it does not sit there at nine.
    base: [0.115 + 0.030 * up, 0.30],
    pool: [0.195 + 0.115 * up + 0.035 * glow, 1.00],
    ink: [0.930, 0.22],
    out: [0.045, 0.30, 0.80],
    lift: 0.92,
  } : {
    // Paper, and the app's paper is 0.965. The day evening sits just under it
    // and the pool comes up just over, so the opening is the same sheet with a
    // lamp on it and the app is the sheet with the lamp taken away. It is
    // deliberately a much smaller move than the night's: a room can go from
    // near black to lit and still be one room, and paper cannot go grey and
    // still be paper.
    base: [0.922 + 0.026 * up, 0.26],
    pool: [0.968 + 0.020 * up + 0.012 * glow, 0.30],
    ink: [0.205, 0.30],
    out: [0.640, 0.45, 0.13],
    lift: 0.95,
  };

  const [or, og, ob] = rgb(p.out[0], la * p.out[1], lb * p.out[1]);
  return {
    base: hex(p.base[0], la * p.base[1], lb * p.base[1]),
    pool: triple(p.pool[0], la * p.pool[1], lb * p.pool[1]),
    ink: triple(p.ink[0], la * p.ink[1], lb * p.ink[1]),
    out: `rgba(${or}, ${og}, ${ob}, ${p.out[2]})`,
    lift: p.lift,
    // where the light falls and how far it carries. The horizontal is a plain
    // day: east before noon, west after it, back through the middle at night.
    at: [0.5 + 0.20 * Math.sin(2 * Math.PI * (hour - 12.5) / 24), 0.60 - 0.16 * sun],
    reach: 0.50 + 0.22 * up,
    arc,
    sun,
    year,
  };
}
