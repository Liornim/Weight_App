/**
 * App — השלד של הלוח.
 *
 * מסך אחד, ולכן אין נתב ואין טאבים. כל מה שנשמר כאן הוא בחירות
 * תצוגה; הנתונים וההגדרות יושבים ב-Store המשותף עם האפליקציה
 * הקודמת, כך שאותם נתונים מוצגים בשני המקומות בלי ייבוא נוסף.
 */
(function (root) {
  'use strict';

  var Dates = root.Dates, Store = root.Store, Fmt = root.Fmt;

  var App = {
    BUILD: 'd1',
    state: {
      date: Dates.today(),
      asOf: 0,             // עד מתי למדוד: היום, שבוע שעבר, שבועיים
      basis: 'adaptive',   // על סמך כמה זמן לחשב
      caution: 'mid',      // זהיר / אמצע / נדיב
      settingsOpen: false
    }
  };

  var elements = {};
  var toastTimer = null;

  App.setState = function (patch) {
    Object.assign(App.state, patch);
    render();
  };

  App.toast = function (message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elements.toast.classList.remove('show'); }, 2600);
  };

  function render() {
    root.Chart.sweep();
    root.Dash.render(elements.view, App.state);
    wire();
  }

  function wire() {
    var view = elements.view;

    var fold = view.querySelector('details.fold');
    if (fold) {
      fold.addEventListener('toggle', function () { App.state.settingsOpen = fold.open; });
    }

    view.querySelectorAll('[data-asof]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        App.setState({ asOf: Number(chip.dataset.asof) });
      });
    });

    view.querySelectorAll('[data-basis]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var raw = chip.dataset.basis;
        App.setState({ basis: raw === 'adaptive' ? 'adaptive' : Number(raw) });
      });
    });

    view.querySelectorAll('[data-caution]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        App.setState({ caution: chip.dataset.caution });
      });
    });

    var goal = view.querySelector('#goal-weight');
    if (goal) {
      goal.addEventListener('change', function () {
        Store.updateSettings({ goal: { targetWeightKg: Store.toNumber(goal.value) } });
        App.toast('משקל היעד עודכן');
      });
    }

    var rate = view.querySelector('#rate');
    if (rate) {
      var label = view.querySelector('#rate-label');
      rate.addEventListener('input', function () {
        if (label) label.textContent = Fmt.n(Number(rate.value), 2);
      });
      rate.addEventListener('change', function () {
        Store.updateSettings({ goal: { ratePerWeekKg: -Number(rate.value) } });
      });
    }

    var protein = view.querySelector('#protein-target');
    if (protein) {
      protein.addEventListener('change', function () {
        Store.updateSettings({ targets: { proteinG: Store.toNumber(protein.value) } });
        App.toast('יעד החלבון עודכן');
      });
    }

    var aiKey = view.querySelector('#ai-key');
    if (aiKey) {
      aiKey.addEventListener('change', function () {
        Store.updateSettings({ aiKey: aiKey.value.trim() });
        App.toast(aiKey.value.trim() ? 'המפתח נשמר במכשיר' : 'המפתח הוסר');
      });
    }

    var save = view.querySelector('#save-entry');
    if (save) {
      save.addEventListener('click', function () {
        var payload = { date: App.state.date };
        view.querySelectorAll('[data-field]').forEach(function (input) {
          payload[input.dataset.field] = input.value;
        });
        try {
          Store.upsert(payload);
          App.toast('נשמר');
        } catch (error) {
          App.toast('השמירה נכשלה: ' + error.message);
        }
      });
    }

    var back = view.querySelector('#day-back');
    if (back) {
      back.addEventListener('click', function () {
        App.setState({ date: Dates.addDays(App.state.date, -1) });
      });
    }

    var forward = view.querySelector('#day-fwd');
    if (forward) {
      forward.addEventListener('click', function () {
        var next = Dates.addDays(App.state.date, 1);
        App.setState({ date: next > Dates.today() ? Dates.today() : next });
      });
    }

    var photo = view.querySelector('#photo');
    if (photo) photo.addEventListener('change', function () { runDebate(photo, view); });

    var pull = view.querySelector('#pull');
    if (pull) {
      pull.addEventListener('click', function () {
        var url = (Store.getSettings().sync || {}).url;
        if (!url) {
          App.toast('לא הוגדרה כתובת גיליון');
          return;
        }
        App.toast('מושך נתונים…');
        root.Sheets.pull(url).then(function (result) {
          Store.importJSON(JSON.stringify({ entries: result.entries }), 'merge');
          Store.updateSettings({ sync: { url: url, lastSyncAt: new Date().toISOString() } });
          App.toast('נמשכו ' + result.entries.length + ' רשומות');
        }).catch(function (error) {
          App.toast('המשיכה נכשלה: ' + error.message);
        });
      });
    }

    var old = view.querySelector('#open-old');
    if (old) {
      old.addEventListener('click', function () { root.location.href = '../'; });
    }
  }

  /** מריץ את הוויכוח ומציג כל שלב בדרך */
  function runDebate(input, view) {
    var file = input.files && input.files[0];
    if (!file) return;

    var box = view.querySelector('#debate');
    var key = Store.getSettings().aiKey;
    var show = function (html) { if (box) box.innerHTML = html; };

    show('<p class="stage">קורא את התמונה…</p>');

    root.Estimate.readImage(file).then(function (image) {
      return root.Estimate.debate(key, image.base64, image.mediaType, function (message) {
        show('<p class="stage">' + root.Fmt.esc(message) + '…</p>');
      });
    }).then(function (result) {
      show(renderDebate(result));
      var apply = view.querySelector('#apply-estimate');
      if (apply) {
        apply.addEventListener('click', function () {
          var f = result.final;
          var setField = function (name, value) {
            var el = view.querySelector('[data-field="' + name + '"]');
            if (el && root.Fmt.isNum(value)) el.value = Math.round(value);
          };
          setField('kcal', f.kcal);
          setField('proteinG', f.protein);
          setField('carbG', f.carbs);
          setField('fatG', f.fat);
          setField('fiberG', f.fiber);
          App.toast('המספרים הוזנו בטופס. בדוק ולחץ שמירה.');
        });
      }
    }).catch(function (error) {
      show('<p class="stage stage--bad">' + root.Fmt.esc(error.message) + '</p>');
    });
  }

  function renderDebate(result) {
    var Fmt = root.Fmt;
    var f = result.final;

    var rounds = result.rounds.map(function (round) {
      var d = round.data;
      var items = (d.items || []).map(function (item) {
        return '<li>' + Fmt.esc(item.name) + ' — ' + Fmt.n(item.grams, 0) + ' גר׳, ' +
          Fmt.n(item.kcal, 0) + ' קק״ל' +
          (item.confidence === 'low' ? ' <span class="low">לא בטוח</span>' : '') + '</li>';
      }).join('');

      return '<details class="round"><summary>' + Fmt.esc(round.name) + ' — ' +
        Fmt.n(d.kcal, 0) + ' קק״ל</summary>' +
        '<ul>' + items + '</ul>' +
        (d.reasoning ? '<p class="why">' + Fmt.esc(d.reasoning) + '</p>' : '') +
        '</details>';
    }).join('');

    var range = f.range && Fmt.isNum(f.range.low)
      ? '<p class="range">טווח סביר: ' + Fmt.n(f.range.low, 0) + '–' +
        Fmt.n(f.range.high, 0) + ' קלוריות</p>'
      : '';

    var gap = Fmt.isNum(result.initialGap)
      ? '<p class="why">הפער בין שני המעריכים בהתחלה: ' + Fmt.n(result.initialGap, 0) +
        ' קלוריות (' + Fmt.n(result.initialGapShare * 100, 0) + '%).</p>'
      : '';

    return '<div class="verdict">' +
        '<div class="verdict-num num">' + Fmt.n(f.kcal, 0) + '</div>' +
        '<div class="verdict-macros num">' +
          'חלבון ' + Fmt.n(f.protein, 0) + ' · פחמימות ' + Fmt.n(f.carbs, 0) +
          ' · שומן ' + Fmt.n(f.fat, 0) + '</div>' +
        (f.verdict ? '<p class="why">' + Fmt.esc(f.verdict) + '</p>' : '') +
        range + gap +
        '<button type="button" class="btn btn--primary" id="apply-estimate">' +
          'הזן לטופס</button>' +
      '</div>' +
      '<div class="rounds">' + rounds + '</div>';
  }

  function init() {
    elements.view = document.getElementById('view');
    elements.toast = document.getElementById('toast');

    Store.init();
    Store.subscribe(render);
    render();
  }

  root.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
