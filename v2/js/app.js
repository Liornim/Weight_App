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
    BUILD: 'd13',
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

    view.querySelectorAll('[data-key]').forEach(function (input) {
      input.addEventListener('change', function () {
        var value = input.value.trim();
        var patch = {};
        patch[input.dataset.key] = value;
        Store.updateSettings(patch);

        var provider = root.Providers.detect(value);
        App.toast(!value ? 'המפתח הוסר'
          : provider ? 'מפתח ' + root.Providers.PROVIDERS[provider].label + ' נשמר במכשיר'
          // הודעה מכוונת: מפתח בפורמט אחר הוא בדרך כלל אסימון התחברות
          // ולא מפתח API, וכדאי לומר במה בדיוק צריך להתחיל
          : 'המפתח לא מזוהה. מפתח Gemini מתחיל ב-AIza, של OpenRouter ב-sk-or');
      });
    });

    view.querySelectorAll('[data-provider]').forEach(function (select) {
      select.addEventListener('change', function () {
        var patch = {};
        patch[select.dataset.provider] = select.value;
        Store.updateSettings(patch);
        App.toast(select.value ? 'הספק נבחר' : 'הבחירה בוטלה');
      });
    });

    view.querySelectorAll('[data-model]').forEach(function (input) {
      input.addEventListener('change', function () {
        var patch = {};
        patch[input.dataset.model] = input.value.trim();
        Store.updateSettings(patch);
      });
    });

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

    var applyPaste = view.querySelector('#paste-apply');
    if (applyPaste) {
      applyPaste.addEventListener('click', function () {
        var input = view.querySelector('#paste-line');
        var box = view.querySelector('#paste-result');
        var result = root.Paste.parse(input.value);

        if (!result.ok) {
          box.innerHTML = '<p class="stage stage--bad">' +
            (result.reason === 'empty' ? 'השדה ריק.' : 'לא מצאתי מספרים בשורה.') + '</p>';
          return;
        }

        var labels = {
          kcal: 'קלוריות', proteinG: 'חלבון', carbG: 'פחמימות', fatG: 'שומן',
          fiberG: 'סיבים', steps: 'צעדים', weightKg: 'משקל',
          muscleKg: 'שריר', bodyFatKg: 'שומן בגוף', waterKg: 'נוזלים'
        };

        var filled = [];
        Object.keys(result.fields).forEach(function (key) {
          var field = view.querySelector('[data-field="' + key + '"]');
          if (!field) return;
          field.value = result.fields[key];
          filled.push(labels[key] + ' ' + result.fields[key]);
        });

        box.innerHTML = '<p class="stage">נקלט: ' + root.Fmt.esc(filled.join(' · ')) + '.' +
          (result.missing.length
            ? ' לא נמצא: ' + root.Fmt.esc(result.missing.map(function (k) {
                return labels[k];
              }).join(', ')) + '.'
            : '') +
          ' בדוק ולחץ שמירה.</p>';
      });
    }

    var copyPrompt = view.querySelector('#copy-prompt');
    if (copyPrompt) {
      copyPrompt.addEventListener('click', function () {
        var text = root.Paste.promptText();
        if (root.navigator && root.navigator.clipboard) {
          root.navigator.clipboard.writeText(text).then(function () {
            App.toast('ההוראה הועתקה');
          }).catch(function () { App.toast('ההעתקה נכשלה'); });
        } else {
          App.toast('הדפדפן לא מאפשר העתקה');
        }
      });
    }

    view.querySelectorAll('.photo-input').forEach(function (input) {
      input.addEventListener('change', function () { runDebate(input, view); });
    });

    var loadModels = view.querySelector('#load-models');
    if (loadModels) {
      loadModels.addEventListener('click', function () {
        var box = view.querySelector('#model-list');
        box.innerHTML = '<p class="stage">מושך את הרשימה…</p>';

        root.Providers.freeVisionModels().then(function (models) {
          if (!models.length) {
            box.innerHTML = '<p class="stage stage--bad">' +
              'לא נמצאו מודלים חינמיים שקוראים תמונות כרגע.</p>';
            return;
          }

          box.innerHTML = '<div class="field">' +
            '<label for="model-pick">' + models.length + ' מודלים זמינים</label>' +
            '<select id="model-pick">' + models.map(function (model) {
              return '<option value="' + root.Fmt.esc(model.id) + '">' +
                root.Fmt.esc(model.name) + '</option>';
            }).join('') + '</select></div>';

          var picker = box.querySelector('#model-pick');
          var field = view.querySelector('[data-model="aiModelB"]');
          if (field) field.value = picker.value;
          Store.updateSettings({ aiModelB: picker.value });

          picker.addEventListener('change', function () {
            if (field) field.value = picker.value;
            Store.updateSettings({ aiModelB: picker.value });
            App.toast('המודל נבחר');
          });
        }).catch(function (error) {
          box.innerHTML = '<p class="stage stage--bad">' +
            root.Fmt.esc(error.message) + '</p>';
        });
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

  /** מריץ את הוויכוח ומציג את שתי ההערכות ואת ההכרעה */
  function runDebate(input, view) {
    var file = input.files && input.files[0];
    if (!file) return;

    var box = view.querySelector('#debate');
    var settings = Store.getSettings();
    var accounts = [
      { key: settings.aiKeyA, model: settings.aiModelA, provider: settings.aiProviderA },
      { key: settings.aiKeyB, model: settings.aiModelB, provider: settings.aiProviderB }
    ].filter(function (a) {
      return a.key && root.Providers.detect(a.key, a.provider);
    });

    /**
     * האלמנט נשלף מחדש בכל כתיבה ולא נשמר במשתנה.
     * שמירת הגדרות באמצע התהליך מרנדרת את המסך מחדש, וכתיבה
     * לאלמנט הישן נעלמת בלי זכר — זה מה שגרם ל"המודל הוחלף וזהו".
     */
    var show = function (html) {
      var el = document.getElementById('debate');
      if (el) el.innerHTML = html;
    };

    var showPreview = function () {
      var el = document.getElementById('preview');
      if (el && root.URL && root.URL.createObjectURL) {
        el.innerHTML = '<img class="shot" alt="התמונה שנבחרה" src="' +
          root.URL.createObjectURL(file) + '">';
      }
    };

    show('<p class="stage">קורא את התמונה…</p>');
    showPreview();

    root.Estimate.readImage(file).then(function (image) {
      return root.Estimate.run(accounts, image, function (message) {
        show('<p class="stage">' + root.Fmt.esc(message) + '…</p>');
      });
    }).then(function (result) {
      // אם המערכת נאלצה לבחור מודל אחר, הבחירה נשמרת כדי שהפעם
      // הבאה תעבוד ישירות
      if (result.lean.recovered || result.rich.recovered) {
        App.toast('המספרים חולצו מטקסט חופשי — כדאי לוודא אותם');
      }
      if (result.pickedModel) {
        Store.updateSettings({ aiModelB: result.pickedModel });
        App.toast('המודל הוחלף ל-' + result.pickedModel);
        // השמירה רינדרה את המסך מחדש, ולכן גם התצוגה המקדימה
        showPreview();
      }
      show(renderDebate(result));
      var apply = document.getElementById('apply-estimate');
      if (apply) {
        apply.addEventListener('click', function () {
          var fields = result.verdict.fields;
          var map = { kcal: 'kcal', protein: 'proteinG', carbs: 'carbG',
            fat: 'fatG', fiber: 'fiberG' };
          Object.keys(map).forEach(function (source) {
            var el = document.querySelector('[data-field="' + map[source] + '"]');
            if (el && root.Fmt.isNum(fields[source])) el.value = Math.round(fields[source]);
          });
          App.toast('המספרים הוזנו בטופס. בדוק ולחץ שמירה.');
        });
      }
    }).catch(function (error) {
      // התשובה הגולמית מוצגת, אחרת אין דרך לדעת מה המודל בעצם החזיר
      var raw = error.raw
        ? '<details class="round" open><summary>מה המודל החזיר בפועל' +
          (error.provider ? ' · ' + root.Fmt.esc(error.provider) : '') +
          (error.model ? ' · ' + root.Fmt.esc(error.model) : '') +
          '</summary><p class="why">' + root.Fmt.esc(error.raw) + '</p></details>'
        : '';
      show('<p class="stage stage--bad">' + root.Fmt.esc(error.message) + '</p>' +
        diagnose(error.message) + raw);
    });
  }

  /** הופך שגיאת שרת להנחיה מה לעשות */
  function diagnose(message) {
    var text = String(message || '');
    var advice = null;

    if (text.indexOf('401') !== -1 || text.indexOf('invalid authentication') !== -1) {
      advice = 'המפתח נדחה. ודא שהעתקת אותו במלואו — בדף של גוגל הוא מוצג מקוצר ' +
        'עם שלוש נקודות, וצריך ללחוץ על סמל ההעתקה ולא לסמן את הטקסט. ' +
        'אם הוא הועתק במלואו, ייתכן שצריך להפעיל את Generative Language API בפרויקט.';
    } else if (text.indexOf('403') !== -1) {
      advice = 'המפתח תקין אבל אין לו הרשאה. בדרך כלל זה אומר שה-API לא מופעל ' +
        'בפרויקט, או שהמפתח מוגבל לכתובות מסוימות.';
    } else if (text.indexOf('429') !== -1) {
      advice = 'חרגת מהמכסה החינמית. שווה לנסות שוב מאוחר יותר.';
    } else if (text.indexOf('ריקה') !== -1) {
      advice = 'תשובה ריקה מגיעה בדרך כלל ממודל חינמי שעמוס כרגע, או שאינו ' +
        'קורא תמונות למרות שהוא מסומן כך. שווה לבחור מודל אחר ברשימה, ' +
        'או למחוק את המפתח הזה ולהמשיך עם אחד בלבד.';
    } else if (text.indexOf('פורמט') !== -1) {
      advice = 'המודל ענה, אבל לא במבנה שביקשנו ובלי מספרים שאפשר לחלץ. ' +
        'זה קורה במודלים חינמיים קטנים. כדאי לבחור מודל אחר ברשימה.';
    } else if (text.indexOf('404') !== -1) {
      advice = 'המודל שנבחר אינו זמין. המערכת מנסה למצוא חלופה לבד; ' +
        'אם זה חוזר, אפשר למחוק את המפתח השני ולהמשיך עם אחד בלבד.';
    }

    return advice ? '<p class="why">' + root.Fmt.esc(advice) + '</p>' : '';
  }

  function renderDebate(result) {
    var Fmt = root.Fmt;
    var v = result.verdict;
    var tone = v.confidence === 'high' ? 'good' : v.confidence === 'low' ? 'bad' : 'warn';

    var side = function (name, provider, data) {
      var items = ((data && data.items) || []).map(function (item) {
        return '<li>' + Fmt.esc(item.name) + ' — ' + Fmt.n(item.grams, 0) + ' גר׳, ' +
          Fmt.n(item.kcal, 0) + ' קק״ל' +
          (item.confidence === 'low' ? ' <span class="low">לא בטוח</span>' : '') + '</li>';
      }).join('');

      return '<details class="round"><summary>' + Fmt.esc(name) + ' · ' +
        Fmt.esc(provider) + ' — ' + Fmt.n(data.kcal, 0) + ' קק״ל</summary>' +
        '<ul>' + items + '</ul>' +
        (data.reasoning ? '<p class="why">' + Fmt.esc(data.reasoning) + '</p>' : '') +
        '</details>';
    };

    var missed = '';
    var diff = result.differences;
    if (diff.onlyLean.length || diff.onlyRich.length) {
      var lines = [];
      if (diff.onlyRich.length) {
        lines.push('רק המחמיר ראה: ' + diff.onlyRich.join(', '));
      }
      if (diff.onlyLean.length) {
        lines.push('רק השמרן ראה: ' + diff.onlyLean.join(', '));
      }
      missed = '<p class="why">' + Fmt.esc(lines.join(' · ')) + '</p>';
    }

    var range = v.range
      ? '<p class="range">שתי ההערכות: ' + Fmt.n(v.range.low, 0) + ' ו-' +
        Fmt.n(v.range.high, 0) + ' קלוריות</p>'
      : '';

    var f = v.fields;

    return '<div class="verdict verdict--' + tone + '">' +
        '<div class="verdict-num num">' + Fmt.n(f.kcal, 0) + '</div>' +
        '<div class="verdict-macros num">חלבון ' + Fmt.n(f.protein, 0) +
          ' · פחמימות ' + Fmt.n(f.carbs, 0) + ' · שומן ' + Fmt.n(f.fat, 0) +
          (root.Fmt.isNum(f.fiber) ? ' · סיבים ' + Fmt.n(f.fiber, 0) : '') + '</div>' +
        (v.agreement ? '<p class="why">' + Fmt.esc(v.agreement) + '</p>' : '') +
        range + missed +
        (v.notes.length ? '<p class="why">' + Fmt.esc(v.notes.join(' ')) + '</p>' : '') +
        '<button type="button" class="btn btn--primary" id="apply-estimate">הזן לטופס</button>' +
      '</div>' +
      '<div class="rounds">' +
        side('שמרן', result.leanProvider, result.lean) +
        side('מחמיר', result.richProvider, result.rich) +
      '</div>' +
      (result.sameProvider
        ? '<p class="why">שתי ההערכות מאותו מודל. מפתח שני, ממשפחה אחרת, ' +
          'היה חושף יותר.</p>'
        : '') +
      (result.pickedModel
        ? '<p class="why">המודל שהיה מוגדר לא היה זמין, והוחלף אוטומטית ל-' +
          Fmt.esc(result.pickedModel) + '.</p>'
        : '');
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
