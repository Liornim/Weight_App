/**
 * Dash — הלוח, בשפה פשוטה.
 *
 * כללי הכתיבה כאן, והם מחייבים:
 * אין מונחים סטטיסטיים, אין "חלון" ואין "תרחיש", אין ±.
 * כל כרטיס נפתח במשפט שאומר מה קרה, ורק אחריו מגיעים מספרים.
 * מי שרוצה את הפירוט המלא נמצא באפליקציה הקודמת.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics,
      Store = root.Store, P = root.Parts, Chart = root.Chart;

  var COLORS = {
    brand: '#12857C',
    brandLite: '#1DB5A6',
    good: '#2E9E6B',
    warn: '#E07A34',
    bad: '#C8385A',
    violet: '#6B4FE0',
    faint: 'rgba(18,133,124,0.28)'
  };

  var BASIS = [{ value: 'adaptive', days: null, label: 'הכל' }].concat(
    P.WINDOWS.map(function (days) {
      return { value: days, days: days, label: P.windowLabel(days) };
    }));

  var CAUTION = [
    { value: 'low', label: 'זהיר' },
    { value: 'mid', label: 'אמצע' },
    { value: 'high', label: 'נדיב' }
  ];

  /**
   * ההערכה שמאחורי היעד.
   *
   * לחלון מספרי משתמשים באותו מודל שהטבלאות מציגות — מאזן מיושר
   * ליום עם רגרסיה על השקילות שבטווח. קודם היה כאן מנוע אחר,
   * ולכן הפס אמר 3,462 בעוד הטבלה אמרה 2,357 על אותו חלון בדיוק.
   *
   * במצב "הכל" אין חלון מוגדר, ושם נשאר החישוב המסתגל.
   */
  function report(entries, settings, date, state) {
    var basis = (state && state.basis) || 'adaptive';

    if (basis === 'adaptive') {
      return Metrics.windowReport(entries, settings, {
        windowDays: 'adaptive', endDate: date
      });
    }

    var days = Number(basis);
    var r = Metrics.dayAligned(entries, settings, { days: days, endDate: date });

    /**
     * כשאין מספיק שקילות למאזן מיושר — למשל כשחסרה שקילה שסוגרת —
     * עדיף להציג את ההערכה הישנה מאשר מסך ריק. זה נאמר בשדה method.
     */
    if (!r.ok) {
      var fallback = Metrics.windowReport(entries, settings, {
        windowDays: days, endDate: date
      });
      if (fallback.ok) fallback.method = 'windowReport';
      return fallback;
    }

    var kcalPerKg = r.kcalPerKg;
    var rate = Math.abs((settings.goal || {}).ratePerWeekKg || 0);
    var deficitPerDay = (rate * kcalPerKg) / 7;

    // ההוצאה שהיעד נגזר ממנה: עם או בלי הליכה, לפי הבחירה
    var withSteps = state && state.stepsMode === 'on';
    var spend = withSteps ? r.tdee : r.base;

    return {
      ok: true,
      tdee: r.tdee,
      base: r.base,
      ci95: r.ci95,
      target: spend - deficitPerDay,
      deficitPerDay: deficitPerDay,
      ratePerWeekKg: (settings.goal || {}).ratePerWeekKg || 0,
      statsDays: days,
      meanSteps: r.meanSteps,
      stepKcal: r.stepKcal,
      method: r.method,
      weighIns: r.weighIns,
      from: r.foodFrom,
      to: r.foodTo
    };
  }

  /**
   * ההערכה כמה הגוף שורף היא טווח ולא מספר יחיד.
   * "זהיר" מניח את הקצה הנמוך שלו, "נדיב" את הגבוה. ההפרש בין
   * השניים הוא בדיוק אי־הוודאות שבמדידה, רק בלי לקרוא לה בשם.
   */
  function adjust(r, caution) {
    if (!r.ok) return r;
    var shift = caution === 'low' ? -r.ci95 : caution === 'high' ? r.ci95 : 0;

    // בנייה מחדש של האובייקט השמיטה שדות שנוספו מאוחר יותר —
    // התקופה, השיטה ומספר השקילות — ולכן העתקה ואז דריסה
    var out = {};
    Object.keys(r).forEach(function (key) { out[key] = r[key]; });

    out.base = r.base + shift;
    out.tdee = r.tdee + shift;
    out.target = r.target + shift;
    return out;
  }

  /**
   * שורות הבחירה שבראש המסך.
   * options.extra מאפשר למסך להוסיף בורר משלו אל תוך הפס הדביק,
   * כדי שגם הוא יישאר גלוי בזמן גלילה.
   */
  function controls(state, entries, date, options) {
    var extras = options || {};
    var available = Metrics.availableWindows(entries, {
      endDate: date, candidates: P.WINDOWS
    });
    var byDays = {};
    available.forEach(function (w) { byDays[w.days] = w; });

    var options = BASIS.map(function (option) {
      if (option.days === null) return { value: option.value, label: option.label };
      var info = byDays[option.days];
      return {
        value: option.value,
        label: option.label,
        disabled: !info || !info.available,
        title: info && info.available ? '' : 'צריך יותר ימים של מעקב'
      };
    });

    // היעד שנוצר מהבחירות מוצג כאן עצמו, כדי שהשינוי יהיה מיידי
    // ולא ידרוש גלילה למקום אחר
    var picked = adjust(report(entries, Store.getSettings(), date, state), state.caution);

    // "שורף" מוצג לפי אותה בחירה שמייצרת את היעד, אחרת שני
    // המספרים בשורה אחת מתארים דברים שונים
    var spend = state.stepsMode === 'on' ? picked.tdee : picked.base;

    var live = picked.ok
      ? '<div class="pick-live">' +
          '<span class="k">היעד לפי הבחירה</span>' +
          '<span class="v num">' + Fmt.n(picked.target, 0) + '</span>' +
          '<span class="s">קלוריות ליום · שורף ' + Fmt.n(spend, 0) +
            (picked.from ? ' · ' + Dates.short(picked.from) + '–' +
              Dates.short(picked.to) : '') + '</span>' +
        '</div>'
      : '<div class="pick-live"><span class="k">אין מספיק נתונים לחלון הזה</span></div>';

    return '<div class="sticky-bar">' + P.card(null, null,
      '<label class="pick-label">על סמך כמה זמן לחשב</label>' +
      P.chips(options, state.basis, 'data-basis') +
      '<label class="pick-label">כמה להיזהר בהערכה</label>' +
      P.chips(CAUTION, state.caution, 'data-caution') +
      (extras.extra || '') +
      live +
      (extras.note ? '<p class="pick-note">' + P.esc(extras.note) + '</p>' : '') +
      P.hint('אי אפשר לדעת במדויק כמה הגוף שורף, אז יש טווח. ' +
        '"זהיר" מניח שאתה שורף פחות ממה שנראה, ולכן הוא נותן יעד נמוך יותר ' +
        'ומבטיח שתרד גם אם ההערכה אופטימית. "נדיב" מניח את ההפך.')) + '</div>';
  }

  // ---------------------------------------------------------- כותרת

  /**
   * ההסבר מאיפה הגיע המספר. כל התקופה מחולקת לשניים, וכל חצי
   * מסוכם בממוצע — כך כל שקילה נספרת פעם אחת ושני הצדדים סובלים
   * מאותו רעש.
   */
  function lossExplanation(d) {
    if (!d.halves || d.halves.loss === null) {
      return 'קילו · מאז ' + Dates.short(d.firstDate);
    }
    return 'קילו · ' + d.halves.days + ' הימים הראשונים (' +
      Fmt.n(d.halves.first.mean, 1) + ') מול ' + d.halves.days + ' האחרונים (' +
      Fmt.n(d.halves.second.mean, 1) + ')';
  }

  var AS_OF = [
    { value: 0, label: 'עד היום' },
    { value: 7, label: 'עד שבוע שעבר' },
    { value: 14, label: 'עד לפני שבועיים' }
  ];

  function top(state, entries, settings) {
    // המדידה יכולה לעצור מוקדם יותר, כדי לראות מה היא אמרה אז.
    // שבוע חריג בסוף משנה את התמונה, ועדיף להראות את זה מאשר לטעון
    // שהמספר האחד נכון.
    var asOf = state.asOf || 0;
    var measureDate = asOf ? Dates.addDays(state.date, -asOf) : state.date;
    var d = Metrics.dashboard(entries, settings, { endDate: measureDate });
    // הגרסה מוצגת כדי שיהיה אפשר לדעת במבט אם הדפדפן מגיש
    // קבצים ישנים מהמטמון
    var stamp = Dates.long(state.date) + '  ·  ' + root.App.BUILD;

    if (!d.ok) {
      return '<header class="top"><div class="top-row"><h1>המשקל שלי</h1>' +
        '<span class="stamp">' + P.esc(stamp) + '</span></div>' +
        '<div class="headline"><span class="k">עוד אין נתונים</span></div></header>';
    }

    var goal = settings.goal.targetWeightKg;
    var progress = '';

    var openingWeight = d.halves && Fmt.isNum(d.halves.first.mean)
      ? d.halves.first.mean : d.startMean;

    if (Fmt.isNum(goal) && Fmt.isNum(openingWeight) && Fmt.isNum(d.currentWeight)) {
      var total = openingWeight - goal;
      var done = openingWeight - d.currentWeight;
      var pct = total > 0 ? Math.max(Math.min(done / total, 1), 0) : 0;
      var left = Math.max(d.currentWeight - goal, 0);

      progress =
        '<div class="progress">' +
          '<div class="progress-head"><span>עשית ' + Fmt.n(pct * 100, 0) + '% מהדרך</span>' +
            '<span>נשארו ' + Fmt.n(left, 1) + ' ק״ג</span></div>' +
          '<div class="progress-track"><div class="progress-fill" style="width:' +
            (pct * 100).toFixed(1) + '%"></div></div>' +
          '<div class="progress-foot"><span>היעד ' + Fmt.n(goal, 1) + '</span>' +
            '<span>עכשיו ' + Fmt.n(d.currentWeight, 1) + '</span>' +
            '<span>התחלה ' + Fmt.n(openingWeight, 1) + '</span></div>' +
        '</div>';
    }

    var lastWeekNote = '';
    if (!asOf && Fmt.isNum(d.lastWeekEffect) && d.halvesBeforeLastWeek &&
        Math.abs(d.lastWeekEffect) >= 0.15) {
      lastWeekNote = '<div class="flag">' +
        (d.lastWeekEffect < 0
          ? 'השבוע האחרון מושך את המספר למטה. עד סוף השבוע שעבר הירידה עמדה על '
          : 'השבוע האחרון היה טוב במיוחד. עד סוף השבוע שעבר הירידה עמדה על ') +
        '<b class="num">' + Fmt.n(d.halvesBeforeLastWeek.loss, 1) + '</b> קילו.</div>';
    }

    var asOfNote = asOf
      ? '<div class="flag">המספר נכון ל' + Dates.short(measureDate) +
        ', כאילו עצרנו את המדידה שם.</div>'
      : '';

    return '<header class="top">' +
      '<div class="top-row"><h1>המשקל שלי</h1><span class="stamp">' + P.esc(stamp) + '</span></div>' +
      '<div class="headline">' +
        '<span class="k">ירדת עד עכשיו</span>' +
        '<span class="v">' + Fmt.n(d.totalLoss, 1) + '</span>' +
        '<span class="u">' + P.esc(lossExplanation(d)) + '</span>' +
      '</div>' + lastWeekNote + asOfNote +
      '<div class="as-of">' + P.chips(AS_OF, asOf, 'data-asof') + '</div>' +
      '<div class="peaks">' +
        '<span>הכי גבוה <b class="num">' + Fmt.n(d.maxWeight, 1) + '</b></span>' +
        '<span>הכי נמוך <b class="num">' + Fmt.n(d.minWeight, 1) + '</b></span>' +
        '<span>שקילה אחרונה <b class="num">' + Fmt.n(d.latestWeight, 1) + '</b></span>' +
      '</div>' + progress +
    '</header>';
  }

  // ------------------------------------------------------- כמה לאכול


  // --------------------------------------------------- מה קרה למשקל

  var PERIOD_NAMES = ['השבוע', 'שבוע שעבר', 'לפני שבועיים', 'לפני שלושה שבועות'];


  // ------------------------------------------------ שומן ושריר


  // ------------------------------------------------------ מה אכלתי


  // ------------------------------------------------- צילום

  function photoCard(state) {
    var key = Store.getSettings().aiKey;

    // הדבקה: הניתוח נעשה בשיחה, וחוזרת שורה אחת שממלאת את הטופס.
    // זו הדרך שלא עולה כלום, ולכן היא הראשונה במסך.
    var paste =
      '<textarea id="paste-line" rows="2" placeholder="1671 118 126 24 12"></textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<button type="button" class="btn btn--primary" id="paste-apply">מילוי הטופס</button>' +
        '<button type="button" class="btn" id="copy-prompt">העתקת ההוראה</button>' +
      '</div>' +
      '<div id="paste-result"></div>';

    var settings = Store.getSettings();
    var accounts = [
      { key: settings.aiKeyA, provider: settings.aiProviderA, model: settings.aiModelA },
      { key: settings.aiKeyB, provider: settings.aiProviderB, model: settings.aiModelB }
    ].filter(function (a) {
      return a.key && root.Providers.detect(a.key, a.provider);
    });

    var auto = '';
    if (accounts.length) {
      var who = accounts.map(function (a) {
        return root.Providers.label(a.key, a.provider);
      });
      var note = accounts.length > 1
        ? 'ויכוח בין ' + who[0] + ' ל' + who[1]
        : who[0] + ' מעריך פעמיים, פעם בזהירות ופעם בהחמרה';

      auto = P.card('העלאת תמונה', note,
        '<div class="pick-row">' +
          '<label class="pick-btn" for="photo-camera">צילום עכשיו' +
            '<input type="file" id="photo-camera" class="photo-input" ' +
            'accept="image/*" capture="environment"></label>' +
          '<label class="pick-btn" for="photo">בחירה מהגלריה' +
            '<input type="file" id="photo" class="photo-input" accept="image/*"></label>' +
        '</div>' +
        '<div id="preview"></div>' +
        '<div id="debate"></div>' +
        P.hint('הערכת כמות מתמונה שוגה בדרך כלל ב-20 עד 30 אחוז, כי אי אפשר לראות ' +
          'כמה שמן היה במחבת ומה מתחת לפני השטח. ' +
          (accounts.length > 1
            ? 'שני מודלים ממשפחות שונות חושפים יותר מאשר אחד.'
            : 'מפתח שני, ממשפחה אחרת, ישפר את ההערכה.')));
    }

    return auto + P.card('או בהדבקה', 'ניתוח בשיחה, ושורה אחת שממלאת את הטופס',
      paste +
      P.hint('הסדר: "העתקת ההוראה" ← מדביקים בשיחה יחד עם התמונה ← ' +
        'מקבלים שורה של חמישה מספרים ← מדביקים כאן. ' +
        'הפורמט: קלוריות, חלבון, פחמימות, שומן, סיבים. ' +
        'אפשר גם במילים: "קלוריות 1671, חלבון 118".'));
  }

  // ------------------------------------------------------ הגדרות

  function providerLabel(key, override) {
    if (!key) return 'ריק';
    var name = root.Providers.detect(key, override);
    return name ? root.Providers.PROVIDERS[name].label : 'לא מזוהה — בחר ידנית';
  }

  /**
   * בורר ספק, מוצג רק כשהזיהוי האוטומטי נכשל.
   * צורות המפתחות משתנות מדי פעם, ומפתח תקין לגמרי עלול לא להתאים
   * לתבנית. עדיף לתת דרך להמשיך מאשר לחסום.
   */
  function providerPicker(slot, key, override) {
    if (!key || root.Providers.detect(key)) return '';

    var options = root.Providers.options().map(function (option) {
      return '<option value="' + option.value + '"' +
        (option.value === override ? ' selected' : '') + '>' +
        P.esc(option.label) + (option.free ? ' (חינם)' : '') + '</option>';
    }).join('');

    return '<div class="field"><label for="prov-' + slot + '">מי הספק של המפתח הזה</label>' +
      '<select id="prov-' + slot + '" data-provider="aiProvider' + slot + '">' +
      '<option value="">בחר</option>' + options + '</select></div>';
  }

  /** שדה מודל לכל מפתח, כדי שאפשר יהיה להריץ שני מודלים שונים */
  function modelField(slot, key, override, value) {
    var name = root.Providers.detect(key, override);
    if (!name) return '';
    var provider = root.Providers.PROVIDERS[name];

    return '<div class="field"><label for="model-' + slot + '">מודל למפתח ' +
      (slot === 'A' ? 'הראשון' : 'השני') +
      ' <span class="unit">' + P.esc(provider.label) + '</span></label>' +
      '<input id="model-' + slot + '" data-model="aiModel' + slot + '" type="text" ' +
      'placeholder="' + P.esc(provider.defaultModel) + '" value="' +
      P.esc(value || '') + '"></div>';
  }

  function settingsSection(state, entries, settings) {
    var Providers = root.Providers;
    var rate = Fmt.isNum(settings.goal.ratePerWeekKg) ? Math.abs(settings.goal.ratePerWeekKg) : 0;

    var profile = settings.profile || {};

    /**
     * פרטי הפרופיל.
     *
     * עד עכשיו הם היו קיימים במבנה הנתונים אך לא בטופס, ולכן חישוב
     * שדורש אותם — כמו נוסחת התחזוקה — נכשל בלי שתהיה דרך לתקן.
     */
    var body =
      '<div class="section-label">עליי</div>' +

      '<div class="field"><label for="profile-height">גובה בסנטימטרים</label>' +
        '<input id="profile-height" data-profile="heightCm" type="number" ' +
        'inputmode="numeric" min="120" max="230" step="1" value="' +
        P.esc(Fmt.isNum(profile.heightCm) ? String(profile.heightCm) : '') + '"></div>' +

      '<div class="field"><label for="profile-birth">תאריך לידה</label>' +
        '<input id="profile-birth" data-profile="birthDate" type="date" value="' +
        P.esc(profile.birthDate || '') + '"></div>' +

      '<label class="pick-label">מין</label>' +
      P.chips([
        { value: 'male', label: 'זכר' },
        { value: 'female', label: 'נקבה' }
      ], profile.sex === 'female' ? 'female' : 'male', 'data-sex') +

      P.hint('משמשים לחישוב התחזוקה לפי נוסחה, ולהערכת הרכב הגוף. ' +
        'הם נשמרים במכשיר בלבד.') +

      '<div class="section-label">היעד</div>' +

      '<div class="field"><label for="goal-weight">לאיזה משקל אתה מכוון</label>' +
        '<input id="goal-weight" type="number" step="0.1" value="' +
        (Fmt.isNum(settings.goal.targetWeightKg) ? settings.goal.targetWeightKg : '') + '"></div>' +

      '<div class="field"><label for="rate">כמה לרדת בשבוע — ' +
        '<span class="num" id="rate-label">' + Fmt.n(rate, 2) + '</span> קילו</label>' +
        '<input id="rate" type="range" min="0" max="1.5" step="0.05" value="' + rate + '"></div>' +

      '<div class="field"><label for="protein-target">יעד חלבון ליום (גרם)</label>' +
        '<input id="protein-target" type="number" step="5" value="' +
        (Fmt.isNum(settings.targets.proteinG) ? settings.targets.proteinG : '') + '"></div>' +

      '<div class="field"><label for="ai-key-a">מפתח ראשון ' +
        '<span class="unit">' + P.esc(providerLabel(settings.aiKeyA, settings.aiProviderA)) +
        '</span></label>' +
        '<input id="ai-key-a" data-key="aiKeyA" type="password" autocomplete="off" ' +
        'placeholder="AIza..." value="' + P.esc(settings.aiKeyA || '') + '"></div>' +
      providerPicker('A', settings.aiKeyA, settings.aiProviderA) +
      ((Providers.detect(settings.aiKeyA, settings.aiProviderA) === 'gemini' ||
        Providers.detect(settings.aiKeyB, settings.aiProviderB) === 'gemini')
        ? '<div class="field"><label for="ai-project">מספר פרויקט ' +
          '<span class="unit">לא חובה</span></label>' +
          '<input id="ai-project" data-project="aiProjectA" type="text" ' +
          'inputmode="numeric" placeholder="155074336268" value="' +
          P.esc(settings.aiProjectA || '') + '"></div>' +
          P.hint('מפתחות Gemini מהסוג החדש (AQ.) קשורים לפרויקט, ולפעמים ' +
            'השרת דורש לציין אותו. המספר מופיע באותו מסך שבו יצרת את המפתח, ' +
            'תחת Project number. אם המפתח עובד בלעדיו — אין צורך.')
        : '') +

      '<div class="field"><label for="ai-key-b">מפתח שני ' +
        '<span class="unit">' + P.esc(providerLabel(settings.aiKeyB, settings.aiProviderB)) +
        '</span></label>' +
        '<input id="ai-key-b" data-key="aiKeyB" type="password" autocomplete="off" ' +
        'placeholder="sk-or-..." value="' + P.esc(settings.aiKeyB || '') + '"></div>' +
      providerPicker('B', settings.aiKeyB, settings.aiProviderB) +

      modelField('A', settings.aiKeyA, settings.aiProviderA, settings.aiModelA) +
      modelField('B', settings.aiKeyB, settings.aiProviderB, settings.aiModelB) +
      (Providers.detect(settings.aiKeyB, settings.aiProviderB) === 'openrouter'
        ? '<button type="button" class="btn" id="load-models">' +
            'טעינת המודלים החינמיים שקוראים תמונות</button>' +
          '<div id="model-list"></div>'
        : '') +

      P.hint('שני מפתחות חינמיים: Gemini ב-aistudio.google.com/apikey, ' +
        'ו-OpenRouter ב-openrouter.ai/keys — שם בוחרים מודל שהשם שלו מסתיים ב-free. ' +
        'עם שניהם הוויכוח הוא בין מודלים ממשפחות שונות; עם אחד בלבד הוא ' +
        'בין שתי עמדות של אותו מודל. המפתחות נשמרים במכשיר הזה בלבד.') +

      '<div class="section-label">גיליון</div>' +
      '<div class="field"><label for="sync-url">כתובת הגיליון</label>' +
        '<input id="sync-url" data-sync="url" type="url" inputmode="url" ' +
        'placeholder="https://script.google.com/macros/s/.../exec" value="' +
        P.esc((settings.sync || {}).url || '') + '"></div>' +

      '<label class="switch"><input type="checkbox" id="sync-write"' +
        ((settings.sync || {}).write ? ' checked' : '') + '>' +
        '<span>לשמור גם לגיליון, לא רק במכשיר</span></label>' +
      P.hint('השמירה משתמשת באותן פעולות שהדפים הקיימים משתמשים בהן, ' +
        'ולכן אין צורך לשנות דבר בסקריפט של הגיליון.') +

      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
        '<button type="button" class="btn btn--primary" id="pull">עדכון נתונים מהגיליון</button>' +
        '<button type="button" class="btn" id="test-sync">בדיקת שמירה לגיליון</button>' +
        '<button type="button" class="btn" id="open-old">התצוגה המפורטת</button>' +
      '</div>';

    return P.section('הגדרות', P.fold('היעד שלי', body, state.settingsOpen));
  }

  // ------------------------------------------------------- גרפים

  function drawCharts(state, entries, settings) {
    var host = function (id) { return document.getElementById(id); };
    var setKeys = function (id, html) {
      var box = host(id + '-keys');
      if (box) box.innerHTML = html;
    };
    var toPoints = function (list) {
      return list.map(function (p) { return { x: Dates.dayIndex(p.date), y: p.y }; });
    };

    var raw = Metrics.series(entries, 'weightKg');
    var ma = Metrics.movingAverage(entries, 'weightKg', { windowDays: 7, minPoints: 3 })
      .filter(function (d) { return d.y !== null; });

    if (raw.length >= 2 && host('chart-weight')) {
      var series = [
        { type: 'dots', color: COLORS.faint, points: toPoints(raw), radius: 2.5 },
        { type: 'line', color: COLORS.brand, width: 3, points: toPoints(ma) }
      ];

      var goal = settings.goal.targetWeightKg;
      if (Fmt.isNum(goal)) {
        var xs = toPoints(raw).map(function (p) { return p.x; });
        series.push({
          type: 'line', color: COLORS.warn, width: 1.6, dash: '6 4', ignoreExtent: true,
          points: [{ x: Math.min.apply(null, xs), y: goal },
                   { x: Math.max.apply(null, xs), y: goal }]
        });
      }

      var rawMap = {}, maMap = {};
      raw.forEach(function (p) { rawMap[Dates.dayIndex(p.date)] = p.y; });
      ma.forEach(function (p) { maMap[p.x] = p.y; });

      Chart.render(host('chart-weight'), {
        series: series,
        height: 200,
        formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
        formatTick: function (v) { return Fmt.n(v, 1); },
        captionEl: host('chart-weight-caption'),
        idleCaption: 'הקו הוא הממוצע. הנקודות הן השקילות עצמן.',
        onHover: function (x) {
          var parts = [Dates.long(Dates.fromDayIndex(x))];
          if (rawMap[x] !== undefined) parts.push('נשקלת ' + Fmt.n(rawMap[x], 1));
          if (maMap[x] !== undefined) parts.push('ממוצע ' + Fmt.n(maMap[x], 1));
          return parts.join('  ·  ');
        }
      });

      setKeys('chart-weight', P.keys([
        { color: COLORS.faint, label: 'שקילות', shape: 'dot' },
        { color: COLORS.brand, label: 'הממוצע' }
      ].concat(Fmt.isNum(goal) ? [{ color: COLORS.warn, label: 'היעד', shape: 'dash' }] : [])));
    }

    var kcal = Metrics.series(entries, 'kcal');
    if (kcal.length >= 2 && host('chart-kcal')) {
      var r = adjust(report(entries, settings, state.date, state), state.caution);
      var target = r.ok ? r.target : null;

      var bars = toPoints(kcal).map(function (p) {
        return {
          x: p.x, y: p.y,
          color: Fmt.isNum(target) && p.y > target ? COLORS.bad : COLORS.brandLite
        };
      });

      var kcalSeries = [{ type: 'bars', color: COLORS.brandLite, points: bars }];
      if (Fmt.isNum(target)) {
        var kx = bars.map(function (p) { return p.x; });
        kcalSeries.push({
          type: 'line', color: COLORS.warn, width: 1.8, dash: '6 4', ignoreExtent: true,
          points: [{ x: Math.min.apply(null, kx), y: target },
                   { x: Math.max.apply(null, kx), y: target }]
        });
      }

      var kcalMap = {};
      kcal.forEach(function (p) { kcalMap[Dates.dayIndex(p.date)] = p.y; });

      Chart.render(host('chart-kcal'), {
        series: kcalSeries,
        height: 170,
        formatX: function (x) { return Dates.short(Dates.fromDayIndex(x)); },
        formatTick: function (v) { return Fmt.n(v, 0); },
        captionEl: host('chart-kcal-caption'),
        idleCaption: Fmt.isNum(target)
          ? 'עמודה אדומה = יום שאכלת בו יותר מהיעד'
          : 'כמה אכלת בכל יום',
        onHover: function (x) {
          var parts = [Dates.long(Dates.fromDayIndex(x))];
          if (kcalMap[x] !== undefined) parts.push('אכלת ' + Fmt.n(kcalMap[x], 0));
          return parts.join('  ·  ');
        }
      });

      setKeys('chart-kcal', P.keys([
        { color: COLORS.brandLite, label: 'בתוך היעד', shape: 'dot' },
        { color: COLORS.bad, label: 'מעל היעד', shape: 'dot' }
      ].concat(Fmt.isNum(target) ? [{ color: COLORS.warn, label: 'היעד', shape: 'dash' }] : [])));
    }
  }

  /**
   * ארבעה טאבים.
   *
   * היו עשרה, וחציים ענו על אותה שאלה בדרכים שונות: התקציב, המצב,
   * היעדים והחישוב כולם הציגו "כמה לאכול ואיפה אני עומד". ריבוי
   * מסכים שמראים את אותו דבר אינו בחירה אלא בלבול — במיוחד כשהם
   * מחשבים אותו מעט אחרת.
   *
   * ההגדרות נשארות בתחתית כל מסך ולא בטאב משלהן.
   */
  var TABS = [
    { value: 'budget', label: 'תקציב' },
    { value: 'entry', label: 'הזנה' },
    { value: 'weight', label: 'משקל' },
    { value: 'data', label: 'נתונים' }
  ];

  function tabs(active) {
    return '<nav class="tabs">' + TABS.map(function (tab) {
      return '<button type="button" class="tab" data-tab="' + tab.value + '"' +
        ' aria-pressed="' + (tab.value === active) + '">' + P.esc(tab.label) + '</button>';
    }).join('') + '</nav>';
  }

  function render(container, state) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    if (!entries.length) {
      container.innerHTML = top(state, entries, settings) +
        P.section('התחלה', P.card(null, null,
          P.empty('עוד אין נתונים. אפשר להביא אותם מהגיליון בהגדרות למטה.'))) +
        settingsSection(state, entries, settings);
      return;
    }

    var panel = state.tab === 'weight' ? root.WeightTab.render(state)
      : state.tab === 'entry' ? root.EntryTab.render(state)
      : state.tab === 'data' ? root.DataTab.render(state)
      : root.BudgetTab.render(state);

    container.innerHTML =
      top(state, entries, settings) +
      tabs(state.tab) +
      panel +
      settingsSection(state, entries, settings);

    if (state.tab === 'weight') drawCharts(state, entries, settings);
  }

  root.Dash = {
    render: render,
    photoCard: photoCard,
    controls: controls,
    adjust: adjust,
    report: report,
    COLORS: COLORS
  };
})(typeof window !== 'undefined' ? window : globalThis);
