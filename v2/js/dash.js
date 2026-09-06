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

  var BASIS = [
    { value: 'adaptive', days: null, label: 'הכל' },
    { value: 3, days: 3, label: '3 ימים' },
    { value: 5, days: 5, label: '5 ימים' },
    { value: 7, days: 7, label: 'שבוע' },
    { value: 10, days: 10, label: '10 ימים' },
    { value: 14, days: 14, label: 'שבועיים' },
    { value: 21, days: 21, label: '3 שבועות' },
    { value: 28, days: 28, label: 'חודש' }
  ];

  var CAUTION = [
    { value: 'low', label: 'זהיר' },
    { value: 'mid', label: 'אמצע' },
    { value: 'high', label: 'נדיב' }
  ];

  function report(entries, settings, date, state) {
    return Metrics.windowReport(entries, settings, {
      windowDays: (state && state.basis) || 'adaptive', endDate: date
    });
  }

  /**
   * ההערכה כמה הגוף שורף היא טווח ולא מספר יחיד.
   * "זהיר" מניח את הקצה הנמוך שלו, "נדיב" את הגבוה. ההפרש בין
   * השניים הוא בדיוק אי־הוודאות שבמדידה, רק בלי לקרוא לה בשם.
   */
  function adjust(r, caution) {
    if (!r.ok) return r;
    var shift = caution === 'low' ? -r.ci95 : caution === 'high' ? r.ci95 : 0;
    return {
      ok: true,
      base: r.base + shift,
      tdee: r.tdee + shift,
      target: r.target + shift,
      ci95: r.ci95,
      deficitPerDay: r.deficitPerDay,
      ratePerWeekKg: r.ratePerWeekKg,
      statsDays: r.statsDays,
      windowDays: r.windowDays
    };
  }

  /** שורות הבחירה שבראש המסך */
  function controls(state, entries, date) {
    var available = Metrics.availableWindows(entries, {
      endDate: date, candidates: [3, 5, 7, 10, 14, 21, 28]
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

    return P.card(null, null,
      '<label class="pick-label">על סמך כמה זמן לחשב</label>' +
      P.chips(options, state.basis, 'data-basis') +
      '<label class="pick-label">כמה להיזהר בהערכה</label>' +
      P.chips(CAUTION, state.caution, 'data-caution') +
      P.hint('אי אפשר לדעת במדויק כמה הגוף שורף, אז יש טווח. ' +
        '"זהיר" מניח שאתה שורף פחות ממה שנראה, ולכן הוא נותן יעד נמוך יותר ' +
        'ומבטיח שתרד גם אם ההערכה אופטימית. "נדיב" מניח את ההפך.'));
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
    var stamp = Dates.long(state.date);

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

  function todaySection(state, entries, settings) {
    var raw = report(entries, settings, state.date, state);
    var r = adjust(raw, state.caution);

    if (!r.ok) {
      return P.section('כמה לאכול היום',
        controls(state, entries, state.date) +
        P.card(null, null, P.empty('צריך עוד כמה ימים של שקילה ורישום אוכל כדי לחשב.')));
    }

    var entry = Store.getEntry(state.date) || {};
    var eaten = Fmt.isNum(entry.kcal) ? entry.kcal : null;
    var target = r.target;
    var over = eaten !== null && eaten > target;
    var left = eaten === null ? target : target - eaten;

    var sentence = eaten === null
      ? 'עוד לא רשמת אוכל היום.'
      : over
        ? 'אכלת ' + Fmt.n(eaten, 0) + ', שזה ' + Fmt.n(eaten - target, 0) + ' יותר מהיעד.'
        : 'אכלת ' + Fmt.n(eaten, 0) + ' מתוך ' + Fmt.n(target, 0) + '.';

    var ratio = eaten === null ? 0 : Math.min(eaten / target, 1);
    var meter =
      '<div class="meter"><div class="meter-track">' +
        '<div class="meter-fill' + (over ? ' meter-fill--over' : '') + '" style="width:' +
          (over ? 100 : ratio * 100).toFixed(1) + '%"></div>' +
      '</div>' +
      '<div class="meter-legend"><span>' + P.esc(sentence) + '</span></div></div>';

    return P.section('כמה לאכול היום',
      controls(state, entries, state.date) +
      P.card(null, null,
        '<div class="big big--' + (over ? 'bad' : 'brand') + '">' +
          (over ? Fmt.n(eaten - target, 0) : Fmt.n(Math.max(left, 0), 0)) +
          ' <small>' + (over ? 'קלוריות מעל היעד' : 'קלוריות נשארו לך') + '</small></div>' +
        meter +
        P.hint('היעד היומי שלך הוא ' + Fmt.n(target, 0) + ' קלוריות: הגוף שלך שורף ' +
          Fmt.n(r.base, 0) + ' ביום, ואתה אוכל ' + Fmt.n(r.deficitPerDay, 0) +
          ' פחות כדי לרדת ' + Fmt.n(Math.abs(r.ratePerWeekKg), 2) +
          ' קילו בשבוע. הליכה לא נספרת ביעד — היא תוספת.')));
  }

  // --------------------------------------------------- מה קרה למשקל

  var PERIOD_NAMES = ['השבוע', 'שבוע שעבר', 'לפני שבועיים', 'לפני שלושה שבועות'];

  function weightSection(state, entries) {
    var r = Metrics.weightBlocks(entries, { days: 7, endDate: state.date });

    if (r.rows.length < 2) {
      return P.section('מה קרה למשקל',
        P.card(null, null, P.chart('chart-weight', 200)) +
        P.card(null, null, P.empty('צריך שבועיים של שקילות כדי להשוות.')));
    }

    var recent = r.rows.slice(-4).reverse();
    var latest = recent[0];

    var headline;
    if (!Fmt.isNum(latest.change)) {
      headline = 'זה השבוע הראשון, אז עוד אין מול מה להשוות.';
    } else if (latest.change < -0.1) {
      headline = 'השבוע ירדת ' + Fmt.numHtml(Math.abs(latest.change), 2) + ' קילו.';
    } else if (latest.change > 0.1) {
      headline = 'השבוע עלית ' + Fmt.numHtml(latest.change, 2) + ' קילו.';
    } else {
      headline = 'השבוע המשקל שלך כמעט לא זז.';
    }

    var rows = recent.map(function (row, i) {
      var name = PERIOD_NAMES[i] || 'לפני ' + i + ' שבועות';
      return '<tr' + (i === 0 ? ' class="now"' : '') + '>' +
        '<td>' + P.esc(name) +
          '<span class="sub">' + P.esc(Dates.short(row.from) + '–' + Dates.short(row.to)) +
          (row.partial ? ' · עוד לא נגמר' : '') + '</span></td>' +
        '<td class="n">' + Fmt.n(row.mean, 1) + '</td>' +
        '<td class="n">' + P.delta(row.change, 2, 'down') + '</td></tr>';
    }).join('');

    var spans = Metrics.rollingWindows(entries, {
      endDate: state.date, lengths: [5, 7, 14, 21]
    });
    var spanNames = { 5: '5 ימים', 7: 'שבוע', 14: 'שבועיים', 21: 'שלושה שבועות' };

    var spanRows = spans.rows.filter(function (row) { return row.ok && row.covered; })
      .map(function (row) {
        var change = -row.deltaKg;
        var word = change < -0.05 ? 'ירדת' : change > 0.05 ? 'עלית' : 'ללא שינוי';
        return '<tr><td>' + P.esc(spanNames[row.days] || row.days + ' ימים') + '</td>' +
          '<td>' + P.esc(word) + '</td>' +
          '<td class="n">' + P.delta(change, 2, 'down') + '</td></tr>';
      }).join('');

    var spansCard = spanRows
      ? P.card('לפי טווחים', 'כל טווח מושווה לימים שקדמו לו מיד',
          P.table([{ label: 'טווח', n: false }, { label: 'מה קרה', n: false }, 'שינוי'],
            [spanRows],
            { hint: 'הטווחים חופפים ביניהם, ולכן טבעי שהם לא מספרים בדיוק אותו סיפור. ' +
              'ככל שהטווח ארוך יותר, המספר אמין יותר.' }))
      : '';

    return P.section('מה קרה למשקל',
      P.card(null, null, P.chart('chart-weight', 200)) +
      P.card(null, null,
        '<p class="lead">' + headline + '</p>' +
        P.table([{ label: 'תקופה', n: false }, 'משקל ממוצע', 'שינוי'], [rows],
          { hint: 'המספר הוא ממוצע של שבוע ולא שקילה אחת, כי שקילה בודדת קופצת ' +
            'בחצי קילו בגלל מלח, שתייה ושעת השקילה.' })) +
      spansCard);
  }

  // ------------------------------------------------ שומן ושריר

  function bodySection(state, entries) {
    var r = Metrics.bodyChangeSummary(entries, { endDate: state.date, windows: [7, 14] });
    var usable = r.rows.filter(function (row) { return row.ok; });
    if (!usable.length) return '';

    var longest = usable[usable.length - 1];
    var fat = longest.fields.bodyFatKg.change;
    var weight = longest.fields.weightKg.change;

    var headline;
    if (Fmt.isNum(fat) && Fmt.isNum(weight) && weight < -0.1 && fat < 0) {
      var share = Math.min((fat / weight) * 100, 100);
      headline = 'ב-' + longest.days + ' הימים האחרונים ירדת ' +
        Fmt.numHtml(Math.abs(weight), 2) + ' קילו, ומתוכם ' +
        Fmt.numHtml(share, 0) + '% שומן.';
    } else if (Fmt.isNum(fat)) {
      headline = 'ב-' + longest.days + ' הימים האחרונים השומן ' +
        (fat < 0 ? 'ירד ב-' : 'עלה ב-') + Fmt.numHtml(Math.abs(fat), 2) + ' קילו.';
    } else {
      headline = 'אין מספיק מדידות שומן להשוואה.';
    }

    var rows = usable.map(function (row) {
      return '<tr><td>' + row.days + ' הימים האחרונים</td>' +
        '<td class="n">' + P.delta(row.fields.bodyFatKg.change, 2, 'down') + '</td>' +
        '<td class="n">' + P.delta(row.fields.muscleKg.change, 2, 'up') + '</td></tr>';
    }).join('');

    return P.section('שומן ושריר',
      P.card(null, null,
        '<p class="lead">' + headline + '</p>' +
        P.table([{ label: 'תקופה', n: false }, 'שומן', 'שריר'], [rows],
          { hint: 'המשקל הביתי מודד שומן בעקיפין ולכן פחות מדויק מהמשקל עצמו. ' +
            'הכיוון אמין, הספרה השנייה פחות.' })));
  }

  // ------------------------------------------------------ מה אכלתי

  function foodSection(state, entries, settings) {
    var macro = Metrics.macroSplit(entries, { endDate: state.date, windowDays: 14 });
    if (!macro.ok) return '';

    var r = adjust(report(entries, settings, state.date, state), state.caution);
    var target = r.ok ? r.target : null;
    var labels = { proteinG: 'חלבון', carbG: 'פחמימות', fatG: 'שומן' };
    var colors = { proteinG: COLORS.brand, carbG: COLORS.violet, fatG: COLORS.warn };

    var explained = macro.parts.reduce(function (sum, p) { return sum + p.kcal; }, 0);
    var shareOf = function (p) { return explained ? p.kcal / explained : 0; };

    var segments = macro.parts.filter(function (p) { return p.kcal > 0; }).map(function (p) {
      return '<div class="split-seg" style="width:' + (shareOf(p) * 100).toFixed(1) +
        '%;background:' + colors[p.field] + '"></div>';
    }).join('');

    var legend = macro.parts.map(function (p) {
      return '<span class="split-key"><i style="background:' + colors[p.field] + '"></i>' +
        P.esc(labels[p.field]) + ' ' + Fmt.n(shareOf(p) * 100, 0) + '%</span>';
    }).join('');

    var protein = macro.parts.find(function (p) { return p.field === 'proteinG'; });
    var proteinTarget = settings.targets.proteinG;

    var mismatch = Math.abs(macro.unexplainedShare) > 0.05
      ? P.hint('שים לב: החלבון, הפחמימות והשומן שרשמת מסתכמים ל' +
          (macro.unexplained > 0 ? 'פחות' : 'יותר') + ' קלוריות ממה שרשמת בפועל, ' +
          'בפער של ' + Fmt.n(Math.abs(macro.unexplainedShare) * 100, 0) + '%. ' +
          'בדרך כלל זה ימים שנרשמו בלי כל הפרטים.')
      : '';

    var headline = 'בשבועיים האחרונים אכלת בממוצע ' + Fmt.numHtml(macro.kcalPerDay, 0) +
      ' קלוריות ביום' +
      (Fmt.isNum(target) ? ', כשהיעד הוא ' + Fmt.numHtml(target, 0) + '.' : '.');

    return P.section('מה אכלתי',
      P.card(null, null,
        '<p class="lead">' + headline + '</p>' +
        P.chart('chart-kcal', 170)) +
      P.card('מאיפה מגיעות הקלוריות', null,
        '<div class="split">' + segments + '</div>' +
        '<div class="split-keys">' + legend + '</div>' +
        mismatch +
        P.tiles([
          P.tile(Fmt.isNum(proteinTarget) && protein.gramsPerDay >= proteinTarget ? 'good' : 'warn',
            'חלבון ביום', Fmt.n(protein.gramsPerDay, 0) + ' גר׳',
            Fmt.isNum(proteinTarget) ? 'היעד ' + Fmt.n(proteinTarget, 0) : ''),
          P.tile('', 'קלוריות ביום', Fmt.n(macro.kcalPerDay, 0), 'בממוצע')
        ]) +
        P.hint('חלבון שומר על השריר בזמן ירידה במשקל ומשאיר תחושת שובע לאורך זמן.')));
  }

  // ------------------------------------------------- הזנה וצילום

  var ENTRY_FIELDS = [
    { key: 'weightKg', label: 'משקל', unit: 'ק״ג', step: '0.1' },
    { key: 'bodyFatKg', label: 'שומן', unit: 'ק״ג', step: '0.1' },
    { key: 'muscleKg', label: 'שריר', unit: 'ק״ג', step: '0.1' },
    { key: 'kcal', label: 'קלוריות', unit: '', step: '10' },
    { key: 'proteinG', label: 'חלבון', unit: 'גר׳', step: '1' },
    { key: 'carbG', label: 'פחמימות', unit: 'גר׳', step: '1' },
    { key: 'fatG', label: 'שומן באוכל', unit: 'גר׳', step: '1' },
    { key: 'fiberG', label: 'סיבים', unit: 'גר׳', step: '1' },
    { key: 'steps', label: 'צעדים', unit: '', step: '100' }
  ];

  function entrySection(state, entries) {
    var entry = Store.getEntry(state.date) || {};

    var fields = ENTRY_FIELDS.map(function (f) {
      return '<div class="field"><label for="in-' + f.key + '">' + P.esc(f.label) +
        (f.unit ? ' <span class="unit">' + P.esc(f.unit) + '</span>' : '') + '</label>' +
        '<input id="in-' + f.key + '" data-field="' + f.key + '" type="number" ' +
        'inputmode="decimal" step="' + f.step + '" value="' +
        (Fmt.isNum(entry[f.key]) ? entry[f.key] : '') + '"></div>';
    }).join('');

    return P.section('הזנה',
      P.card(null, Dates.long(state.date),
        '<div class="field-grid">' + fields + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
          '<button type="button" class="btn btn--primary" id="save-entry">שמירה</button>' +
          '<button type="button" class="btn" id="day-back">יום אחורה</button>' +
          '<button type="button" class="btn" id="day-fwd">יום קדימה</button>' +
        '</div>') +
      photoCard(state));
  }

  /**
   * הערכת ארוחה מתמונה. שני מעריכים עם הטיות מנוגדות מגיעים למספרים
   * שונים, מגיבים זה לזה, וסיבוב שלישי מכריע. כל השלבים מוצגים —
   * המחלוקת עצמה היא המידע השימושי, לא רק המספר הסופי.
   */
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
      { key: settings.aiKeyA, model: settings.aiModelA, provider: settings.aiProviderA },
      { key: settings.aiKeyB, model: settings.aiModelB, provider: settings.aiProviderB }
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
        '<input type="file" id="photo" accept="image/*" capture="environment">' +
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

  function settingsSection(state, entries, settings) {
    var Providers = root.Providers;
    var rate = Fmt.isNum(settings.goal.ratePerWeekKg) ? Math.abs(settings.goal.ratePerWeekKg) : 0;

    var body =
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

      '<div class="field"><label for="ai-key-b">מפתח שני ' +
        '<span class="unit">' + P.esc(providerLabel(settings.aiKeyB, settings.aiProviderB)) +
        '</span></label>' +
        '<input id="ai-key-b" data-key="aiKeyB" type="password" autocomplete="off" ' +
        'placeholder="sk-or-..." value="' + P.esc(settings.aiKeyB || '') + '"></div>' +
      providerPicker('B', settings.aiKeyB, settings.aiProviderB) +

      (Providers.detect(settings.aiKeyB, settings.aiProviderB) === 'openrouter'
        ? '<div class="field"><label for="ai-model-b">מודל ב-OpenRouter</label>' +
          '<input id="ai-model-b" data-model="aiModelB" type="text" ' +
          'placeholder="' + P.esc(Providers.PROVIDERS.openrouter.defaultModel) + '" value="' +
          P.esc(settings.aiModelB || '') + '"></div>'
        : '') +

      P.hint('שני מפתחות חינמיים: Gemini ב-aistudio.google.com/apikey — ' +
        'המפתח משם מתחיל ב-AIza; ו-OpenRouter ב-openrouter.ai/keys, ' +
        'שם בוחרים מודל שהשם שלו מסתיים ב-free. ' +
        'עם שניהם הוויכוח הוא בין מודלים ממשפחות שונות; עם אחד בלבד הוא ' +
        'בין שתי עמדות של אותו מודל. המפתחות נשמרים במכשיר הזה בלבד.') +

      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
        '<button type="button" class="btn btn--primary" id="pull">עדכון נתונים מהגיליון</button>' +
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

    container.innerHTML =
      top(state, entries, settings) +
      todaySection(state, entries, settings) +
      entrySection(state, entries) +
      weightSection(state, entries) +
      bodySection(state, entries) +
      foodSection(state, entries, settings) +
      settingsSection(state, entries, settings);

    drawCharts(state, entries, settings);
  }

  root.Dash = { render: render, COLORS: COLORS };
})(typeof window !== 'undefined' ? window : globalThis);
