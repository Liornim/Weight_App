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
      window: 'adaptive',   // בסיס החישוב
      period: 14,           // אורך התקופה
      weightMode: 'rolling',
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

    view.querySelectorAll('[data-wmode]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        App.setState({ weightMode: chip.dataset.wmode });
      });
    });

    view.querySelectorAll('[data-window]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var raw = chip.dataset.window;
        App.setState({ window: raw === 'adaptive' ? 'adaptive' : Number(raw), settingsOpen: true });
      });
    });

    view.querySelectorAll('[data-period]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        App.setState({ period: Number(chip.dataset.period), settingsOpen: true });
      });
    });

    var fold = view.querySelector('details.fold');
    if (fold) {
      fold.addEventListener('toggle', function () { App.state.settingsOpen = fold.open; });
    }

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
