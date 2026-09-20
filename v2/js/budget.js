/**
 * Budget — טאב התקציב.
 *
 * התחזוקה נמדדת מהשוואת מקטעים גדולים — חצי, שליש או רבע מהתקופה —
 * ולא מחלונות קצרים. זו המסקנה מבדיקה על נתונים אמיתיים: חלון של
 * שבוע נתן "תחזוקה" שנעה בין 1,300 ל-3,600, בעוד חלוקה לחצי נתנה
 * תשובה אחת יציבה.
 *
 * מהתחזוקה נגזר תקציב אחד, קבוע לכל השורות, וכל אורכי החלון נמדדים
 * מולו. עמודת "בפועל" היא בדיקת האיכות: אם המשקל זז אחרת ממה שהמאזן
 * חוזה לאורך כל השורות, התקציב עצמו שגוי.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts;

  /**
   * שתי משפחות של מקטעים.
   *
   * חצי, שליש ורבע גדלים ככל שהמעקב מתארך — חצי תמיד יהיה חצי.
   * 10 ו-21 ימים קבועים באורכם ומספרם גדל, וזה מה שמאפשר להשוות
   * בין תקופות רחוקות ולראות אם התחזוקה עצמה זזה.
   */
  var SPLITS = [
    { value: 2, label: 'חצי' },
    { value: 3, label: 'שליש' },
    { value: 4, label: 'רבע' },
    { value: 'd10', label: '10 ימים' },
    { value: 'd21', label: '21 ימים' },
    { value: 'fit', label: 'מותאם לכולם' },
    { value: 'manual', label: 'ידני' },
    { value: 'formula', label: 'לפי נוסחה' }
  ];

  var LENGTHS = [3, 5, 7, 10, 14, 21, 28];

  /**
   * אילו אורכי חלון להציג.
   *
   * "הכל" הוא כל אורך מ-3 עד 28. הוא ארוך מדי לרוב השימושים, ולכן
   * ברירת המחדל היא קבוצה מייצגת — אבל כשמחפשים משהו ספציפי, הצגת
   * כולם היא מה שמאפשרת לראות איפה המספרים מתייצבים.
   */
  var WINDOW_SETS = [
    { value: 'few', label: 'עיקריים' },
    { value: 'short', label: 'קצרים' },
    { value: 'long', label: 'ארוכים' },
    { value: 'all', label: 'הכל' }
  ];

  function lengthsOf(state) {
    var set = state.budgetWindows;
    if (set === 'all') return P.WINDOWS;
    if (set === 'short') return P.WINDOWS.filter(function (d) { return d <= 10; });
    if (set === 'long') return P.WINDOWS.filter(function (d) { return d >= 10; });
    return LENGTHS;
  }

  var ANCHORS = [
    { value: 'end', label: 'עד היום' },
    { value: 'start', label: 'מתחילת המעקב' }
  ];

  var WALK_MODES = [
    { value: 'on', label: 'עם הליכה רגילה' },
    { value: 'off', label: 'בלי הליכה' }
  ];

  function partsOf(state) {
    var n = Number(state.splitParts);
    return (n === 2 || n === 3 || n === 4) ? n : 2;
  }

  function isFit(state) {
    return state.splitParts === 'fit';
  }

  function isManual(state) {
    return state.splitParts === 'manual';
  }

  function isFormula(state) {
    return state.splitParts === 'formula';
  }

  /**
   * הערכים הידניים.
   *
   * כשמזינים תחזוקה או צעדים ידנית, המספר גובר על כל מדידה. זה
   * שימושי כדי לבדוק תרחיש — "מה אם התחזוקה שלי 2,600" — ולא רק
   * כדי לעקוף את החישוב.
   */
  function manualValues(settings, state) {
    var saved = settings.manual || {};
    var maintenance = Fmt.isNum(state.manualMaintenance)
      ? state.manualMaintenance
      : (Fmt.isNum(saved.maintenance) ? saved.maintenance : 2400);
    var steps = Fmt.isNum(state.manualSteps)
      ? state.manualSteps
      : (Fmt.isNum(saved.steps) ? saved.steps : 9000);

    return { maintenance: maintenance, steps: steps };
  }

  /** אורך קבוע למקטע, או 0 לחלוקה לחלקים */
  function sizeOf(state) {
    var v = String(state.splitParts || '');
    return v.indexOf('d') === 0 ? Number(v.slice(1)) : 0;
  }

  /** האפשרויות מועברות למנוע בצורה שהוא מבין */
  function splitOptions(state) {
    var size = sizeOf(state);
    return size ? { size: size } : { parts: partsOf(state) };
  }

  function anchorOf(state) {
    return state.splitAnchor === 'start' ? 'start' : 'end';
  }

  /** האם ההליכה נכללת בתקציב */
  function withWalk(state) {
    return state.budgetWalk !== 'off';
  }

  /** המקטע שנבחר; ברירת המחדל היא האחרון */
  function chosenRow(split, state) {
    if (state.splitRow) {
      var found = split.rows.filter(function (r) {
        return String(r.index) === String(state.splitRow) &&
          Fmt.isNum(r.maintenance);
      })[0];
      if (found) return found;
    }
    return split.selected;
  }

  /**
   * שורת הכותרת: כמה זמן נמדד, וממתי.
   *
   * אורך המעקב הוא מה שקובע כמה אפשר לסמוך על המספרים שמתחת —
   * חלוקה לרבע על חודש נותנת מקטעים של שבוע, וכאלה נבלעים ברעש.
   */
  function trackCard(entries, state) {
    if (!entries.length) return '';

    var first = entries[0].date;
    var last = entries[entries.length - 1].date;
    var span = Dates.diffDays(first, last) + 1;

    var weighed = entries.filter(function (e) { return Fmt.isNum(e.weightKg); }).length;
    var eaten = entries.filter(function (e) { return Fmt.isNum(e.kcal); }).length;

    // גודל המקטע בחלוקה הנוכחית — זה מה שבאמת קובע את הרעש
    var size = sizeOf(state) || Math.floor(entries.length / partsOf(state));

    return P.card(null, null,
      P.tiles([
        P.tile('', 'ימים במעקב', span, Dates.short(first) + ' ואילך'),
        P.tile('', 'שקילות', weighed, 'ימי אוכל ' + eaten),
        P.tile(size < 14 ? 'warn' : 'good', 'מקטע', size + ' ימים',
          'בחלוקה הנוכחית')
      ]) +
      (size < 14
        ? P.hint('מקטע של ' + size + ' ימים קצר יחסית לתנודה היומית שלך, ' +
          'ולכן התחזוקה שנגזרת ממנו רועשת. חלוקה גסה יותר תיתן מספר יציב יותר.')
        : ''));
  }

  /** טבלת המקטעים — מאיפה המספר מגיע */
  function splitCard(split, chosen, state) {
    var rows = split.rows.map(function (r) {
      var active = r === chosen;
      return '<tr' + (active ? ' class="now"' : '') +
        ' data-split-row="' + r.index + '">' +
        '<td class="n">' + r.index + (active ? ' ✓' : '') + '</td>' +
        '<td class="date-cell">' + P.esc(Dates.short(r.from) + '–' + Dates.short(r.to)) +
          '<span class="sub' + (r.full ? '' : ' warn') + '">' + r.days + ' ימים' +
          (r.full ? '' : ' · חלקי') + '</span></td>' +
        '<td class="n">' + (Fmt.isNum(r.weight) ? Fmt.n(r.weight, 2) : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.change) ? P.delta(r.change, 2, 'down') : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.kcal) ? Fmt.n(r.kcal, 0) : '—') + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.steps) ? Fmt.n(r.steps, 0) : '—') + '</td>' +
        '<td class="n"><strong>' +
          (Fmt.isNum(r.maintenance) ? Fmt.n(r.maintenance, 0) : '—') +
        '</strong></td></tr>';
    }).join('');

    return P.card('מול מה אני נמדד', 'כל מקטע מושווה לזה שלפניו',
      '<label class="pick-label">מאיפה לספור</label>' +
      P.chips(ANCHORS, anchorOf(state), 'data-anchor') +
      P.table(
        [{ label: '#', n: true }, { label: 'תקופה', n: true },
          'משקל', 'שינוי', 'אכלת', 'צעדים', 'תחזוקה'],
        [rows],
        { hint: 'אפשר ללחוץ על שורה כדי למדוד מולה. ' +
          '"עד היום" מסיים את המקטע האחרון היום; "מתחילת המעקב" סופר ' +
          'מהשקילה הראשונה, ואז המקטע האחרון עשוי לצאת חלקי ומסומן ככזה. ' +
          'ברירת המחדל היא המקטע המלא האחרון.' }));
  }

  /**
   * המצב המותאם: תחזוקה אחת שמסבירה את כל החלונות.
   *
   * כל מקטע בודד נותן תשובה אחרת, ואין סיבה עקרונית להעדיף אחד.
   * כאן נסרק טווח שלם ונבחר הערך שמקטין את השגיאה הממוצעת על פני
   * כל החלונות — כלומר המספר שהכי פחות סותר את מה שקרה בפועל.
   */
  function fitCard(fit, state) {
    var rows = fit.cases.map(function (c) {
      var big = Math.abs(c.error) > 0.5;
      return '<tr>' +
        '<td class="n">' + c.days + '</td>' +
        '<td class="date-cell">' + P.esc(Dates.short(c.from) + '–' + Dates.short(c.to)) +
        '</td>' +
        '<td class="n">' + Fmt.n(c.kcal, 0) + '</td>' +
        '<td class="n">' + Fmt.n(c.budget, 0) + '</td>' +
        '<td class="n">' + Fmt.signed(c.predicted, 2) + '</td>' +
        '<td class="n">' + P.delta(c.actual, 2, 'down') + '</td>' +
        '<td class="n' + (big ? ' warn' : '') + '">' +
          Fmt.signed(c.error, 2) + '</td></tr>';
    }).join('');

    return P.card('מותאם לכל החלונות',
      fit.cases.length + ' חלונות · 10, 14, 21 ו-27 ימים',
      '<div class="big-number">' +
        '<span class="v num">' + Fmt.n(fit.maintenance, 0) + '</span>' +
        '<span class="u">תחזוקה בלי הליכה</span>' +
      '</div>' +

      P.hint('טווח שקול: ' + Fmt.n(fit.low, 0) + '–' + Fmt.n(fit.high, 0) +
        '. כל ערך בטווח הזה מסביר את הנתונים כמעט באותה מידה, ולכן ' +
        'הדיוק האמיתי כאן הוא בעשרות קלוריות ולא ביחידות.') +

      P.table(
        [{ label: 'ימים', n: true }, { label: 'תקופה', n: true },
          'אכל', 'תקציב', 'צפוי', 'בפועל', 'שגיאה'],
        [rows],
        { hint: 'השגיאה הממוצעת היא ' + Fmt.n(fit.meanError, 2) + ' ק״ג ' +
          'והגדולה ביותר ' + Fmt.n(fit.worstError, 2) + '. הן מתקזזות בין ' +
          'החלונות, אבל אינן קטנות — זה הכי טוב שהנתונים מאפשרים, ' +
          'לא הכי טוב שאפשר.' }));
  }

  /**
   * תחזוקה לפי נוסחה — גיל, מין, גובה ומשקל בלבד.
   *
   * זו נקודת ייחוס ולא מדידה. הערך שלה הוא דווקא בהשוואה: אם מה
   * שנמדד מהנתונים רחוק מכאן ב-500 קלוריות, אחד מהשניים שגוי —
   * וכנראה הרישום התזונתי.
   */
  function formulaCard(f, state) {
    var levels = f.levels.map(function (l) {
      return { value: l.value, label: l.label };
    });

    var sex = f.sex === 'female' ? 'אישה' : 'גבר';

    // כל רמה עם טווח הצעדים שהיא מתארת, כעזר לבחירה
    var guide = f.levels.map(function (l) {
      var active = l.value === f.activity;
      return '<tr' + (active ? ' class="now"' : '') + '>' +
        '<td>' + P.esc(l.label) + (active ? ' ✓' : '') + '</td>' +
        '<td class="sub">' + P.esc(l.steps) + '</td>' +
        '<td class="n">' + Fmt.n(f.bmr * l.factor, 0) + '</td></tr>';
    }).join('');

    return P.card('מול מה אני נמדד', 'Mifflin-St Jeor, הסטנדרט המקובל',

      '<div class="calc num">' +
        'משקל   ' + Fmt.n(f.weight, 1) + ' ק״ג  (ממוצע ' + f.weighIns + ' שקילות)\n' +
        'גובה   ' + Fmt.n(f.heightCm, 0) + ' ס״מ\n' +
        'גיל    ' + Fmt.n(f.age, 0) + '  · ' + sex + '\n' +
        '\n' +
        'BMR    ' + Fmt.n(f.bmr, 0) + '  (שריפה במנוחה מוחלטת)\n' +
        '× ' + Fmt.n(f.factor, 3) + '  =  ' + Fmt.n(f.maintenance, 0) +
      '</div>' +

      '<label class="pick-label">רמת הפעילות</label>' +
      P.chips(levels, f.activity, 'data-activity') +

      P.table(['רמה', 'מתאר', 'תחזוקה'], [guide],
        { hint: (Fmt.isNum(f.recentSteps)
            ? 'בפועל הלכת ' + Fmt.n(f.recentSteps, 0) +
              ' צעדים ביום בשבועיים האחרונים. '
            : '') +
          'המקדם כולל את כל הפעילות היומית, ההליכה בכלל זה — ולכן ' +
          'הצעדים אינם נוספים עליו כאן. בחר לפי כמה אתה זז בסך הכל.' }) +

      P.hint('זו הערכה ולא מדידה: שני אנשים באותו גיל, מין ומשקל יכולים ' +
        'להיבדל ב-300 קלוריות ומעלה. השווה אותה למה שנמדד מהנתונים שלך — ' +
        'פער גדול מרמז שמשהו ברישום אינו מדויק.'));
  }

  /** הזנה ידנית של תחזוקה וצעדים */
  function manualCard(values, settings) {
    return P.card('מול מה אני נמדד', 'מספרים שאתה קובע',

      '<div class="field"><label for="manual-maintenance">' +
        'תחזוקה בלי הליכה</label>' +
        '<input id="manual-maintenance" type="number" inputmode="numeric" ' +
        'min="800" max="6000" step="10" value="' +
        P.esc(String(Math.round(values.maintenance))) + '"></div>' +

      '<div class="field"><label for="manual-steps">צעדים ביום</label>' +
        '<input id="manual-steps" type="number" inputmode="numeric" ' +
        'min="0" max="40000" step="100" value="' +
        P.esc(String(Math.round(values.steps))) + '"></div>' +

      P.hint('שני המספרים גוברים על כל מדידה. שימושי כדי לבדוק תרחיש — ' +
        'מה קורה אם התחזוקה גבוהה ב-200, או אם תלך 12,000 צעדים במקום ' +
        '9,000 — ולראות איך הטבלה שלמטה מגיבה.'));
  }

  /** התקציב עצמו, עם המאקרו */
  function budgetCard(chosen, settings, state) {
    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var kcalPerKg = settings.kcalPerKg || 7700;
    var deficit = (rate * kcalPerKg) / 7;

    /**
     * ההליכה נכללת או לא, לפי הבחירה.
     *
     * "עם הליכה רגילה" מוסיף את ההליכה הממוצעת של המקטע הנבחר —
     * מספר שנמדד מהנתונים, לא הנחה. הוא מוצג במפורש, כדי שיהיה
     * ברור מה "רגילה" אומרת וכדי שאפשר יהיה לעקוב אחריו.
     *
     * "בלי הליכה" הוא התקציב לפני שזזים: כל צעד מגדיל את הגירעון
     * בפועל.
     */
    var walk = withWalk(state);
    var usual = chosen.steps || 0;
    var stepKcal = walk ? (chosen.stepKcal || 0) : 0;
    var budget = chosen.maintenance - deficit + stepKcal;

    var targets = settings.targets || {};
    var protein = Fmt.isNum(targets.proteinG) ? targets.proteinG : 170;
    var fatShare = Fmt.isNum(targets.fatShare) ? targets.fatShare : 0.30;

    var fat = (budget * fatShare) / 9;
    var carbs = Math.max((budget - protein * 4 - fat * 9) / 4, 0);

    var pct = function (grams, perGram) {
      return Math.round(((grams * perGram) / budget) * 100);
    };

    return P.card('התקציב', null,
      P.chips(WALK_MODES, walk ? 'on' : 'off', 'data-walk') +

      '<div class="calc num">' +
        'תחזוקה        ' + Fmt.n(chosen.maintenance, 0) + '\n' +
        'גירעון        −' + Fmt.n(deficit, 0) +
          '  (' + Fmt.n(rate, 2) + ' ק״ג בשבוע)\n' +
        (!walk
          ? 'הליכה         אינה נספרת\n'
          : stepKcal
            ? 'הליכה רגילה   +' + Fmt.n(stepKcal, 0) +
              '  (' + Fmt.n(usual, 0) + ' צעדים)\n'
            : 'הליכה         כלולה במקדם\n') +
      '</div>' +

      '<div class="big-number">' +
        '<span class="v num">' + Fmt.n(budget, 0) + '</span>' +
        '<span class="u">קלוריות ליום</span>' +
      '</div>' +

      P.table(['', { label: 'תקציב', n: true }, { label: 'מהקלוריות', n: true }],
        [
          '<tr><td>חלבון</td><td class="n">' + Fmt.n(protein, 0) + ' ג</td>' +
            '<td class="n">' + pct(protein, 4) + '%</td></tr>' +
          '<tr><td>שומן</td><td class="n">' + Fmt.n(fat, 0) + ' ג</td>' +
            '<td class="n">' + pct(fat, 9) + '%</td></tr>' +
          '<tr><td>פחמימות</td><td class="n">' + Fmt.n(carbs, 0) + ' ג</td>' +
            '<td class="n">' + pct(carbs, 4) + '%</td></tr>'
        ]) +

      P.hint(walk && !stepKcal
        ? 'המקדם שבחרת כולל כבר את ההליכה, ולכן אין מה להוסיף עליו. ' +
          'כדי להתחשב ביותר או פחות הליכה, שנה את הרמה.'
        : walk
        ? '"הליכה רגילה" היא ' + Fmt.n(usual, 0) + ' צעדים — הממוצע שלך ' +
          'במקטע ' + P.esc(Dates.short(chosen.from) + '–' + Dates.short(chosen.to)) +
          ', לא הנחה. ביום שתלך יותר או פחות מזה, הטבלה שלמטה תראה ' +
          'את ההפרש בעמודת "מצעדים".'
        : 'ההליכה אינה נספרת בתקציב, ולכן כל צעד שתלך מגדיל את הגירעון ' +
          'בפועל. זה התקציב שלפני שזזים.'));
  }

  /**
   * ההליכה הרגילה — מה היא, והאם היא זזה.
   *
   * "רגילה" אינו מספר קבוע: הוא הממוצע של המקטע הנבחר, והוא משתנה
   * ככל שההרגלים משתנים. הצגת כל המקטעים זה לצד זה מראה אם ההליכה
   * יציבה או במגמה — וזה משנה את התחזוקה, כי היא נמדדת בניכוי
   * ההליכה של אותו מקטע.
   */
  function walkCard(split, chosen, settings) {
    var perStep = Fmt.isNum(settings.kcalPerStep) ? settings.kcalPerStep : 0.045;

    var rows = split.rows.map(function (r) {
      if (!Fmt.isNum(r.steps)) return '';
      var active = r === chosen;
      var kcal = r.steps * perStep;

      return '<tr' + (active ? ' class="now"' : '') + '>' +
        '<td class="date-cell">' + P.esc(Dates.short(r.from) + '–' + Dates.short(r.to)) +
          (active ? '<span class="sub">הנבחר</span>' : '') + '</td>' +
        '<td class="n">' + Fmt.n(r.steps, 0) + '</td>' +
        '<td class="n">' + Fmt.n(kcal, 0) + '</td>' +
        '<td class="n">' + (Fmt.isNum(r.maintenance) ? Fmt.n(r.maintenance, 0) : '—') +
        '</td></tr>';
    }).join('');

    var withSteps = split.rows.filter(function (r) { return Fmt.isNum(r.steps); });
    var first = withSteps.length ? withSteps[0].steps : null;
    var last = withSteps.length ? withSteps[withSteps.length - 1].steps : null;
    var drift = (first === null || last === null) ? null : last - first;

    return P.card('ההליכה הרגילה', 'הממוצע בכל מקטע',
      P.table(
        [{ label: 'תקופה', n: true }, 'צעדים', 'קק״ל', 'תחזוקה'],
        [rows],
        { hint: 'התחזוקה נמדדת בניכוי ההליכה של אותו מקטע, ולכן שינוי ' +
          'בהרגלי ההליכה מזיז אותה. ' +
          (drift === null ? ''
            : Math.abs(drift) < 500
              ? 'ההליכה שלך יציבה לאורך התקופה.'
              : drift > 0
                ? 'ההליכה עלתה ב-' + Fmt.n(drift, 0) + ' צעדים מתחילת המעקב.'
                : 'ההליכה ירדה ב-' + Fmt.n(-drift, 0) + ' צעדים מתחילת המעקב.') }));
  }

  /**
   * איפה אני עומד מול התקציב.
   *
   * הצפי מפוצל לשני מקורות, כי הם שני דברים שונים שאפשר לשנות
   * בנפרד: מה שאכלת מול התקציב, ומה שהלכת מעבר למה שכבר בתוכו.
   *
   * במצב "עם צעדים" התקציב כבר מכיל את ההליכה הממוצעת של המקטע
   * הנבחר, ולכן עמודת הצעדים מודדת רק את ההפרש ממנה — הלכת יותר
   * מהרגיל או פחות. במצב "בלי צעדים" הבסיס הוא אפס, וכל ההליכה
   * נספרת שם.
   */
  function standingCard(entries, budget, macros, state, baseSteps, perStep) {
    var byDate = {};
    entries.forEach(function (e) { byDate[e.date] = e; });

    var mean = function (from, to, field) {
      var values = [];
      for (var d = from; d <= to; d = Dates.addDays(d, 1)) {
        var day = byDate[d];
        if (day && Fmt.isNum(day[field])) values.push(day[field]);
      }
      return values.length ? values.reduce(function (a, b) { return a + b; }, 0) /
        values.length : null;
    };

    var rows = lengthsOf(state).map(function (days) {
      var to = state.date;
      var from = Dates.addDays(to, -(days - 1));
      var kcal = mean(from, to, 'kcal');
      if (kcal === null) {
        return '<tr><td class="n">' + days + '</td>' +
          '<td colspan="10" class="flat">אין רישום</td></tr>';
      }

      var gap = kcal - budget;
      var fromFood = (gap * days) / 7700;

      // ההליכה מעבר למה שכבר מגולם בתקציב
      var steps = mean(from, to, 'steps');
      var extraSteps = steps === null ? 0 : (steps - baseSteps) * perStep;
      var fromWalk = (-extraSteps * days) / 7700;

      var predicted = fromFood + fromWalk;

      // בפועל: ממוצע החלון מול ממוצע החלון שלפניו
      var prevTo = Dates.addDays(from, -1);
      var prevFrom = Dates.addDays(prevTo, -(days - 1));
      var now = mean(from, to, 'weightKg');
      var before = mean(prevFrom, prevTo, 'weightKg');
      var actual = (now === null || before === null) ? null : now - before;

      var macro = function (field, target) {
        var value = mean(from, to, field);
        if (value === null) return '<td class="n flat">—</td>';
        var over = value - target;
        return '<td class="n">' + Fmt.n(value, 0) +
          '<span class="sub' + (Math.abs(over) > target * 0.15 ? ' warn' : '') + '">' +
          Fmt.signed(over, 0) + '</span></td>';
      };

      return '<tr><td class="n">' + days + '</td>' +
        '<td class="n">' + Fmt.n(kcal, 0) + '</td>' +
        '<td class="n">' + P.delta(gap, 0, 'down') + '</td>' +
        macro('proteinG', macros.protein) +
        macro('fatG', macros.fat) +
        macro('carbG', macros.carbs) +
        '<td class="n">' + (steps === null ? '—' : Fmt.n(steps, 0)) +
          (steps === null ? '' : '<span class="sub">' +
            Fmt.signed(steps - baseSteps, 0) + '</span>') + '</td>' +
        '<td class="n">' + Fmt.signed(fromFood, 2) + '</td>' +
        '<td class="n">' + Fmt.signed(fromWalk, 2) + '</td>' +
        '<td class="n"><strong>' + Fmt.signed(predicted, 2) + '</strong></td>' +
        '<td class="n">' + (actual === null ? '—' : P.delta(actual, 2, 'down')) +
        '</td></tr>';
    }).join('');

    return P.card('איפה אני עומד', 'כל אורך חלון מול אותו תקציב',
      '<label class="pick-label">אילו חלונות להציג</label>' +
      P.chips(WINDOW_SETS, state.budgetWindows || 'few', 'data-windows') +
      P.table(
        [{ label: 'ימים', n: true }, 'אכלת', 'פער', 'חלבון', 'שומן', 'פחמ׳',
          'צעדים', 'מתזונה', 'מצעדים', 'צפוי', 'בפועל'],
        [rows],
        { hint: (baseSteps
            ? '"מצעדים" מודד את ההפרש מההליכה הרגילה, ' +
              Fmt.n(baseSteps, 0) + ' צעדים — הלכת יותר מזה והוא מוריד, ' +
              'פחות מזה והוא מוסיף. '
            : '"מצעדים" הוא מלוא תרומת ההליכה, ולכן תמיד מוריד. ') +
          '"מתזונה" הוא מה שהפער באוכל אמור לעשות למשקל. שניהם יחד הם ' +
          '"צפוי", ו"בפועל" הוא מה שקרה — ממוצע החלון מול ממוצע החלון ' +
          'שלפניו. כשהצפוי והבפועל רחוקים לאורך כל השורות, התקציב עצמו ' +
          'צריך בדיקה.' }));
  }

  function render(state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    var manual = isManual(state) ? manualValues(settings, state) : null;

    var formula = isFormula(state)
      ? Metrics.formulaMaintenance(entries, settings, {
          endDate: state.date, activity: state.activityLevel
        })
      : null;

    if (formula && !formula.ok) {
      return P.section('תקציב',
        '<div class="sticky-pick">' +
          P.chips(SPLITS, 'formula', 'data-split') + '</div>' +
        P.card(null, null,
          P.empty(formula.reason === 'no-weight'
            ? 'צריך לפחות שקילה אחת.'
            : 'חסרים פרטים בהגדרות: ' +
              [formula.needAge ? 'תאריך לידה' : null,
                formula.needHeight ? 'גובה' : null]
                .filter(Boolean).join(' ו') + '.')));
    }

    var fitted = isFit(state)
      ? Metrics.fitMaintenance(entries, {
          endDate: state.date,
          kcalPerKg: settings.kcalPerKg, kcalPerStep: settings.kcalPerStep
        })
      : null;

    if (fitted && !fitted.ok) {
      return P.section('תקציב',
        P.card(null, null,
          P.empty('צריך לפחות ' + fitted.need + ' ימים להתאמה, יש ' +
            fitted.have + '.')));
    }

    var options = splitOptions(state);
    options.endDate = state.date;
    options.anchor = anchorOf(state);
    options.kcalPerKg = settings.kcalPerKg;
    options.kcalPerStep = settings.kcalPerStep;

    // גם במצבים שאינם חלוקה דרושים המקטעים, לצורך ההליכה הרגילה
    var split = Metrics.periodSplit(entries,
      (fitted || manual || formula) ? { parts: 2, endDate: state.date,
        kcalPerKg: settings.kcalPerKg, kcalPerStep: settings.kcalPerStep }
      : options);

    if (!split.ok) {
      return P.section('תקציב',
        P.card(null, null,
          P.empty(split.reason === 'too-short'
            ? 'צריך לפחות ' + split.need + ' ימים לחלוקה הזו, יש ' + split.have + '. ' +
              'מקטעים באורך קבוע דורשים שניים שלמים לפחות.'
            : 'אין מספיק נתונים להשוואה בין המקטעים.')));
    }

    var chosen = chosenRow(split, state);

    /**
     * במצב המותאם התחזוקה מגיעה מההתאמה, וההליכה הרגילה עדיין
     * מהמקטע האחרון — היא מתארת הרגלים, לא חישוב.
     */
    if (fitted) {
      chosen = Object.assign({}, chosen, { maintenance: fitted.maintenance });
    }

    if (formula) {
      // המקדם כולל את ההליכה, ולכן היא מאופסת כאן
      chosen = Object.assign({}, chosen, {
        maintenance: formula.maintenance, steps: 0, stepKcal: 0
      });
    }

    if (manual) {
      var perStepManual = Fmt.isNum(settings.kcalPerStep)
        ? settings.kcalPerStep : 0.045;
      chosen = Object.assign({}, chosen, {
        maintenance: manual.maintenance,
        steps: manual.steps,
        stepKcal: manual.steps * perStepManual
      });
    }

    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var deficit = (rate * (settings.kcalPerKg || 7700)) / 7;
    var budget = chosen.maintenance - deficit +
      (withWalk(state) ? (chosen.stepKcal || 0) : 0);

    var targets = settings.targets || {};
    var protein = Fmt.isNum(targets.proteinG) ? targets.proteinG : 170;
    var fatShare = Fmt.isNum(targets.fatShare) ? targets.fatShare : 0.30;
    var fat = (budget * fatShare) / 9;
    var macros = {
      protein: protein,
      fat: fat,
      carbs: Math.max((budget - protein * 4 - fat * 9) / 4, 0)
    };

    // הבסיס שהתקציב כבר מגלם: במצב "בלי צעדים" אין כזה
    var perStep = Fmt.isNum(settings.kcalPerStep) ? settings.kcalPerStep : 0.045;
    var baseSteps = withWalk(state) ? (chosen.steps || 0) : 0;

    /**
     * פס הבחירה יושב מחוץ לכרטיסים.
     *
     * בתוך כרטיס, sticky מחזיק רק כל עוד הכרטיס על המסך — וברגע
     * שגוללים אל הטבלה הארוכה הוא נעלם, בדיוק כשהוא נחוץ. כפס
     * עליון של המקטע כולו הוא נשאר לאורך כל הגלילה.
     */
    var bar = '<div class="sticky-pick">' +
      P.chips(SPLITS,
        isManual(state) ? 'manual'
          : isFormula(state) ? 'formula'
          : isFit(state) ? 'fit'
          : sizeOf(state) ? 'd' + sizeOf(state) : partsOf(state),
        'data-split') +
      '</div>';

    return P.section('תקציב',
      bar +
      trackCard(entries, state) +
      (formula
        ? formulaCard(formula, state)
        : manual
        ? manualCard(manual, settings)
        : fitted
          ? fitCard(fitted, state)
          : splitCard(split, chosen, state)) +
      budgetCard(chosen, settings, state) +
      ((manual || formula) ? '' : walkCard(split, chosen, settings)) +
      standingCard(entries, budget, macros, state, baseSteps, perStep));
  }

  root.BudgetTab = {
    render: render, SPLITS: SPLITS, ANCHORS: ANCHORS, LENGTHS: LENGTHS,
    WINDOW_SETS: WINDOW_SETS, lengthsOf: lengthsOf,
    partsOf: partsOf, sizeOf: sizeOf, splitOptions: splitOptions,
    anchorOf: anchorOf, withWalk: withWalk,
    isManual: isManual, manualValues: manualValues, isFormula: isFormula
  };
})(typeof window !== 'undefined' ? window : globalThis);
