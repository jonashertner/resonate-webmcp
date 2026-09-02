// navsafe.mjs — a read that loses to a navigation is "not yet", not a failure.
//
// Three tests failed in CI, one in each engine, all through one helper:
// `joinWith` polls localStorage for the membership key while the join is still
// moving the browser, out to the pretended checkout page and back again. A tick
// that lands on a commit finds its execution context gone, `page.evaluate`
// rejects, and `expect.poll` reports that rejection as a failed assertion
// rather than as an answer it has not got yet. Each of the three passed when
// run alone, which is the shape of a race and not of a defect in any one test.
//
// All three engines word it identically. That was measured rather than assumed,
// and race.spec.mjs goes on measuring it, so a Playwright release that rewords
// it fails there instead of quietly bringing the flake back here.
//
// The blank handed in must be a value the waiting assertion can never accept.
// Every caller waits for a key beginning `tc_`, so '' is always "not yet" and
// can never end a poll early. A poll waiting *for* '' must not use this, and
// none does: that would turn a lost read into a passing assertion, which is the
// one outcome worse than a flake.
export const NAVIGATING =
  /Execution context was destroyed|Target closed|Target page, context or browser has been closed/i;

export const orNotYet = (reading, notYet) =>
  reading.catch((e) => {
    if (NAVIGATING.test(String((e && e.message) || e))) return notYet;
    throw e;
  });
