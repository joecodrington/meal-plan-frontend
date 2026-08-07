/**
 * profileModel.js — Meal Plan Pro profile data layer
 * ─────────────────────────────────────────────────────────────
 * One source of truth for the household profile, shared by Onboarding,
 * Settings and the weekly flow. Provides:
 *   - a clean NESTED profile object the new UI works with, and
 *   - an adapter to/from the FLAT `client_data` shape the backend already
 *     reads (so no backend change is needed to start).
 *
 * Works in the browser (window.ProfileModel) and in Node (module.exports)
 * so it can be unit-tested. No dependencies.
 * ─────────────────────────────────────────────────────────────
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProfileModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // ── Option sets (single place the UI and adapter agree on) ──
  const GOALS = ['loseweight', 'losefat', 'recomp', 'maintain', 'buildmuscle', 'gainweight'];
  const GOAL_LABELS = {
    loseweight: 'Lose weight', losefat: 'Lose fat, keep muscle', recomp: 'Body recomposition',
    maintain: 'Maintain weight', buildmuscle: 'Build muscle', gainweight: 'Gain weight',
  };
  const RATES = ['gentle', 'steady', 'aggressive'];
  const EMPHASIS = ['Energy', 'Recovery', 'Longevity', 'Heart health', 'Gut health'];
  const RETAILERS = ["Tesco", "Sainsbury's", "Asda", "Waitrose", "M&S", "Ocado", "Morrisons", "Aldi", "Lidl"];
  const RANGES = ['essentials', 'mid', 'organic'];          // stored value == tier column
  const RANGE_LABELS = { essentials: 'Essentials / own brand', mid: 'Mid-range', organic: 'Organic / finest' };
  const SPORTS = ['Long distance running', 'Cycling', 'Triathlon', 'Strength training', 'Team sports', 'Swimming', 'CrossFit / HIIT', 'Other endurance'];
  const ADULT_LUNCH = ['leftovers', 'quick', 'out'];         // quick = generated ≤30-min
  const KID_LUNCH = ['packed', 'school'];

  // Map new single-select goal → a legacy goals[] label, so the current
  // backend/UI (which still reads goals[]) keeps working during the transition.
  const GOAL_TO_LEGACY = {
    loseweight: 'Weight loss', losefat: 'Weight loss', recomp: 'Maintain weight',
    maintain: 'Maintain weight', buildmuscle: 'Muscle gain', gainweight: 'Muscle gain',
  };

  // ── Defaults ──
  function defaultAdult(name) {
    return {
      name: name || '', age: '', sex: 'Prefer not to say', activity: 'Moderately active',
      height: '', weight: '', target: '',
      goal: 'maintain', rate: 'steady', emphasis: [],
      allergies: '', dislikes: '',
      eating: { breakfast: 'quick', lunch: 'leftovers', snacks: 2 },
      training: { on: false, sport: '', intensity: 'moderate', sessionsPerWeek: '', weeksToEvent: '', eventDate: '', carbLoad: 'auto', days: [] },
    };
  }
  function defaultProfile() {
    return {
      adults: [defaultAdult('')],
      children: [],                                   // [{ age }]
      kids: { allergies: '', dislikes: '', eating: { breakfast: 'quick', weekdayLunch: 'packed', snacks: 1 } },
      shop: { retailer: 'Tesco', range: 'mid' },
    };
  }

  // ── Helpers ──
  const arr = (v) => Array.isArray(v) ? v : [];
  const clampGoal = (g) => GOALS.indexOf(g) >= 0 ? g : 'maintain';
  const clampRate = (r) => RATES.indexOf(r) >= 0 ? r : 'steady';
  const clampRange = (t) => RANGES.indexOf(t) >= 0 ? t : 'mid';

  // ─────────────────────────────────────────────
  // FLAT client_data  →  NESTED profile
  //   input: the /api/clients GET payload shape
  //   { client_data, children, retailer, tier }
  // ─────────────────────────────────────────────
  function fromClientData(row) {
    row = row || {};
    const c = row.client_data || row.client || {};
    const p = defaultProfile();

    const a1 = defaultAdult(c.fname || '');
    a1.name = c.fname || ''; a1.lastName = c.lname || '';
    a1.age = c.age ?? ''; a1.sex = c.sex || a1.sex; a1.activity = c.activity || a1.activity;
    a1.height = c.height ?? ''; a1.weight = c.weight ?? ''; a1.target = c.tweight ?? '';
    a1.goal = clampGoal(c.goal || legacyToGoal(c.goals));
    a1.rate = clampRate(c.rate);
    a1.emphasis = arr(c.emphasis);
    a1.allergies = c.allergies || ''; a1.dislikes = c.dislikes || '';
    a1.eating = readEating(c.eatingPattern && c.eatingPattern.adult1, { breakfast: 'quick', lunch: 'leftovers', snacks: 2 });
    a1.training = readTraining(c, '');
    p.adults = [a1];

    if (c.hasAdult2) {
      const a2 = defaultAdult(c.adult2name || 'Partner');
      a2.name = c.adult2name || ''; a2.age = c.adult2age ?? '';
      a2.sex = c.adult2sex || a2.sex; a2.activity = c.adult2activity || a2.activity;
      a2.height = c.adult2height ?? ''; a2.weight = c.adult2weight ?? ''; a2.target = c.adult2target ?? '';
      a2.goal = clampGoal(c.adult2goal); a2.rate = clampRate(c.adult2rate);
      a2.emphasis = arr(c.adult2emphasis);
      a2.allergies = c.adult2allergies || ''; a2.dislikes = c.adult2dislikes || '';
      a2.eating = readEating(c.eatingPattern && c.eatingPattern.adult2, { breakfast: 'plan', lunch: 'quick', snacks: 2 });
      a2.training = readTraining(c, 'adult2');
      p.adults.push(a2);
    }

    p.children = arr(row.children).map(ch => ({ age: ch.age ?? '' }));
    p.kids.allergies = c.kidsAllergies || '';
    p.kids.dislikes = c.kidsDislikes || '';
    p.kids.eating = {
      breakfast: (c.eatingPattern && c.eatingPattern.kids && c.eatingPattern.kids.breakfast) || 'quick',
      weekdayLunch: (c.eatingPattern && c.eatingPattern.kids && c.eatingPattern.kids.weekdayLunch) || 'packed',
      snacks: (c.eatingPattern && c.eatingPattern.kids && c.eatingPattern.kids.snacks) ?? 1,
    };

    p.shop.retailer = row.retailer || c.retailer || 'Tesco';
    p.shop.range = clampRange(row.tier || c.tier);
    return p;
  }

  function readEating(e, dflt) {
    e = e || {};
    return { breakfast: e.breakfast || dflt.breakfast, lunch: e.lunch || dflt.lunch, snacks: e.snacks ?? dflt.snacks };
  }
  function readTraining(c, prefix) {
    const g = (k) => c[prefix ? prefix + k[0].toUpperCase() + k.slice(1) : k];
    const on = prefix ? !!c.adult2hasSports : !!c.hasSports;
    return {
      on,
      sport: (prefix ? c.adult2sport : c.sport) || '',
      intensity: (prefix ? c.adult2intensity : c.intensity) || 'moderate',
      sessionsPerWeek: (prefix ? c.adult2trainDays : c.trainDays) || '',
      weeksToEvent: (prefix ? c.adult2weeksToEvent : c.weeksToEvent) || '',
      eventDate: (prefix ? c.adult2eventDate : c.eventDate) || '',
      carbLoad: (prefix ? c.adult2carbLoad : c.carbLoad) || 'auto',
      days: arr(prefix ? c.adult2trainingDays : c.trainingDays),
    };
  }
  function legacyToGoal(goals) {
    const a = arr(goals).map(x => String(x).toLowerCase());
    if (a.some(x => x.includes('weight loss') || x.includes('fat loss'))) return 'loseweight';
    if (a.some(x => x.includes('muscle'))) return 'buildmuscle';
    return 'maintain';
  }

  // ─────────────────────────────────────────────
  // NESTED profile  →  FLAT /api/clients POST body
  //   returns { client, children, sharingMode, retailer, tier }
  //   `client` is stored verbatim into client_data.
  // ─────────────────────────────────────────────
  function toClientData(profile) {
    const p = profile || defaultProfile();
    const a1 = p.adults[0] || defaultAdult('');
    const a2 = p.adults[1] || null;

    const client = {
      // Adult 1 (existing flat keys the backend already reads)
      fname: a1.name || '', lname: a1.lastName || '',
      age: numOrEmpty(a1.age), sex: a1.sex, activity: a1.activity,
      height: numOrEmpty(a1.height), weight: numOrEmpty(a1.weight), tweight: numOrEmpty(a1.target),
      allergies: a1.allergies || '', dislikes: a1.dislikes || '',
      // New model keys (nutrition.js prefers goal/rate; goals[] kept for legacy compat)
      goal: clampGoal(a1.goal), rate: clampRate(a1.rate), emphasis: arr(a1.emphasis),
      goals: [GOAL_TO_LEGACY[clampGoal(a1.goal)]],
      // Sports (adult 1)
      hasSports: !!a1.training.on,
      sport: a1.training.sport || '', intensity: a1.training.intensity || 'moderate',
      trainDays: a1.training.sessionsPerWeek || '', weeksToEvent: a1.training.weeksToEvent || '',
      eventDate: a1.training.eventDate || '', carbLoad: a1.training.carbLoad || 'auto',
      trainingDays: arr(a1.training.days),
      // Per-person allergies (kids) + eating pattern (nested, additive)
      kidsAllergies: p.kids.allergies || '', kidsDislikes: p.kids.dislikes || '',
      eatingPattern: {
        adult1: { breakfast: a1.eating.breakfast, lunch: a1.eating.lunch, snacks: a1.eating.snacks },
        kids: { breakfast: p.kids.eating.breakfast, weekdayLunch: p.kids.eating.weekdayLunch, snacks: p.kids.eating.snacks },
      },
      hasAdult2: !!a2,
    };

    if (a2) {
      Object.assign(client, {
        adult2name: a2.name || 'Partner', adult2age: numOrEmpty(a2.age), adult2sex: a2.sex, adult2activity: a2.activity,
        adult2height: numOrEmpty(a2.height), adult2weight: numOrEmpty(a2.weight), adult2target: numOrEmpty(a2.target),
        adult2goal: clampGoal(a2.goal), adult2rate: clampRate(a2.rate), adult2emphasis: arr(a2.emphasis),
        adult2allergies: a2.allergies || '', adult2dislikes: a2.dislikes || '',
        adult2hasSports: !!a2.training.on, adult2sport: a2.training.sport || '', adult2intensity: a2.training.intensity || 'moderate',
        adult2trainDays: a2.training.sessionsPerWeek || '', adult2weeksToEvent: a2.training.weeksToEvent || '',
        adult2eventDate: a2.training.eventDate || '', adult2carbLoad: a2.training.carbLoad || 'auto',
        adult2trainingDays: arr(a2.training.days),
      });
      client.eatingPattern.adult2 = { breakfast: a2.eating.breakfast, lunch: a2.eating.lunch, snacks: a2.eating.snacks };
    }

    return {
      client,
      children: arr(p.children).map(ch => ({ age: numOrEmpty(ch.age) })),
      sharingMode: 'same',
      retailer: p.shop.retailer || 'Tesco',
      tier: clampRange(p.shop.range),
    };
  }

  function numOrEmpty(v) {
    if (v === '' || v === null || v === undefined) return '';
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }

  return {
    // constants
    GOALS, GOAL_LABELS, RATES, EMPHASIS, RETAILERS, RANGES, RANGE_LABELS, SPORTS, ADULT_LUNCH, KID_LUNCH, GOAL_TO_LEGACY,
    // factory + adapters
    defaultProfile, defaultAdult, fromClientData, toClientData, legacyToGoal,
  };
}));

// ── Round-trip self-test:  node profileModel.js ──
if (typeof require !== 'undefined' && require.main === module) {
  const M = module.exports;
  const assert = require('assert');

  // 1. A full nested profile → flat → back must be stable
  const p = M.defaultProfile();
  p.adults[0] = Object.assign(M.defaultAdult('Joe'), {
    lastName: 'C', age: 42, sex: 'Male', activity: 'Moderately active', height: 182, weight: 79, target: 76,
    goal: 'losefat', rate: 'steady', emphasis: ['Energy'], allergies: 'No shellfish', dislikes: 'Olives',
    eating: { breakfast: 'quick', lunch: 'leftovers', snacks: 2 },
    training: { on: false, sport: '', intensity: 'moderate', sessionsPerWeek: '', weeksToEvent: '', eventDate: '', carbLoad: 'auto', days: [] },
  });
  p.adults.push(Object.assign(M.defaultAdult('Sarah'), {
    age: 39, sex: 'Female', activity: 'Very active', height: 168, weight: 63, target: 63,
    goal: 'maintain', rate: 'steady', emphasis: ['Energy', 'Recovery', 'Longevity'], dislikes: 'Blue cheese',
    eating: { breakfast: 'plan', lunch: 'quick', snacks: 2 },
    training: { on: true, sport: 'Cycling', intensity: 'moderate', sessionsPerWeek: 4, weeksToEvent: 12, eventDate: '', carbLoad: 'auto', days: ['Tue', 'Thu', 'Sat', 'Sun'] },
  }));
  p.children = [{ age: 6 }, { age: 9 }];
  p.kids = { allergies: '', dislikes: 'Anything too spicy', eating: { breakfast: 'quick', weekdayLunch: 'packed', snacks: 1 } };
  p.shop = { retailer: 'Tesco', range: 'mid' };

  const flat = M.toClientData(p);
  const back = M.fromClientData({ client_data: flat.client, children: flat.children, retailer: flat.retailer, tier: flat.tier });

  assert.strictEqual(back.adults.length, 2, 'two adults');
  assert.strictEqual(back.adults[0].goal, 'losefat');
  assert.strictEqual(back.adults[0].name, 'Joe');
  assert.strictEqual(back.adults[1].training.on, true);
  assert.deepStrictEqual(back.adults[1].training.days, ['Tue', 'Thu', 'Sat', 'Sun']);
  assert.strictEqual(back.adults[1].goal, 'maintain');
  assert.strictEqual(back.children.length, 2);
  assert.strictEqual(back.kids.eating.weekdayLunch, 'packed');
  assert.strictEqual(back.shop.range, 'mid');
  assert.strictEqual(flat.client.goals[0], 'Weight loss', 'legacy goals[] mirror set for losefat');

  // 2. Legacy import: an OLD profile (goals[] only, no goal key) must resolve
  const legacy = M.fromClientData({ client_data: { fname: 'Old', age: 30, goals: ['Muscle gain'] }, retailer: 'Ocado', tier: 'organic' });
  assert.strictEqual(legacy.adults[0].goal, 'buildmuscle', 'legacy goals[] → goal');
  assert.strictEqual(legacy.shop.range, 'organic');

  console.log('profileModel round-trip: ALL ASSERTIONS PASSED');
  console.log('  adult1 goal:', back.adults[0].goal, '| legacy mirror goals:', flat.client.goals);
  console.log('  adult2:', back.adults[1].name, back.adults[1].training.sport, back.adults[1].training.days.join('/'));
  console.log('  children:', back.children.length, '| kids lunch:', back.kids.eating.weekdayLunch, '| shop:', back.shop.retailer, back.shop.range);
}
