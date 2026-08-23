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
    var filtered = [];   // המצב אחרי כל עדכון
    var predicted = [];  // הניבוי ליום הבא, לפני שראינו אותו

    days.forEach(function (day) {
      // המשקל שהמסנן ניבא לבוקר הזה, לפני שראה את השקילה.
      // נשמר כדי שאפשר יהיה להציג את החשבון עצמו: ניבוי, מדידה, תיקון.
      var predictedWeight = w;
      var tdeeBefore = e;
      var residual = isNum(day.weight) ? day.weight - w : null;

      // --- עדכון לפי השקילה של הבוקר ---
      if (isNum(day.weight)) {
        var s = p00 + o.measurementVar;
        var k0 = p00 / s;
        var k1 = p10 / s;

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
        predictedWeight: predictedWeight,
        measuredWeight: isNum(day.weight) ? day.weight : null,
        residual: residual,
        tdeeBefore: tdeeBefore,
        intake: isNum(day.intake) ? day.intake : null,
        weight: w,
        tdee: e,
        tdeeSd: Math.sqrt(Math.max(p11, 0)),
        weightSd: Math.sqrt(Math.max(p00, 0)),
        observed: isNum(day.weight),
        logged: isNum(day.intake)
      });

      // נשמר עבור המעבר לאחור: המצב והשונות אחרי העדכון
      filtered.push({ w: w, e: e, P: [[p00, p01], [p10, p11]] });

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

      predicted.push({ w: w, e: e, P: [[p00, p01], [p10, p11]], f: f });
    });

    smoothBackward(states, filtered, predicted);

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

  // --- אלגברה של מטריצות 2x2, לצורך המעבר לאחור ---

  function inverse2(m) {
    var det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
    if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
    return [[m[1][1] / det, -m[0][1] / det], [-m[1][0] / det, m[0][0] / det]];
  }

  function multiply2(a, b) {
    return [
      [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
      [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]]
    ];
  }

  function transpose2(m) {
    return [[m[0][0], m[1][0]], [m[0][1], m[1][1]]];
  }

  /**
   * מעבר לאחור (RTS smoother).
   *
   * המסנן הרגיל מעריך כל יום לפי מה שידע עד אותו רגע בלבד. אבל כשמסתכלים
   * על ההיסטוריה, כבר ידוע מה קרה אחר כך — ואפשר להשתמש בזה כדי לשפר
   * את ההערכה של העבר. זו הסיבה שהקו ההיסטורי חלק יותר מהקו המסונן,
   * בלי שהוא "מוחלק" מלאכותית: הוא פשוט מבוסס על יותר מידע.
   *
   * ההערכה של היום האחרון זהה בשתי השיטות — אין עתיד שישפר אותה.
   */
  function smoothBackward(states, filtered, predicted) {
    var n = states.length;
    if (!n) return;

    var last = filtered[n - 1];
    var sw = last.w, se = last.e, sP = last.P;
    states[n - 1].smoothWeight = sw;
    states[n - 1].smoothTdee = se;
    states[n - 1].smoothTdeeSd = Math.sqrt(Math.max(sP[1][1], 0));

    for (var t = n - 2; t >= 0; t--) {
      var f = predicted[t];               // הניבוי ליום t+1
      var pInv = inverse2(f.P);
      if (!pInv) {
        states[t].smoothWeight = filtered[t].w;
        states[t].smoothTdee = filtered[t].e;
        states[t].smoothTdeeSd = Math.sqrt(Math.max(filtered[t].P[1][1], 0));
        continue;
      }

      var F = [[1, f.f], [0, 1]];
      var C = multiply2(multiply2(filtered[t].P, transpose2(F)), pInv);

      var dw = sw - f.w;
      var de = se - f.e;
      sw = filtered[t].w + C[0][0] * dw + C[0][1] * de;
      se = filtered[t].e + C[1][0] * dw + C[1][1] * de;

      var diff = [[sP[0][0] - f.P[0][0], sP[0][1] - f.P[0][1]],
                  [sP[1][0] - f.P[1][0], sP[1][1] - f.P[1][1]]];
      sP = (function (P, C2, D) {
        var m = multiply2(multiply2(C2, D), transpose2(C2));
        return [[P[0][0] + m[0][0], P[0][1] + m[0][1]],
                [P[1][0] + m[1][0], P[1][1] + m[1][1]]];
      })(filtered[t].P, C, diff);

      states[t].smoothWeight = sw;
      states[t].smoothTdee = se;
      states[t].smoothTdeeSd = Math.sqrt(Math.max(sP[1][1], 0));
    }
  }

  root.Kalman = { run: run, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
