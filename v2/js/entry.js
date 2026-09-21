/**
 * Entry — טאב ההזנה.
 *
 * יום אחד נסגר בכל פעם: האוכל של יום מסוים, והשקילה של הבוקר
 * שאחריו. כך ההזנה נראית בדיוק כמו החישוב — המשקל של הבוקר סוגר
 * את היום שלפניו — ואין שני תאריכים שונים לחשוב עליהם.
 *
 * מתחת, רשימת הימים האחרונים: לחיצה על יום פותחת אותו לעריכה, וכל
 * יום מסומן לפי מה שידוע על שמירתו בגיליון.
 */
(function (root) {
  'use strict';

  var Fmt = root.Fmt, Dates = root.Dates, Store = root.Store, P = root.Parts;

  var BODY = [
    { key: 'weightKg', label: 'משקל', unit: 'ק״ג', step: '0.1' },
    { key: 'bodyFatKg', label: 'שומן', unit: 'ק״ג', step: '0.1' },
    { key: 'muscleKg', label: 'שריר', unit: 'ק״ג', step: '0.1' },
    { key: 'waterKg', label: 'נוזלים', unit: 'ק״ג', step: '0.1' }
  ];

  var FOOD = [
    { key: 'kcal', label: 'קלוריות', unit: '', step: '10' },
    { key: 'proteinG', label: 'חלבון', unit: 'גר׳', step: '1' },
    { key: 'carbG', label: 'פחמימות', unit: 'גר׳', step: '1' },
    { key: 'fatG', label: 'שומן', unit: 'גר׳', step: '1' },
    { key: 'fiberG', label: 'סיבים', unit: 'גר׳', step: '1' },
    { key: 'steps', label: 'צעדים', unit: '', step: '100' }
  ];

  function fields(list, entry) {
    return '<div class="field-grid">' + list.map(function (f) {
      return '<div class="field"><label for="in-' + f.key + '">' + P.esc(f.label) +
        (f.unit ? ' <span class="unit">' + P.esc(f.unit) + '</span>' : '') + '</label>' +
        '<input id="in-' + f.key + '" data-field="' + f.key + '" type="number" ' +
        'inputmode="decimal" step="' + f.step + '" value="' +
        (Fmt.isNum(entry[f.key]) ? entry[f.key] : '') + '"></div>';
    }).join('') + '</div>';
  }

  /** כמה כבר מולא באותו יום, כדי לדעת מיד מה חסר */
  function filledCount(entry, list) {
    return list.filter(function (f) { return Fmt.isNum(entry[f.key]); }).length;
  }

  /**
   * היום שנסגר.
   *
   * בכל בוקר נסגר יום אחד: האוכל של אתמול, והשקילה של הבוקר שסוגרת
   * אותו. אלה נראו כשני תאריכים שונים בשני טפסים, וזה בלבל — אבל
   * זה יום אחד, וכך בדיוק החישוב כבר רואה אותו.
   *
   * ברירת המחדל היא אתמול, כי זה היום שנסגר הבוקר.
   */
  function closingDay(state) {
    var day = state.entryDay;
    var today = Dates.today();
    if (!day || day >= today) day = Dates.addDays(today, -1);
    return day;
  }

  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function weekday(iso) {
    return WEEKDAYS[new Date(iso + 'T12:00:00Z').getUTCDay()];
  }

  /** מה ידוע על שמירת יום לגיליון */
  function syncBadge(settings, date, group) {
    var log = (settings.syncLog || {})[date + ':' + group];
    if (!log) return '';
    var marks = {
      verified: ['good', '✓'],
      duplicate: ['warn', '⚠ כפול'],
      mismatch: ['warn', '⚠ שונה'],
      missing: ['bad', '✗'],
      unknown: ['', '⏳']
    };
    var m = marks[log] || ['', ''];
    return '<span class="badge' + (m[0] ? ' badge--' + m[0] : '') + '">' + m[1] + '</span>';
  }

  function navigator(day) {
    var morning = Dates.addDays(day, 1);
    var canForward = morning < Dates.today();

    return '<div class="day-nav">' +
      '<button type="button" class="chip" data-shift="-1" aria-label="יום קודם">›</button>' +
      '<div class="day-title">' +
        '<strong>סוגר את יום ' + weekday(day) + ' ' + P.esc(Dates.short(day)) + '</strong>' +
        '<span class="sub">אוכל של ' + P.esc(Dates.short(day)) +
          ' · שקילת בוקר ' + P.esc(Dates.short(morning)) + '</span>' +
      '</div>' +
      '<button type="button" class="chip" data-shift="1" aria-label="יום הבא"' +
        (canForward ? '' : ' disabled') + '>‹</button>' +
    '</div>';
  }

  /** הימים האחרונים, כדי לראות מה חסר ולתקן */
  function dayList(day, settings) {
    var rows = [];
    var yesterday = Dates.addDays(Dates.today(), -1);

    for (var i = 0; i < 14; i++) {
      var d = Dates.addDays(yesterday, -i);
      var food = Store.getEntry(d) || {};
      var body = Store.getEntry(Dates.addDays(d, 1)) || {};
      var active = d === day;

      rows.push('<tr data-day="' + d + '"' + (active ? ' class="now"' : '') + '>' +
        '<td class="date-cell">' + P.esc(Dates.short(d)) +
          '<span class="sub">' + weekday(d) + '</span></td>' +
        '<td class="n">' + (Fmt.isNum(food.kcal) ? Fmt.n(food.kcal, 0)
          : '<span class="flat">—</span>') + ' ' + syncBadge(settings, d, 'food') + '</td>' +
        '<td class="n">' + (Fmt.isNum(body.weightKg) ? Fmt.n(body.weightKg, 1)
          : '<span class="flat">—</span>') + ' ' +
          syncBadge(settings, Dates.addDays(d, 1), 'body') + '</td>' +
      '</tr>');
    }

    return P.card('הימים האחרונים', 'לחיצה על יום פותחת אותו לעריכה',
      P.table(['יום', 'אוכל', 'שקילת הבוקר שאחריו'], [rows.join('')],
        { hint: '✓ נשמר ואומת בגיליון · ⏳ נשלח ולא אומת · ⚠ כפול: יש בגיליון ' +
          'יותר משורה אחת לתאריך · ✗ לא נמצא בגיליון. ' +
          'יום בלי סימן נמשך מהגיליון או נשמר לפני שהאימות נוסף.' }));
  }

  /**
   * מאקרו שלא קיים באף יום מדווח פעם אחת כאן, במקום להופיע כשדה
   * ריק בכל מסך. בדרך כלל זה אומר שהעמודה בגיליון לא נקלטה.
   */
  function missingMacroNote() {
    var entries = Store.getEntries();
    var withKcal = entries.filter(function (e) { return Fmt.isNum(e.kcal); });
    if (withKcal.length < 5) return '';

    var missing = FOOD.filter(function (field) {
      if (field.key === 'kcal') return false;
      return !entries.some(function (e) { return Fmt.isNum(e[field.key]); });
    });

    if (!missing.length) return '';

    return P.hint('אין אף רישום של ' +
      missing.map(function (f) { return f.label; }).join(', ') +
      ' בכל הנתונים, למרות שיש ' + withKcal.length + ' ימים עם קלוריות. ' +
      'אם הנתונים מגיעים מהגיליון, ייתכן שהעמודה לא נקלטה — ' +
      'כדאי למשוך שוב מההגדרות.');
  }

  function render(state) {
    var settings = Store.getSettings();
    var day = closingDay(state);
    var morning = Dates.addDays(day, 1);

    var food = Store.getEntry(day) || {};
    var body = Store.getEntry(morning) || {};

    // השקילה שסוגרת את היום עוד לא קרתה אם הבוקר שלה עתידי
    var bodyOpen = morning <= Dates.today();

    return P.section('הזנה',
      P.card(null, null, navigator(day)) +

      P.card('אוכל של ' + Dates.short(day), 'יום ' + weekday(day),
        fields(FOOD, food) + missingMacroNote()) +

      P.card('שקילת בוקר ' + Dates.short(morning), 'הבוקר שסוגר את היום',
        bodyOpen
          ? fields(BODY, body)
          : P.empty('הבוקר הזה עוד לא הגיע.')) +

      '<button type="button" class="btn btn--primary btn--wide" data-save="day">' +
        'שמירת היום</button>' +
      '<div id="save-status"></div>' +

      dayList(day, settings) +

      root.Dash.photoCard(state));
  }

  root.EntryTab = {
    render: render, BODY: BODY, FOOD: FOOD, filledCount: filledCount,
    closingDay: closingDay
  };
})(typeof window !== 'undefined' ? window : globalThis);
