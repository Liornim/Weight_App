/**
 * Kalman — מסנן קלמן דו־מצבי להערכת TDEE מסתגל.
 *
 * הרעיון (מיושם כאן מאפס לפי המודל הפיזיקלי, לא מועתק מאף פרויקט):
 * המצב הנסתר הוא שני מספרים — משקל "אמיתי" נקי מרעש נוזלים, וההוצאה
 * האנרגטית היומית. משוואת המעבר היא פשוט מאזן אנרגיה:
 *
 *     משקל_מחר = משקל_היום + (צריכה − הוצאה) / קק״ל_לק״ג
 *     הוצאה_מחר = הוצאה_היום            (עם רעש שמאפשר לה לנוע לאט)
 *
 * וההסתכלות היחידה שיש לנו היא השקילה, שרועשת בקילוגרם שלם בגלל
 * מלח, פחמימות ושעת השקילה.
 *
 * מה זה נותן מעבר לרגרסיה על חלון קבוע:
 * הרגרסיה מניחה שה-TDEE קבוע לאורך כל החלון ומשקללת את כל הימים שווה.
 * המסנן מעדכן את ההערכה בכל יום, נותן משקל גדול יותר לימים אחרונים,
 * ולכן מזהה שינוי מטבולי אמיתי תוך שבועיים במקום להמתין לחלון שלם.
 * הוא גם מטפל בימים חסרים בלי להתעלם מהם: יום בלי שקילה הוא ניבוי
 * בלי עדכון, ויום בלי דיווח קלוריות רק מגדיל את אי־הוודאות.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    kcalPerKg: 7700,
    // שונות רעש המדידה בשקילה. 0.36 = סטיית תקן של 600 גרם ביום.
    measurementVar: 0.36,
    // כמה המשקל "האמיתי" רשאי לזוז מיום ליום מעבר למאזן האנרגיה
    weightProcessVar: 0.0025,
    // כמה ה-TDEE רשאי לנוע ביום. זו הידית החשובה ביותר, והיא איזון:
    // ערך נמוך נותן הערכה יציבה שמפגרת אחרי שינוי מטבולי אמיתי,
    // ערך גבוה עוקב מהר אך רודף אחרי רעש ומרחיב את רווח הסמך.
    // נמדד על סדרות סינתטיות עם קפיצה ידועה של 400 קק״ל:
    //   var=100  → מגיע ל-2465 במקום 2300, רווח ±155
    //   var=900  → מגיע ל-2349, רווח ±285   ← נבחר
    //   var=3600 → מגיע ל-2283, רווח ±450
    // 900 = סטיית תקן של 30 קק״ל ליום, כלומר כ-80 קק״ל בשבוע.
    tdeeProcessVar: 900,
    // שגיאת דיווח יחסית של הקלוריות. 0.12 = הנחה של 12% אי־דיוק,
    // שמרנית ביחס למחקרים על דיווח עצמי.
    intakeRelativeError: 0.12,
    // אי־ודאות התחלתית
    initialWeightVar: 0.5,
    initialTdeeVar: 250000 // סטיית תקן של 500 קק״ל
  };

  /**
   * @param {Array} days [{date, weight|null, intake|null}] ברצף יומי
   * @param {Object} options ראה DEFAULTS, ובנוסף initialTdee
   * @returns {{ok, states, final}}
   */
  function run(days, options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    var K = o.kcalPerKg;

    var known = days.filter(function (d) { return isNum(d.intake); }).map(function (d) { return d.intake; });
    var firstWeight = days.find(function (d) { return isNum(d.weight); });
    if (!firstWeight || known.length < 3) {
      return { ok: false, reason: known.length < 3 ? 'intake' : 'weight', states: [] };
    }

    var meanIntake = known.reduce(function (a, b) { return a + b; }, 0) / known.length;
    var intakeVar = known.length > 1
      ? known.reduce(function (acc, v) { return acc + Math.pow(v - meanIntake, 2); }, 0) / (known.length - 1)
      : Math.pow(meanIntake * 0.3, 2);

    // מצב התחלתי: המשקל הראשון, וההוצאה — ניחוש חיצוני אם ניתן,
    // אחרת הצריכה הממוצעת (כלומר הנחה של אחזקה).
    var w = firstWeight.weight;
    var e = isNum(o.initialTdee) ? o.initialTdee : meanIntake;

    // מטריצת השונות המשותפת, סימטרית 2x2
    var p00 = o.initialWeightVar, p01 = 0, p10 = 0, p11 = o.initialTdeeVar;

    var states = [];

    days.forEach(function (day) {
      // --- עדכון לפי השקילה של הבוקר ---
      if (isNum(day.weight)) {
        var s = p00 + o.measurementVar;
        var k0 = p00 / s;
        var k1 = p10 / s;
        var residual = day.weight - w;

        w = w + k0 * residual;
        e = e + k1 * residual;

        var n00 = (1 - k0) * p00;
        var n01 = (1 - k0) * p01;
        var n10 = p10 - k1 * p00;
        var n11 = p11 - k1 * p01;
        p00 = n00; p01 = n01; p10 = n10; p11 = n11;
      }

      states.push({
        date: day.date,
        weight: w,
        tdee: e,
        tdeeSd: Math.sqrt(Math.max(p11, 0)),
        weightSd: Math.sqrt(Math.max(p00, 0)),
        observed: isNum(day.weight),
        logged: isNum(day.intake)
      });

      // --- ניבוי ליום הבא לפי מאזן האנרגיה של היום ---
      var intake = isNum(day.intake) ? day.intake : meanIntake;
      // אי־הוודאות בצריכה מתורגמת לאי־ודאות במשקל דרך K
      var intakeSigma = isNum(day.intake)
        ? day.intake * o.intakeRelativeError
        : Math.sqrt(intakeVar);            // יום לא מדווח: כל הפיזור ההיסטורי
      var qWeight = o.weightProcessVar + Math.pow(intakeSigma / K, 2);

      w = w + (intake - e) / K;
      // e נשאר; המעבר הוא F = [[1, -1/K], [0, 1]]
      var f = -1 / K;
      var a00 = p00 + f * p10 + f * (p01 + f * p11);
      var a01 = p01 + f * p11;
      var a10 = p10 + f * p11;
      var a11 = p11;

      p00 = a00 + qWeight;
      p01 = a01;
      p10 = a10;
      p11 = a11 + o.tdeeProcessVar;
    });

    var final = states[states.length - 1];
    return {
      ok: true,
      states: states,
      final: {
        date: final.date,
        tdee: final.tdee,
        tdeeSd: final.tdeeSd,
        ci95: 1.96 * final.tdeeSd,
        trendWeight: final.weight,
        observedDays: states.filter(function (s) { return s.observed; }).length,
        loggedDays: states.filter(function (s) { return s.logged; }).length,
        totalDays: states.length,
        meanIntake: meanIntake
      }
    };
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  root.Kalman = { run: run, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
