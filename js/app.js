/**
 * App — שלד האפליקציה: מצב, ניווט והודעות.
 * כל שינוי בנתונים או במצב מרנדר מחדש את המסך הפעיל בלבד.
 */
(function (root) {
  'use strict';

  var Dates = root.Dates, Store = root.Store, Views = root.Views, Chart = root.Chart;

  // הטאבים שמוצגים בסרגל התחתון. חמישה, כדי שייכנסו גם במסך צר.
  var TABS = ['today', 'entry', 'calc', 'trends', 'data'];

  // מסכים שנפתחים מתוך מסך אחר ואין להם טאב משלהם.
  // MAP הוא איזה טאב יישאר מסומן כשהם פתוחים.
  var NESTED = { progress: 'today', status: 'today', target: 'today' };

  var ORDER = TABS.concat(Object.keys(NESTED));

  var App = {
    // חותמת בנייה — מופיעה בראש המסך כדי שאפשר יהיה לדעת איזו גרסה פתוחה
    BUILD: 'v27',
    state: {
      view: 'today',
      date: Dates.today(),
      window: 28,   // חלון הניתוח במסך המצב
      range: 90,    // טווח התצוגה במסך המגמות
      period: 7,    // תקופת החישוב במסך היעד
      stepsMode: 'base',      // 'base' = בלי צעדים, 'total' = כולל
      deficitUnit: 'kg',      // יחידות בטבלת הגירעון
      calcWindow: 'adaptive', // חלון החישוב במסך הבית
      tdeeMode: 'daily'       // תצוגת גרף ההוצאה: יומי או מצטבר
    }
  };

  var elements = {};
  var toastTimer = null;

  function renderTabs() {
    var active = NESTED[App.state.view] || App.state.view;
    elements.tabs.innerHTML = TABS.map(function (id) {
      var view = Views[id];
      return '<button type="button" role="tab" data-view="' + id + '" ' +
        'aria-selected="' + (active === id ? 'true' : 'false') + '" ' +
        'aria-controls="view-' + id + '">' +
        '<span class="glyph" aria-hidden="true">' + view.glyph + '</span>' +
        '<span>' + view.label + '</span></button>';
    }).join('');

    elements.tabs.querySelectorAll('[data-view]').forEach(function (button) {
      button.addEventListener('click', function () {
        App.setState({ view: button.dataset.view });
      });
    });
  }

  function renderActiveView() {
    Chart.sweep();
    ORDER.forEach(function (id) {
      var host = document.getElementById('view-' + id);
      var active = id === App.state.view;
      host.classList.toggle('is-active', active);
      host.setAttribute('aria-hidden', active ? 'false' : 'true');
      if (active) Views[id].render(host);
      else host.innerHTML = '';
    });
    elements.stamp.textContent = Dates.long(App.state.date) + '  ·  ' + App.BUILD;
  }

  App.setState = function (patch) {
    var viewChanged = patch.view && patch.view !== App.state.view;
    if (patch.view && !Views[patch.view]) return;
    Object.assign(App.state, patch);
    if (viewChanged) {
      renderTabs();
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    renderActiveView();
  };

  App.toast = function (message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      elements.toast.classList.remove('is-visible');
    }, 2600);
  };

  App.start = function () {
    elements.tabs = document.getElementById('tabs');
    elements.toast = document.getElementById('toast');
    elements.stamp = document.getElementById('stamp');

    Store.init();
    // כל כתיבה לחנות מרעננת את המסך הפעיל, כך שאין צורך לרנדר ידנית
    // אחרי כל פעולה — מקור אמת אחד למסך.
    Store.subscribe(renderActiveView);

    renderTabs();
    renderActiveView();

    // חזרה לאפליקציה אחרי חצות צריכה להראות את היום הנוכחי
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (App.state.view === 'today' && App.state.date < Dates.today()) return;
      renderActiveView();
    });
  };

  root.App = App;
  document.addEventListener('DOMContentLoaded', App.start);
})(window);
