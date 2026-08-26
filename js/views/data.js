/** מסך הנתונים: הגדרות, הטבלה הגולמית, ייבוא וייצוא. */
(function (root) {
  'use strict';

  var Views = root.Views = root.Views || {};
  var Fmt = root.Fmt, Dates = root.Dates, Metrics = root.Metrics, Store = root.Store, UI = root.UI;

  var TABLE_FIELDS = ['weightKg', 'bodyFatKg', 'muscleKg', 'waterKg', 'kcal', 'proteinG', 'carbG', 'fatG', 'fiberG', 'steps'];

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function numberField(id, label, value, step, hint) {
    return '' +
      '<div class="field">' +
        '<label for="' + id + '">' + Fmt.esc(label) +
          (hint ? ' <span class="suffix">' + Fmt.esc(hint) + '</span>' : '') + '</label>' +
        '<input id="' + id + '" type="number" step="' + step + '" value="' +
          (Fmt.isNum(value) ? value : '') + '" autocomplete="off">' +
      '</div>';
  }

  function settingsCard(settings) {
    var t = settings.targets, p = settings.profile, g = settings.goal;
    return UI.card('הגדרות', 'משמשות ליעדים, לחישוב BMR ולתחזיות',
      '<div class="section-label" style="margin-top:0">יעדים יומיים</div>' +
      '<div class="field-grid">' +
        numberField('t-kcal', 'קלוריות', t.kcal, 10) +
        numberField('t-proteinG', 'חלבון', t.proteinG, 1, 'גר׳') +
        numberField('t-proteinMinG', 'מינימום חלבון', t.proteinMinG, 1, 'גר׳') +
        numberField('t-carbG', 'פחמימה', t.carbG, 1, 'גר׳') +
        numberField('t-fatG', 'שומן', t.fatG, 1, 'גר׳') +
        numberField('t-fiberG', 'סיבים', t.fiberG, 1, 'גר׳') +
      '</div>' +

      '<div class="field field-wide" style="margin-top:12px"><label for="s-autoTarget">מקור היעד</label>' +
        '<select id="s-autoTarget">' +
          '<option value="manual"' + (settings.autoTargetFromTdee ? '' : ' selected') + '>יעד ידני קבוע</option>' +
          '<option value="tdee"' + (settings.autoTargetFromTdee ? ' selected' : '') + '>נגזר מה-TDEE ומקצב היעד</option>' +
        '</select></div>' +

      '<div class="section-label">כמה לרדת בשבוע</div>' +
      '<p class="card-note">ירידה של יותר מקילו בשבוע באה בדרך כלל על חשבון שריר</p>' +
      UI.chips([
        { value: -0.25, label: '0.25 ק״ג' },
        { value: -0.5, label: '0.5 ק״ג' },
        { value: -0.75, label: '0.75 ק״ג' },
        { value: 0, label: 'שמירה' }
      ], g.ratePerWeekKg, 'data-rate') +
      '<div class="field-grid" style="margin-top:12px">' +
        numberField('g-rate', 'או ערך אחר', g.ratePerWeekKg, 0.05, 'ק״ג, שלילי = ירידה') +
        numberField('g-target', 'משקל יעד', g.targetWeightKg, 0.1, 'ק״ג') +
        numberField('s-kcalPerKg', 'קק״ל לק״ג', settings.kcalPerKg, 100, 'ברירת מחדל 7700') +
        numberField('s-kcalPerStep', 'קק״ל לצעד', settings.kcalPerStep, 0.005,
          '0.040 = 25 צעדים לקלוריה') +
      '</div>' +

      '<div class="section-label">פרופיל</div>' +
      '<div class="field-grid">' +
        numberField('p-height', 'גובה', p.heightCm, 1, 'ס״מ') +
        '<div class="field"><label for="p-birth">תאריך לידה</label>' +
          '<input id="p-birth" type="date" value="' + Fmt.esc(p.birthDate || '') + '"></div>' +
        '<div class="field"><label for="p-sex">מין</label><select id="p-sex">' +
          '<option value="male"' + (p.sex === 'male' ? ' selected' : '') + '>גבר</option>' +
          '<option value="female"' + (p.sex === 'female' ? ' selected' : '') + '>אישה</option>' +
        '</select></div>' +
      '</div>' +

      '<div class="btn-row" style="margin-top:18px">' +
        '<button type="button" class="btn btn--primary" id="save-settings">שמירת הגדרות</button>' +
      '</div>');
  }

  function transferCard(entries) {
    return UI.card('גיבוי והעברה',
      'הנתונים נשמרים בדפדפן הזה בלבד. ייצוא הוא הגיבוי היחיד — כדאי לעשות אותו מדי שבוע.',
      '<div class="btn-row">' +
        '<button type="button" class="btn" id="export-csv">ייצוא CSV</button>' +
        '<button type="button" class="btn" id="export-json">ייצוא JSON</button>' +
        '<button type="button" class="btn" id="pick-file">ייבוא מקובץ</button>' +
        '<input type="file" id="import-file" accept=".csv,.json,.txt" hidden>' +
      '</div>' +
      '<div class="field" style="max-width:280px;margin-top:14px">' +
        '<label for="import-mode">אופן הייבוא</label>' +
        '<select id="import-mode">' +
          '<option value="merge">מיזוג — הרשומה העדכנית מנצחת</option>' +
          '<option value="replace">החלפה — מוחק הכל ומייבא מחדש</option>' +
        '</select>' +
      '</div>' +
      UI.basis(entries.length + ' רשומות שמורות' +
        (entries.length ? ' · מ־' + Dates.long(entries[0].date) + ' עד ' + Dates.long(entries[entries.length - 1].date) : '')) +
      '<p class="card-note" style="margin-top:10px">ייבוא CSV מקבל כותרות בעברית או באנגלית, ותאריכים בפורמט DD/MM/YYYY או YYYY-MM-DD.</p>');
  }

  function syncCard(settings) {
    var sync = settings.sync || {};
    return UI.card('משיכה מהגיליון',
      'קורא את הנתונים העדכניים דרך אותו Apps Script שהדפים הישנים שלך משתמשים בו',
      '<div class="field field-wide">' +
        '<label for="sync-url">כתובת ה-Apps Script</label>' +
        '<input id="sync-url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/.../exec" ' +
          'value="' + Fmt.esc(sync.url || '') + '" autocomplete="off">' +
      '</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button type="button" class="btn btn--primary" id="sync-pull">משיכה עכשיו</button>' +
        '<button type="button" class="btn" id="sync-save">שמירת הכתובת</button>' +
      '</div>' +
      '<div id="sync-status"></div>' +
      UI.basis((sync.lastSyncAt ? 'משיכה אחרונה: ' + new Date(sync.lastSyncAt).toLocaleString('he-IL') + ' · ' : '') +
        'המשיכה ממזגת לפי תאריך ולא מוחקת כלום. ' +
        'מי שמחזיק בכתובת יכול לקרוא ולכתוב לגיליון, אז אל תפרסם אותה.'));
  }

  function tableCard(entries) {
    if (!entries.length) {
      return UI.card('רשומות', null, UI.empty('אין רשומות', 'התחל במסך "היום".'));
    }
    var head = '<tr><th>תאריך</th>' +
      TABLE_FIELDS.map(function (f) { return '<th>' + Fmt.esc(Metrics.FIELDS[f].label) + '</th>'; }).join('') +
      '<th>הערה</th><th></th></tr>';

    var rows = entries.slice().reverse().map(function (e) {
      var cells = TABLE_FIELDS.map(function (f) {
        var v = e[f];
        return Fmt.isNum(v)
          ? '<td class="n">' + Fmt.n(v, Metrics.FIELDS[f].digits) + '</td>'
          : '<td class="missing">·</td>';
      }).join('');
      return '<tr>' +
        '<td class="n"><a href="#" data-goto="' + Fmt.esc(e.date) + '">' + Fmt.esc(Dates.short(e.date)) + '</a></td>' +
        cells +
        '<td>' + Fmt.esc((e.note || '').slice(0, 40)) + '</td>' +
        '<td><button type="button" class="btn btn--ghost" data-remove="' + Fmt.esc(e.date) + '">מחיקה</button></td>' +
        '</tr>';
    }).join('');

    return UI.card('רשומות', 'לחיצה על תאריך פותחת אותו לעריכה',
      '<div class="table-scroll"><table class="data"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>');
  }

  function dangerCard() {
    return UI.card('אזור מסוכן', null,
      '<div class="btn-row">' +
        '<button type="button" class="btn btn--danger" id="clear-all">מחיקת כל הנתונים</button>' +
      '</div>' +
      UI.basis('פעולה בלתי הפיכה. ייצא גיבוי קודם.'));
  }

  function render(container) {
    var entries = Store.getEntries();
    var settings = Store.getSettings();

    var pending = Store.pendingSeedId();

    container.innerHTML =
      (pending
        ? '<div class="notice">יש גרסה חדשה של נתוני הפתיחה. מכיוון שכבר ערכת נתונים כאן, ' +
          'לא נגעתי בהם. טעינת הגרסה החדשה תחליף את כל הרשומות ואת ההגדרות.' +
          '<div class="btn-row" style="margin-top:10px">' +
          '<button type="button" class="btn" id="apply-seed">טעינת הנתונים החדשים</button>' +
          '</div></div>'
        : '') +
      (Store.isStorageBlocked()
        ? '<div class="notice notice--error">הדפדפן חוסם שמירה מקומית, כך שהנתונים יאבדו בסגירת הכרטיסייה. ייצא קובץ לפני שתסגור.</div>'
        : '') +
      settingsCard(settings) +
      syncCard(settings) +
      transferCard(entries) +
      tableCard(entries) +
      dangerCard();

    wire(container);
  }

  function wire(container) {
    var applySeed = container.querySelector('#apply-seed');
    if (applySeed) {
      applySeed.addEventListener('click', function () {
        if (!confirm('להחליף את כל הרשומות וההגדרות בנתוני הפתיחה החדשים? כדאי לייצא גיבוי קודם.')) return;
        Store.applyPendingSeed();
        root.App.toast('נתוני הפתיחה נטענו');
      });
    }

    container.querySelectorAll('[data-rate]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        Store.updateSettings({ goal: { ratePerWeekKg: Number(chip.dataset.rate) } });
        root.App.toast('היעד עודכן');
      });
    });

    container.querySelector('#save-settings').addEventListener('click', function () {
      var val = function (id) { return Store.toNumber(container.querySelector(id).value); };
      Store.updateSettings({
        targets: {
          kcal: val('#t-kcal'), proteinG: val('#t-proteinG'),
          proteinMinG: val('#t-proteinMinG'),
          carbG: val('#t-carbG'), fatG: val('#t-fatG'), fiberG: val('#t-fiberG')
        },
        goal: { ratePerWeekKg: val('#g-rate'), targetWeightKg: val('#g-target') },
        profile: {
          heightCm: val('#p-height'),
          birthDate: container.querySelector('#p-birth').value || null,
          sex: container.querySelector('#p-sex').value
        },
        kcalPerKg: val('#s-kcalPerKg') || Metrics.DEFAULT_KCAL_PER_KG,
        kcalPerStep: val('#s-kcalPerStep') || 0.040,
        autoTargetFromTdee: container.querySelector('#s-autoTarget').value === 'tdee'
      });
      root.App.toast('ההגדרות נשמרו');
    });

    var urlInput = container.querySelector('#sync-url');
    var status = container.querySelector('#sync-status');

    container.querySelector('#sync-save').addEventListener('click', function () {
      Store.updateSettings({ sync: { url: urlInput.value.trim() } });
      root.App.toast('הכתובת נשמרה');
    });

    container.querySelector('#sync-pull').addEventListener('click', function () {
      var url = urlInput.value.trim();
      if (!url) {
        status.innerHTML = '<div class="notice notice--error">צריך להזין כתובת קודם.</div>';
        return;
      }
      status.innerHTML = '<div class="notice">מושך נתונים…</div>';

      var before = {};
      Store.getEntries().forEach(function (e) { before[e.date] = true; });

      root.Sheets.pull(url).then(function (result) {
        Store.importJSON(JSON.stringify({ entries: result.entries }), 'merge');
        Store.updateSettings({ sync: { url: url, lastSyncAt: new Date().toISOString() } });

        var added = result.entries.filter(function (e) { return !before[e.date]; }).length;

        function line(label, source) {
          return '<div class="metric-row"><span class="label">' + Fmt.esc(label) + '</span>' +
            '<span class="value">' + (source.action
              ? source.count + ' שורות · ' + (source.span
                  ? Dates.short(source.span.from) + '–' + Dates.short(source.span.to) : '—')
              : 'לא נמצא') + '</span></div>';
        }

        // הדוח נכתב אחרי הרינדור מחדש, ולכן מאתרים את התיבה מחדש
        var box = document.querySelector('#sync-status');
        if (box) {
          box.innerHTML = '<div class="notice">' +
            line('תזונה', result.nutrition) +
            line('מדדי גוף', result.body) +
            '<div class="metric-row"><span class="label">ימים חדשים</span>' +
              '<span class="value">' + added + '</span></div>' +
            (result.body.action ? '' :
              '<p class="basis" style="margin-top:8px">מדדי הגוף לא נמשכו. ' +
              'ייתכן שה-Apps Script חושף אותם בשם פעולה אחר.</p>') +
            '</div>';
        }
        root.App.toast('נמשכו ' + result.entries.length + ' רשומות · ' + added + ' ימים חדשים');
      }).catch(function (error) {
        // ה-DOM מתרנדר מחדש בין הלחיצה לתשובה, ולכן מאתרים את התיבה מחדש
        var box = document.querySelector('#sync-status');
        if (box) {
          box.innerHTML = '<div class="notice notice--error">' + Fmt.esc('המשיכה נכשלה: ' + error.message) +
            '<br>בדוק שהכתובת נכונה ושה-Apps Script מוגדר כזמין לכל מי שיש לו הקישור.</div>';
        }
      });
    });

    container.querySelector('#export-csv').addEventListener('click', function () {
      download('metrics-' + Dates.today() + '.csv', Store.exportCSV(), 'text/csv');
    });

    container.querySelector('#export-json').addEventListener('click', function () {
      download('metrics-' + Dates.today() + '.json', Store.exportJSON(), 'application/json');
    });

    var fileInput = container.querySelector('#import-file');
    container.querySelector('#pick-file').addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var mode = container.querySelector('#import-mode').value;
      if (mode === 'replace' && !confirm('ההחלפה תמחק את כל הרשומות הקיימות. להמשיך?')) {
        fileInput.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = String(reader.result);
          var result = /\.json$/i.test(file.name) || text.trim().charAt(0) === '{'
            ? Store.importJSON(text, mode)
            : Store.importCSV(text, mode);
          root.App.toast('יובאו ' + result.imported + ' רשומות' +
            (result.skipped ? ', ' + result.skipped + ' שורות דולגו' : ''));
        } catch (err) {
          root.App.toast('הייבוא נכשל: ' + err.message);
        }
        fileInput.value = '';
      };
      reader.onerror = function () {
        root.App.toast('לא הצלחתי לקרוא את הקובץ');
        fileInput.value = '';
      };
      reader.readAsText(file, 'utf-8');
    });

    container.querySelectorAll('[data-goto]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        root.App.setState({ date: link.dataset.goto, view: 'today' });
      });
    });

    container.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('למחוק את הרשומה של ' + Dates.long(btn.dataset.remove) + '?')) return;
        Store.remove(btn.dataset.remove);
        root.App.toast('נמחק');
      });
    });

    container.querySelector('#clear-all').addEventListener('click', function () {
      if (!confirm('למחוק את כל הרשומות? אין דרך חזרה.')) return;
      if (!confirm('בטוח? כדאי לייצא גיבוי קודם.')) return;
      Store.clearAll();
      root.App.toast('כל הנתונים נמחקו');
    });
  }

  Views.data = { id: 'data', label: 'נתונים', glyph: '#', render: render };
})(typeof window !== 'undefined' ? window : globalThis);
