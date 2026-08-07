/**
 * weekModel.js — Meal Plan Pro weekly mapping
 * ─────────────────────────────────────────────────────────────
 * Turns the new "This Week" choices (dinner modes, weekend meals) + the
 * saved weekday eating pattern into the FLAT `daySchedule` array that
 * services/claude.js already consumes — so the new UI drives the plan
 * with little-to-no backend change.
 *
 * daySchedule entry shape (unchanged, what claude.js reads):
 *   { day, training, adultBreakfast, partnerBreakfast,
 *     adultLunch, partnerLunch, adultEvening, kidsEvening, kidsLunch }
 *
 * Works in browser (window.WeekModel) and Node (module.exports).
 * ─────────────────────────────────────────────────────────────
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeekModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const ABBR = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
  const WEEKEND = { Saturday: true, Sunday: true };

  // The four dinner modes → existing daySchedule evening codes.
  // NOTE: 'leftovers' has no dedicated backend code yet; it maps to a normal
  //       home dinner for now (a small claude.js prompt addition can make it a
  //       true no-cook leftovers night later). Tracked in the Phase 2 plan.
  const DINNER_MODES = ['family', 'kids_separate', 'out', 'leftovers'];
  const DINNER_LABELS = { family: 'Family dinner', kids_separate: 'Kids eat separately', out: 'Eating out / takeaway', leftovers: 'Leftovers' };
  function dinnerToCodes(mode) {
    switch (mode) {
      case 'out':           return { adultEvening: 'out_evening', kidsEvening: 'out' };
      case 'kids_separate': return { adultEvening: 'normal',      kidsEvening: 'separate' };
      case 'leftovers':     return { adultEvening: 'leftovers',   kidsEvening: 'same' };
      case 'family':
      default:              return { adultEvening: 'normal',      kidsEvening: 'same' };
    }
  }

  // Eating-pattern → existing breakfast/lunch codes.
  function breakfastCode(v, isWeekendOut) {
    if (isWeekendOut) return 'out';
    if (v === 'skip') return 'skip';
    return 'home';                      // quick / plan → eaten at home
  }
  function adultLunchCode(v) {          // weekday lunch style, passed through for the prompt to interpret
    return (v === 'quick' || v === 'out') ? v : 'leftovers';
  }
  function kidsLunchCode(v) {
    return v === 'school' ? 'school' : 'packed';
  }

  function firstAdult(p) { return (p.adults && p.adults[0]) || {}; }
  function secondAdult(p) { return (p.adults && p.adults[1]) || null; }
  function trains(adult, abbr) {
    return !!(adult && adult.training && adult.training.on && (adult.training.days || []).indexOf(abbr) >= 0);
  }
  function sessionFor(adult) {
    const i = String((adult.training && adult.training.intensity) || 'moderate').toLowerCase();
    if (i.indexOf('hard') >= 0 || i.indexOf('high') >= 0) return 'hard';
    if (i.indexOf('easy') >= 0 || i.indexOf('low') >= 0) return 'easy';
    return 'moderate';
  }

  function dayNamesFrom(startDay, n) {
    const start = Math.max(0, DAYS.indexOf(startDay));
    const out = [];
    for (let i = 0; i < n; i++) out.push(DAYS[(start + i) % 7]);
    return out;
  }

  /**
   * @param {object} profile  — nested profile from profileModel
   * @param {object} week
   *   {
   *     startDay: 'Monday', days: 7,
   *     weeknightDinners: { Mon:'family', Tue:'family', ... },      // by abbr; weekdays only
   *     weekend: { Sat:{breakfast,lunch,dinner}, Sun:{...} },       // breakfast/lunch: 'cook'|'leftovers'|'out'; dinner: a dinner mode
   *   }
   * @returns {Array} daySchedule
   */
  function buildDaySchedule(profile, week) {
    const p = profile || {};
    week = week || {};
    const a1 = firstAdult(p), a2 = secondAdult(p);
    const kidsLunchPref = (p.kids && p.kids.eating && p.kids.eating.weekdayLunch) || 'packed';
    const wd = week.weeknightDinners || {};
    const we = week.weekend || {};
    const names = dayNamesFrom(week.startDay || 'Monday', week.days || 7);

    return names.map(function (day) {
      const abbr = ABBR[day];
      const isWeekend = !!WEEKEND[day];
      const entry = { day: day };

      // Training (adult-1 centric, as the current backend expects)
      entry.training = trains(a1, abbr) ? sessionFor(a1) : 'rest';

      if (!isWeekend) {
        // Weekday: breakfast + lunch from the saved eating pattern
        entry.adultBreakfast   = breakfastCode(a1.eating && a1.eating.breakfast);
        entry.partnerBreakfast = a2 ? breakfastCode(a2.eating && a2.eating.breakfast) : 'home';
        entry.adultLunch       = adultLunchCode(a1.eating && a1.eating.lunch);
        entry.partnerLunch     = a2 ? adultLunchCode(a2.eating && a2.eating.lunch) : entry.adultLunch;
        entry.kidsLunch        = kidsLunchCode(kidsLunchPref);
        const dinner = dinnerToCodes(wd[abbr] || 'family');
        entry.adultEvening = dinner.adultEvening;
        entry.kidsEvening  = dinner.kidsEvening;
      } else {
        // Weekend: breakfast / lunch / dinner all chosen for the week
        const w = we[abbr] || { breakfast: 'cook', lunch: 'cook', dinner: 'family' };
        entry.adultBreakfast   = breakfastCode('plan', w.breakfast === 'out');
        entry.partnerBreakfast = breakfastCode('plan', w.breakfast === 'out');
        entry.adultLunch       = w.lunch === 'out' ? 'out' : (w.lunch === 'leftovers' ? 'leftovers' : 'cooked');
        entry.partnerLunch     = entry.adultLunch;
        entry.kidsLunch        = 'home';                                   // weekend kids eat at home
        const dinner = dinnerToCodes(w.dinner || 'family');
        entry.adultEvening = dinner.adultEvening;
        entry.kidsEvening  = dinner.kidsEvening;
      }
      return entry;
    });
  }

  // Sensible default week: family dinners Mon–Thu, eat-out Fri, cooked weekends.
  function defaultWeek(days) {
    return {
      startDay: 'Monday',
      days: days || 7,
      weeknightDinners: { Mon: 'family', Tue: 'family', Wed: 'family', Thu: 'family', Fri: 'out' },
      weekend: {
        Sat: { breakfast: 'cook', lunch: 'cook', dinner: 'family' },
        Sun: { breakfast: 'cook', lunch: 'cook', dinner: 'family' },
      },
    };
  }

  return { DAYS, ABBR, DINNER_MODES, DINNER_LABELS, dinnerToCodes, buildDaySchedule, defaultWeek };
}));

// ── Self-test:  node weekModel.js ──
if (typeof require !== 'undefined' && require.main === module) {
  const W = module.exports;
  const assert = require('assert');

  const profile = {
    adults: [
      { name: 'Joe', eating: { breakfast: 'quick', lunch: 'leftovers' }, training: { on: false, days: [] } },
      { name: 'Sarah', eating: { breakfast: 'plan', lunch: 'quick' }, training: { on: true, intensity: 'moderate', days: ['Tue', 'Thu', 'Sat', 'Sun'] } },
    ],
    kids: { eating: { weekdayLunch: 'packed' } },
  };
  const week = {
    startDay: 'Monday', days: 7,
    weeknightDinners: { Mon: 'family', Tue: 'family', Wed: 'kids_separate', Thu: 'family', Fri: 'out' },
    weekend: { Sat: { breakfast: 'cook', lunch: 'cook', dinner: 'family' }, Sun: { breakfast: 'out', lunch: 'leftovers', dinner: 'kids_separate' } },
  };
  const sched = W.buildDaySchedule(profile, week);

  assert.strictEqual(sched.length, 7);
  const by = {}; sched.forEach(s => by[s.day] = s);
  // Wednesday = kids eat separately
  assert.strictEqual(by.Wednesday.kidsEvening, 'separate');
  assert.strictEqual(by.Wednesday.adultEvening, 'normal');
  // Friday = eating out
  assert.strictEqual(by.Friday.adultEvening, 'out_evening');
  assert.strictEqual(by.Friday.kidsEvening, 'out');
  // Weekday lunch + kids packed + breakfast
  assert.strictEqual(by.Monday.kidsLunch, 'packed');
  assert.strictEqual(by.Monday.adultLunch, 'leftovers');  // Joe eating pattern lunch = leftovers
  assert.strictEqual(by.Monday.adultBreakfast, 'home');   // quick → home
  // Sarah trains Tue/Thu/Sat/Sun (adult-1 centric training is Joe → all rest); training reflects adult1 (Joe, no sport)
  assert.strictEqual(by.Tuesday.training, 'rest');
  // Weekend Sunday: breakfast out, lunch leftovers→home, dinner kids separate
  assert.strictEqual(by.Sunday.adultBreakfast, 'out');
  assert.strictEqual(by.Sunday.adultLunch, 'leftovers');  // weekend lunch chosen = leftovers
  assert.strictEqual(by.Sunday.kidsEvening, 'separate');
  assert.strictEqual(by.Saturday.adultLunch, 'cooked');   // weekend cook → cooked
  assert.strictEqual(by.Saturday.kidsLunch, 'home');      // weekend kids eat at home

  // Leftovers dinner mode → dedicated evening code
  const sLo = W.buildDaySchedule(profile, Object.assign({}, week, { weeknightDinners: Object.assign({}, week.weeknightDinners, { Thu: 'leftovers' }) }));
  assert.strictEqual(sLo.find(s => s.day === 'Thursday').adultEvening, 'leftovers');

  // Adult-1 who DOES train drives the training field
  const p2 = { adults: [{ eating: {}, training: { on: true, intensity: 'hard', days: ['Mon', 'Wed'] } }], kids: { eating: {} } };
  const s2 = W.buildDaySchedule(p2, W.defaultWeek(7));
  const m2 = {}; s2.forEach(s => m2[s.day] = s);
  assert.strictEqual(m2.Monday.training, 'hard');
  assert.strictEqual(m2.Tuesday.training, 'rest');

  console.log('weekModel mapping: ALL ASSERTIONS PASSED');
  console.log('  sample week (day → training / adultEve / kidsEve / kidsLunch):');
  sched.forEach(s => console.log('   ', s.day.padEnd(10), s.training.padEnd(9), s.adultEvening.padEnd(12), s.kidsEvening.padEnd(9), s.kidsLunch));
}
