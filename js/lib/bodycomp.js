/**
 * BodyComp — משוואות מפורסמות להערכת הרכב גוף וקצב חילוף חומרים.
 *
 * כל הנוסחאות כאן מפורסמות בספרות ומיושמות מחדש מהמשוואה עצמה.
 * הן לא מחליפות את מדידות המשקל החכם — הן משמשות כבדיקת שפיות:
 * כשהמדידה של המשקל רחוקה מאוד מכל האומדנים, זה סימן שהמשקל
 * מודד גרוע (ביו־אימפדנס רגיש מאוד לרמת הנוזלים ולטמפרטורת העור).
 */
(function (root) {
  'use strict';

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  function bmi(weightKg, heightCm) {
    var w = num(weightKg), h = num(heightCm);
    if (w === null || h === null || h <= 0) return null;
    return w / Math.pow(h / 100, 2);
  }

  /** Deurenberg 1991 — אחוז שומן מ-BMI, גיל ומין */
  function bodyFatDeurenberg(weightKg, heightCm, ageYears, sex) {
    var b = bmi(weightKg, heightCm), age = num(ageYears);
    if (b === null || age === null) return null;
    var male = sex === 'female' ? 0 : 1;
    return 1.20 * b + 0.23 * age - 10.8 * male - 5.4;
  }

  /** Boer 1984 — מסת גוף רזה */
  function leanBoer(weightKg, heightCm, sex) {
    var w = num(weightKg), h = num(heightCm);
    if (w === null || h === null) return null;
    return sex === 'female'
      ? 0.252 * w + 0.473 * h - 48.3
      : 0.407 * w + 0.267 * h - 19.2;
  }

  /** Hume 1966 — מסת גוף רזה, אומדן שני להשוואה */
  function leanHume(weightKg, heightCm, sex) {
    var w = num(weightKg), h = num(heightCm);
    if (w === null || h === null) return null;
    return sex === 'female'
      ? 0.29569 * w + 0.41813 * h - 43.2933
      : 0.32810 * w + 0.33929 * h - 29.5336;
  }

  /** Mifflin-St Jeor 1990 — קצב חילוף חומרים במנוחה */
  function bmrMifflin(weightKg, heightCm, ageYears, sex) {
    var w = num(weightKg), h = num(heightCm), age = num(ageYears);
    if (w === null || h === null || age === null) return null;
    var base = 10 * w + 6.25 * h - 5 * age;
    return sex === 'female' ? base - 161 : base + 5;
  }

  /** Katch-McArdle — מבוסס מסה רזה, מדויק יותר כשהיא ידועה */
  function bmrKatchMcArdle(leanKg) {
    var lean = num(leanKg);
    return lean === null ? null : 370 + 21.6 * lean;
  }

  /**
   * בדיקת שפיות למדידת השומן של המשקל: משווה את הקריאה
   * לאומדנים מהנוסחאות ומחזיר את הפער.
   */
  function fatCrossCheck(measuredFatKg, weightKg, heightCm, ageYears, sex) {
    var measured = num(measuredFatKg), w = num(weightKg);
    var pctDeurenberg = bodyFatDeurenberg(w, heightCm, ageYears, sex);
    var boer = leanBoer(w, heightCm, sex);
    var hume = leanHume(w, heightCm, sex);

    var estimates = [];
    if (pctDeurenberg !== null && w !== null) estimates.push(w * pctDeurenberg / 100);
    if (boer !== null && w !== null) estimates.push(w - boer);
    if (hume !== null && w !== null) estimates.push(w - hume);
    if (!estimates.length) return { ok: false, reason: 'profile' };

    var mean = estimates.reduce(function (a, b) { return a + b; }, 0) / estimates.length;
    return {
      ok: true,
      measured: measured,
      estimates: estimates,
      estimateMean: mean,
      spread: Math.max.apply(null, estimates) - Math.min.apply(null, estimates),
      gap: measured === null ? null : measured - mean,
      measuredPct: (measured !== null && w) ? (measured / w) * 100 : null,
      estimatePct: w ? (mean / w) * 100 : null
    };
  }

  root.BodyComp = {
    bmi: bmi,
    bodyFatDeurenberg: bodyFatDeurenberg,
    leanBoer: leanBoer,
    leanHume: leanHume,
    bmrMifflin: bmrMifflin,
    bmrKatchMcArdle: bmrKatchMcArdle,
    fatCrossCheck: fatCrossCheck
  };
})(typeof window !== 'undefined' ? window : globalThis);
