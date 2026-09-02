// frames.mjs — webkit paints the page it has been told to look at, and starves
// the rest, so a second device has to be brought forward before it is touched.
//
// Eight tests failed in CI across three runs, all webkit, all in this suite's
// two-device tests, and every one of them at exactly forty-five seconds, which
// is the test timeout rather than any assertion's. The call log stopped in the
// same place every time: `waiting for element to be visible, enabled and
// stable`. The element was found, it was willing, and something said it had
// not stopped moving.
//
// It had. Measuring inside the CI container, at the click that hung:
//
//     the page fixture        124 frames in two seconds     62/s
//     the second device         2 frames in two seconds      1/s
//
// One frame a second. Playwright decides an element is stable by comparing its
// bounding box across two consecutive animation frames, so on a page served one
// frame a second that check cannot answer faster than two seconds, and forty
// five seconds is forty-five chances rather than the thousands the timeout was
// written for. Everything else in the suite kept working on that page, which is
// why this hid for so long: `expect` polls by evaluating javascript, and
// javascript ran fine. Only the pointer actions wait on frames.
//
// `bringToFront` fixes it, 1/s to 62/s, measured twice with the same numbers.
// Three cheaper explanations were tried in the container first and all three
// were wrong: fronting the page once when it loads decays back to one frame a
// second by the time the test gets there; fronting it before the navigation is
// undone by the navigation; and giving the second device a browser of its own
// rather than a second context changes nothing at all, so this is not two
// contexts competing. What works is fronting the page immediately before it is
// used, which is also the only honest description of what the test is doing:
// two people, two devices, and one of them is being looked at.
//
// None of this reproduces on a developer's machine, where both pages run at 62
// frames a second, because it needs the container's software rendering: CI
// webkit boots with `MESA: error: ZINK: vkCreateInstance failed` and composites
// on the cpu. So the measurement lives in the suite, in frames.spec.mjs, rather
// than in anybody's memory of a morning.
export const front = async (page) => {
  await page.bringToFront();
  return page;
};
