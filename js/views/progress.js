/**
 * מסך ההתקדמות. שאלה אחת: אתה מתקדם או לא.
 * כל המספרים כאן הם שינויים בק״ג ובאחוזים, בלי מונחים סטטיסטיים.
 */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  var STATUS = {
    onTrack:  { label: 'בקצב', tone: null },
    behind:   { label: 'איטי מהמתוכנן', tone: 'under' },
    fast:     { label: 'מהר מהמתוכנן', tone: 'under' },
    wrongWay: { label: 'בכיוון ההפוך', tone: 'over' }
  };

  function heroBlock(report, settings) {
    var week = report.rows.find(function (r) { return r.days === 7; });

    if (!week || !week.ok || week.weightChange === null) {
      return UI.hero({
        label: 'השבוע האחרון',
        value: Fmt.EMPTY,
        sentence: 'צריך שקילות בבוקר לאורך שבועיים לפחות כדי להראות התקדמות.'
      });
    }

    var direction = week.weightChange < -0.05 ? 'ירדת' : week.weightChange > 0.05 ? 'עלית' : 'נשארת במקום';
    var sentence = direction === 'נשארת במקום'
      ? 'המשקל שלך לא זז השבוע.'
      : 'בשבוע האחרון ' + direction + ' ' + Fmt.numHtml(Math.abs(week.weightChange), 2) + ' ק״ג.';

    var plan = report.plan;
    if (plan.ok) {
      var s = STATUS[plan.status];
      sentence += ' אתה ' + s.label + '.';
    }

    var facts = [
      { label: 'משקל עכשיו', value: Fmt.n(week.weightNow, 1) },
      { label: 'אחוז שומן', value: Fmt.isNum(week.fatPctNow) ? Fmt.n(week.fatPctNow, 1) + '%' : Fmt.EMPTY }
    ];
    if (plan.ok) {
      facts.push({ label: 'קצב מבוקש', value: Fmt.signed(plan.goalRate, 2) });
    }

    return UI.hero({
      label: 'השבוע האחרון',
      value: Fmt.signed(week.weightChange, 2),
      unit: 'ק״ג',
      tone: plan.ok ? STATUS[plan.status].tone : null,
      sentence: sentence,
      facts: facts
    });
  }

  /** מה לעשות עכשיו — משפט אחד עם מספר אחד */
  function planCard(report, settings) {
    var plan = report.plan;
    if (!plan.ok) {
      return UI.card('התוכנית', null,
        UI.empty('לא הוגדר קצב יעד', 'בחר במסך הנתונים כמה אתה רוצה לרדת בשבוע.'));
    }

    var adjustment = Math.round(plan.kcalAdjustment);
    var body;

    if (plan.status === 'onTrack') {
      body = '<p class="finding">אתה יורד ' + Fmt.numHtml(Math.abs(plan.actualRate), 2) +
        ' ק״ג בשבוע, וזה מה שתכננת. אין מה לשנות.</p>';
    } else if (plan.status === 'wrongWay') {
      body = '<p class="finding">המשקל עולה במקום לרדת. כדי לחזור לקצב שביקשת צריך ' +
        Fmt.numHtml(Math.abs(adjustment), 0) + ' קלוריות פחות ביום.</p>';
    } else if (plan.status === 'behind') {
      body = '<p class="finding">אתה יורד ' + Fmt.numHtml(Math.abs(plan.actualRate), 2) +
        ' ק״ג בשבוע במקום ' + Fmt.numHtml(Math.abs(plan.goalRate), 2) + '. ' +
        Fmt.numHtml(Math.abs(adjustment), 0) + ' קלוריות פחות ביום יסגרו את הפער.</p>';
    } else {
      body = '<p class="finding">אתה יורד ' + Fmt.numHtml(Math.abs(plan.actualRate), 2) +
        ' ק״ג בשבוע, מהר ממה שתכננת. אפשר להוסיף ' + Fmt.numHtml(Math.abs(adjustment), 0) +
        ' קלוריות ביום.</p>' +
        UI.basis('ירידה מהירה מדי באה בדרך כלל גם על חשבון שריר.');
    }

    return UI.card('התוכנית', null, body +
      UI.basis('מבוסס על ' + plan.windowDays + ' הימים האחרונים.'));
  }

  function changesCard(report) {
    var rows = report.rows.map(function (r) {
      if (!r.ok) {
        return '<tr><td>' + r.days + ' ימים</td>' +
          '<td colspan="2" class="missing">אין מספיק שקילות</td></tr>';
      }
      return '<tr><td>' + r.days + ' ימים' + (r.noisy ? ' *' : '') + '</td>' +
        '<td class="n"><span class="' + Fmt.deltaClass(r.weightChange, 'down') + '">' +
          Fmt.signed(r.weightChange, 2) + '</span></td>' +
        '<td class="n"><span class="' +
          (r.fatPctChange === null ? '' : Fmt.deltaClass(r.fatPctChange, 'down')) + '">' +
          (r.fatPctChange === null ? '—' : Fmt.signed(r.fatPctChange, 1)) + '</span></td></tr>';
    }).join('');

    return UI.card('כמה ירדת', 'כל תקופה מושווית לתקופה שלפניה',
      '<div class="table-scroll"><table class="data"><thead><tr>' +
        '<th>תקופה</th><th class="n">משקל (ק״ג)</th><th class="n">שומן (%)</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      UI.basis('* טווח קצר מושפע ממלח ומנוזלים. הסתכל על 7 ו-14 ימים.'));
  }

  function render(container) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();
    var date = root.App.state.date > Dates.today() ? Dates.today() : root.App.state.date;

    if (!entries.length) {
      container.innerHTML = UI.empty('אין עדיין נתונים', 'התחל לשקול בבוקר ולרשום מה אכלת.');
      return;
    }

    var report = Metrics.progressReport(entries, settings, { endDate: date });

    container.innerHTML =
      '<div class="btn-row" style="margin-bottom:16px">' +
        '<button type="button" class="btn btn--ghost" id="back-home">‹ חזרה</button></div>' +
      heroBlock(report, settings) +
      planCard(report, settings) +
      changesCard(report) +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button type="button" class="btn" id="open-status">ניתוח מלא</button>' +
      '</div>';

    container.querySelector('#back-home').addEventListener('click', function () {
      root.App.setState({ view: 'today' });
    });

    container.querySelector('#open-status').addEventListener('click', function () {
      root.App.setState({ view: 'status' });
    });
  }

  Views.progress = { id: 'progress', label: 'התקדמות', glyph: '↗', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
