/**
 * Stats — פונקציות סטטיסטיקה טהורות.
 * ללא תלות ב-DOM, כדי שאפשר יהיה לבדוק אותן ב-node (ראה tests/run-tests.js).
 */
(function (root) {
  'use strict';

  /** מסנן ערכים שאינם מספרים סופיים */
  function clean(values) {
    return values.filter(function (v) {
      return typeof v === 'number' && isFinite(v);
    });
  }

  function sum(values) {
    return clean(values).reduce(function (a, b) { return a + b; }, 0);
  }

  function mean(values) {
    var v = clean(values);
    return v.length ? sum(v) / v.length : null;
  }

  function median(values) {
    var v = clean(values).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /** סטיית תקן של מדגם (n-1). דורש לפחות 2 ערכים. */
  function stdDev(values) {
    var v = clean(values);
    if (v.length < 2) return null;
    var m = mean(v);
    var ss = v.reduce(function (acc, x) { return acc + (x - m) * (x - m); }, 0);
    return Math.sqrt(ss / (v.length - 1));
  }

  function min(values) {
    var v = clean(values);
    return v.length ? Math.min.apply(null, v) : null;
  }

  function max(values) {
    var v = clean(values);
    return v.length ? Math.max.apply(null, v) : null;
  }

  /**
   * רגרסיה לינארית בשיטת הריבועים הפחותים.
   * points: [{x, y}]
   * מחזיר גם שגיאת תקן של השיפוע — זה מה שמאפשר לתת רווח סמך
   * במקום מספר יחיד שמתחזה לוודאות.
   */
  function linearRegression(points) {
    var p = (points || []).filter(function (pt) {
      return pt && isFinite(pt.x) && isFinite(pt.y);
    });
    var n = p.length;
    if (n < 2) return null;

    var mx = mean(p.map(function (pt) { return pt.x; }));
    var my = mean(p.map(function (pt) { return pt.y; }));

    var sxx = 0, sxy = 0;
    p.forEach(function (pt) {
      sxx += (pt.x - mx) * (pt.x - mx);
      sxy += (pt.x - mx) * (pt.y - my);
    });
    if (sxx === 0) return null; // כל המדידות באותו יום — אין שיפוע

    var slope = sxy / sxx;
    var intercept = my - slope * mx;

    var sse = 0, sst = 0;
    p.forEach(function (pt) {
      var fit = intercept + slope * pt.x;
      sse += (pt.y - fit) * (pt.y - fit);
      sst += (pt.y - my) * (pt.y - my);
    });

    var r2 = sst === 0 ? 1 : 1 - sse / sst;
    // שגיאת תקן של השיפוע. עם n=2 אין דרגות חופש להערכת שונות.
    var seSlope = n > 2 ? Math.sqrt((sse / (n - 2)) / sxx) : null;

    return {
      slope: slope,
      intercept: intercept,
      r2: r2,
      n: n,
      seSlope: seSlope,
      // רווח סמך 95% מקורב (t≈1.96; שמרני מספיק עבור n>15, אופטימי מעט מתחת לזה)
      ci95: seSlope === null ? null : 1.96 * seSlope,
      at: function (x) { return intercept + slope * x; }
    };
  }

  /** שורש סכום ריבועים — לשילוב מקורות אי־ודאות בלתי תלויים */
  function combineErrors(errors) {
    var e = clean(errors);
    if (!e.length) return null;
    return Math.sqrt(e.reduce(function (acc, x) { return acc + x * x; }, 0));
  }

  function round(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return null;
    var f = Math.pow(10, digits || 0);
    return Math.round(value * f) / f;
  }

  root.Stats = {
    clean: clean,
    sum: sum,
    mean: mean,
    median: median,
    stdDev: stdDev,
    min: min,
    max: max,
    linearRegression: linearRegression,
    combineErrors: combineErrors,
    round: round
  };
})(typeof window !== 'undefined' ? window : globalThis);
