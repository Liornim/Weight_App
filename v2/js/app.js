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
    BUILD: 'd22',
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

    view.querySelectorAll('[data-project]').forEach(function (input) {
      input.addEventListener('change', function () {
        var patch = {};
        patch[input.dataset.project] = input.value.trim();
        Store.updateSettings(patch);
        App.toast('מספר הפרויקט נשמר');
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
    // כל שדה נושא את המודל שלו, כדי שאפשר יהיה להריץ שני מודלים
    // שונים של אותו ספק — למשל flash מול pro
    var accounts = [
      { slot: 'A', key: settings.aiKeyA, provider: settings.aiProviderA,
        project: settings.aiProjectA, model: settings.aiModelA },
      { slot: 'B', key: settings.aiKeyB, provider: settings.aiProviderB,
        project: settings.aiProjectB, model: settings.aiModelB }
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
      // מודל שהוחלף אוטומטית נשמר בשדה שממנו הגיע
      var slots = Object.keys(result.pickedModels || {});
      if (slots.length) {
        var patch = {};
        slots.forEach(function (slot) { patch['aiModel' + slot] = result.pickedModels[slot]; });
        Store.updateSettings(patch);
        App.toast('המודל הוחלף ל-' + result.pickedModels[slots[0]]);
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
    } else if (text.indexOf('המכסה החינמית') !== -1) {
      advice = 'המכסה היומית החינמית ב-OpenRouter מוגבלת במספר בקשות, ' +
        'והוויכוח משתמש בארבע. אפשר למחוק את מפתח OpenRouter מההגדרות ' +
        'ולהמשיך עם Gemini בלבד — המכסה שלו נדיבה בהרבה.';
    } else if (text.indexOf('עמוסים') !== -1) {
      advice = 'המודלים החינמיים ב-OpenRouter מוגבלים בקצב ולעיתים כולם תפוסים ' +
        'באותו רגע. אין מה לתקן — כדאי לנסות שוב בעוד כמה דקות.';
    } else if (text.indexOf('429') !== -1) {
      advice = 'המודל עמוס כרגע. המערכת מנסה מודל אחר לבד; אם זה חוזר, ' +
        'שווה לנסות שוב בעוד כמה דקות.';
    } else if (text.indexOf('ריקה') !== -1) {
      advice = 'תשובה ריקה מגיעה בדרך כלל ממודל חינמי שעמוס כרגע, או שאינו ' +
        'קורא תמונות למרות שהוא מסומן כך. שווה לבחור מודל אחר ברשימה, ' +
        'או למחוק את המפתח הזה ולהמשיך עם אחד בלבד.';
    } else if (text.indexOf('אפס קלוריות') !== -1 || text.indexOf('שמישה') !== -1) {
      advice = 'חלק מהמודלים החינמיים ברשימה אינם מיועדים למזון כלל — ' +
        'למשל מודלים לקריאת מסמכים. המערכת מדלגת עליהם אוטומטית, ' +
        'אבל אם זה חוזר כדאי למחוק את מפתח OpenRouter ולהמשיך עם Gemini בלבד.';
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

    /** פירוט פריט: משקל, על סמך מה הוערך, וערכים ל-100 גרם */
    var itemRow = function (item) {
      var per = item.per100 || {};
      var per100 = Fmt.isNum(per.kcal)
        ? '<span class="per100">ל-100 גרם: ' + Fmt.n(per.kcal, 0) + ' קק״ל' +
          (Fmt.isNum(per.protein) ? ' · חלבון ' + Fmt.n(per.protein, 1) : '') +
          (Fmt.isNum(per.carbs) ? ' · פחמימות ' + Fmt.n(per.carbs, 1) : '') +
          (Fmt.isNum(per.fat) ? ' · שומן ' + Fmt.n(per.fat, 1) : '') +
          (Fmt.isNum(per.fiber) ? ' · סיבים ' + Fmt.n(per.fiber, 1) : '') +
          '</span>'
        : '';

      var macros = [];
      if (Fmt.isNum(item.protein)) macros.push('חלבון ' + Fmt.n(item.protein, 0));
      if (Fmt.isNum(item.carbs)) macros.push('פחמימות ' + Fmt.n(item.carbs, 0));
      if (Fmt.isNum(item.fat)) macros.push('שומן ' + Fmt.n(item.fat, 0));
      if (Fmt.isNum(item.saturated)) macros.push('רווי ' + Fmt.n(item.saturated, 1));
      if (Fmt.isNum(item.fiber)) macros.push('סיבים ' + Fmt.n(item.fiber, 1));

      return '<li><b>' + Fmt.esc(item.name) + '</b> — ' +
        (Fmt.isNum(item.grams) ? '<span class="num">' + Fmt.n(item.grams, 0) + ' גר׳</span>, ' : '') +
        '<span class="num">' + Fmt.n(item.kcal, 0) + ' קק״ל</span>' +
        (item.confidence === 'low' ? ' <span class="low">הערכה לא בטוחה</span>' : '') +
        (macros.length ? '<span class="macros num">' + Fmt.esc(macros.join(' · ')) + '</span>' : '') +
        (item.basis ? '<span class="basis-note">' + Fmt.esc(item.basis) + '</span>' : '') +
        per100 +
      '</li>';
    };

    var side = function (name, provider, data) {
      var items = ((data && data.items) || []).map(itemRow).join('');

      return '<details class="round"><summary>' + Fmt.esc(name) + ' · ' +
        Fmt.esc(provider) + ' — ' + Fmt.n(data.kcal, 0) + ' קק״ל' +
        (Fmt.isNum(data.grams) ? ' · ' + Fmt.n(data.grams, 0) + ' גר׳' : '') + '</summary>' +
        '<ul class="items">' + items + '</ul>' +
        (data.reasoning ? '<p class="why">' + Fmt.esc(data.reasoning) + '</p>' : '') +
        '</details>';
    };

    // איפה בדיוק הם נחלקו: אותו מאכל בכמויות שונות, ופריטים שרק
    // אחד מהם ראה
    var lines = [];

    (result.shared || []).forEach(function (item) {
      if (!Fmt.isNum(item.leanGrams) || !Fmt.isNum(item.richGrams)) return;
      if (Math.abs(item.leanGrams - item.richGrams) < 5) return;
      lines.push(item.name + ': ' + Fmt.n(item.leanGrams, 0) + ' מול ' +
        Fmt.n(item.richGrams, 0) + ' גרם');
    });

    var diff = result.differences;
    if (diff.onlyRich.length) lines.push('רק המחמיר ספר: ' + diff.onlyRich.join(', '));
    if (diff.onlyLean.length) lines.push('רק השמרן ספר: ' + diff.onlyLean.join(', '));

    var missed = lines.length
      ? '<p class="why"><b>במה נחלקו:</b> ' + Fmt.esc(lines.join(' · ')) + '</p>'
      : '';

    // כמה כל צד זז אחרי ששמע את השני
    // ספק שלא ענה — נאמר, וההערכה נמשכת
    var down = result.failure
      ? '<p class="why"><b>' + Fmt.esc(result.failure.provider) + ' לא ענה.</b> ' +
        Fmt.esc(result.failure.message) + '<br>' +
        'ההערכה נעשתה בין שני מודלים של ' + Fmt.esc(result.leanProvider) + '.</p>'
      : '';

    var quiet = '';
    if (result.skippedDebate === 'lean' || result.skippedDebate === 'rich') {
      var who = result.skippedDebate === 'lean' ? 'השמרן' : 'המחמיר';
      var model = result.skippedDebate === 'lean' ? result.leanModel : result.richModel;
      quiet = '<p class="why">' + Fmt.esc(who + ' רץ על מודל קטן (' + model +
        ') ולכן מסר הערכה בלבד, בלי להשתתף בוויכוח.') + '</p>';
    } else if (result.skippedDebate === 'both') {
      quiet = '<p class="why">שני המודלים קטנים, ולכן לא התקיים ויכוח.</p>';
    }

    var moved = '';
    if (result.movement) {
      var describe = function (name, delta) {
        if (!Fmt.isNum(delta) || Math.abs(delta) < 10) return name + ' לא זז';
        return name + ' ' + (delta > 0 ? 'העלה' : 'הוריד') + ' ב-' +
          Fmt.n(Math.abs(delta), 0);
      };
      moved = '<p class="why"><b>אחרי הוויכוח:</b> ' +
        Fmt.esc(describe('השמרן', result.movement.lean) + ' · ' +
          describe('המחמיר', result.movement.rich)) + '</p>';
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
          (Fmt.isNum(f.saturated) ? ' (רווי ' + Fmt.n(f.saturated, 1) + ')' : '') +
          (Fmt.isNum(f.fiber) ? ' · סיבים ' + Fmt.n(f.fiber, 1) : '') + '</div>' +
        (Fmt.isNum(f.grams)
          ? '<div class="verdict-macros num">משקל מוערך: ' + Fmt.n(f.grams, 0) + ' גרם' +
            (Fmt.isNum(f.kcal) && f.grams > 0
              ? ' · ' + Fmt.n((f.kcal / f.grams) * 100, 0) + ' קק״ל ל-100 גרם'
              : '') + '</div>'
          : '') +
        (v.agreement ? '<p class="why">' + Fmt.esc(v.agreement) + '</p>' : '') +
        range + missed + moved + down + quiet +
        (v.notes.length ? '<p class="why">' + Fmt.esc(v.notes.join(' ')) + '</p>' : '') +
        '<button type="button" class="btn btn--primary" id="apply-estimate">הזן לטופס</button>' +
      '</div>' +
      '<div class="rounds">' +
        side((result.firstRound ? 'שמרן — אחרי הוויכוח' : 'שמרן') +
          ' · ' + result.leanModel, result.leanProvider, result.lean) +
        side((result.firstRound ? 'מחמיר — אחרי הוויכוח' : 'מחמיר') +
          ' · ' + result.richModel, result.richProvider, result.rich) +
        (result.firstRound
          ? side('שמרן — הערכה ראשונה', result.leanProvider, result.firstRound.lean) +
            side('מחמיר — הערכה ראשונה', result.richProvider, result.firstRound.rich)
          : '') +
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
