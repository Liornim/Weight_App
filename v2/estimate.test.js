/**
 * בדיקות להערכה בוויכוח, עם שרתים מדומים במקום ה-API.
 * מכסות שלושה דברים: שהבקשה נבנית נכון לכל ספק, שההכרעה מתנהגת
 * לפי הפער בין המעריכים, ושמקור הפער מזוהה.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<div></div>', { url: 'https://x.local/' });
const w = dom.window;

['js/providers.js', 'js/estimate.js'].forEach((file) => {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  new Function('window', 'globalThis', src)(w, w);
});

let passed = 0;
const failures = [];

// הבדיקות חולקות fetch מדומה אחד, ולכן הן חייבות לרוץ בטור.
// הרצה במקביל גרמה לכך ששרת של בדיקה אחת ענה לבדיקה אחרת.
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

function runAll() {
  return queue.reduce(function (chain, item) {
    return chain.then(function () {
      return Promise.resolve()
        .then(item.fn)
        .then(() => { passed++; },
          (error) => failures.push({ name: item.name, message: error.message }));
    });
  }, Promise.resolve());
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

const answer = (kcal) => JSON.stringify({
  kcal, protein: kcal * 0.03, carbs: kcal * 0.05, fat: kcal * 0.02, fiber: 8,
  items: [{ name: 'עוף', grams: 180, kcal: kcal * 0.5, confidence: 'medium' }],
  reasoning: 'נימוק'
});

function stub(handler) {
  const calls = [];
  w.fetch = (url, opts) => {
    // משיכת רשימת המודלים היא GET ואין לה גוף
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, headers: opts && opts.headers, body });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(handler(url, body))
    });
  };
  return calls;
}

const IMAGE = { base64: 'BASE64DATA', mediaType: 'image/jpeg' };

// ---------------------------------------------------------------

test('זיהוי הספק לפי צורת המפתח', () => {
    const P = w.Providers;
    assert(P.detect('AIzaSyABC') === 'gemini', 'Gemini בפורמט הישן');
    assert(P.detect('AQ.Ab8RN6Ky_hPxp0') === 'gemini', 'Gemini בפורמט החדש');
    assert(P.detect('sk-or-v1-abc') === 'openrouter', 'OpenRouter');
    assert(P.detect('sk-ant-abc') === 'anthropic', 'Anthropic');
    assert(P.detect('משהו אחר') === null, 'לא מזוהה');
    assert(P.detect('') === null, 'ריק');
    assert(P.label('AIzaX') === 'Gemini', 'תווית');
  });

test('הבקשה ל-Gemini נבנית בפורמט שלה', () => {
    const calls = stub(() => JSON.stringify({
      candidates: [{ content: { parts: [{ text: answer(700) }] } }]
    }));

    return w.Providers.ask({
      key: 'AIzaTEST', system: 'הוראה', image: IMAGE, text: 'הערך'
    }).then((text) => {
      assert(text.indexOf('700') !== -1, 'התשובה לא חולצה');
      assert(calls[0].url.indexOf('generativelanguage') !== -1, 'כתובת שגויה');
      assert(calls[0].url.indexOf('AIzaTEST') !== -1, 'המפתח לא נשלח');
      const parts = calls[0].body.contents[0].parts;
      assert(parts[0].inline_data.data === 'BASE64DATA', 'התמונה לא נשלחה');
      assert(calls[0].body.systemInstruction.parts[0].text === 'הוראה', 'ההוראה לא נשלחה');
    });
  });

test('הבקשה ל-OpenRouter נבנית בפורמט שלה', () => {
    const calls = stub(() => JSON.stringify({
      choices: [{ message: { content: answer(900) } }]
    }));

    return w.Providers.ask({
      key: 'sk-or-TEST', model: 'some/model:free', system: 'הוראה', image: IMAGE, text: 'הערך'
    }).then((text) => {
      assert(text.indexOf('900') !== -1, 'התשובה לא חולצה');
      assert(calls[0].headers.Authorization === 'Bearer sk-or-TEST', 'הכותרת שגויה');
      assert(calls[0].body.model === 'some/model:free', 'המודל לא הועבר');
      const content = calls[0].body.messages[1].content;
      assert(content[0].image_url.url.indexOf('BASE64DATA') !== -1, 'התמונה לא נשלחה');
    });
  });

test('שגיאת שרת מוחזרת עם הסבר', () => {
    w.fetch = () => Promise.resolve({
      ok: false, status: 429, text: () => Promise.resolve('rate limit')
    });
    return w.Providers.ask({ key: 'AIzaX', system: 's', image: IMAGE, text: 't' })
      .then(() => { throw new Error('היה צריך להיכשל'); },
        (error) => {
          assert(error.message.indexOf('429') !== -1, 'קוד השגיאה חסר: ' + error.message);
          assert(error.message.indexOf('rate limit') !== -1, 'גוף השגיאה חסר');
        });
  });

test('שני ספקים -> ויכוח בין משפחות שונות', () => {
    const calls = stub((url) => url.indexOf('generativelanguage') !== -1
      ? JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(600) }] } }] })
      : JSON.stringify({ choices: [{ message: { content: answer(1000) } }] }));

    return w.Estimate.run(
      [{ key: 'AIzaA' }, { key: 'sk-or-B', model: 'm:free' }], IMAGE
    ).then((result) => {
      assert(calls.length === 2, 'ציפיתי לשתי קריאות, היו ' + calls.length);
      assert(!result.sameProvider, 'אמורים להיות שני ספקים');
      assert(result.leanProvider === 'Gemini' && result.richProvider === 'OpenRouter',
        'הספקים: ' + result.leanProvider + ' / ' + result.richProvider);
      assert(result.verdict.fields.kcal === 800, 'ההכרעה: ' + result.verdict.fields.kcal);
      assert(result.verdict.confidence === 'low', 'פער של 50% אמור להוריד ביטחון');

      // ההטיות מנוגדות: השמרן קיבל הוראה אחרת מהמחמיר
      const systems = calls.map((c) => JSON.stringify(c.body));
      assert(systems[0].indexOf('בחר בנמוכה') !== -1, 'השמרן לא קיבל את ההטיה שלו');
      assert(systems[1].indexOf('בחר בגבוהה') !== -1, 'המחמיר לא קיבל את ההטיה שלו');
    });
  });

test('מפתח אחד -> אותו ספק בשתי עמדות', () => {
    const calls = stub(() => JSON.stringify({
      candidates: [{ content: { parts: [{ text: answer(750) }] } }]
    }));

    return w.Estimate.run([{ key: 'AIzaONLY' }], IMAGE).then((result) => {
      assert(calls.length === 2, 'עדיין שתי קריאות');
      assert(result.sameProvider, 'אמור להיות מסומן כאותו ספק');
      assert(result.verdict.confidence === 'high', 'אותו מספר -> הסכמה מלאה');
    });
  });

test('בלי מפתח בכלל -> שגיאה ברורה', () => {
    return w.Estimate.run([], IMAGE).then(
      () => { throw new Error('היה צריך להיכשל'); },
      (error) => assert(error.message.indexOf('מפתח') !== -1, error.message)
    );
  });

test('ההכרעה משתנה לפי גודל הפער', () => {
    const R = w.Estimate.reconcile;

    const close = R({ kcal: 800, protein: 40 }, { kcal: 850, protein: 44 });
    assert(close.confidence === 'high', 'פער של 6% -> ביטחון גבוה');
    assert(close.fields.kcal === 825, 'ממוצע: ' + close.fields.kcal);
    assert(close.fields.protein === 42, 'גם המאקרו ממוצע');

    const mid = R({ kcal: 800 }, { kcal: 1000 });
    assert(mid.confidence === 'medium', 'פער של 22% -> בינוני');

    const far = R({ kcal: 700 }, { kcal: 1400 });
    assert(far.confidence === 'low', 'פער של 67% -> נמוך');
    assert(far.notes.length > 0, 'אמורה להיות הערה');
    assert(far.range.low === 700 && far.range.high === 1400, 'הטווח');
  });

test('שדה שחסר אצל אחד נלקח מהשני', () => {
    const r = w.Estimate.reconcile({ kcal: 800, fiber: 10 }, { kcal: 900 });
    assert(r.fields.fiber === 10, 'הסיבים: ' + r.fields.fiber);
    assert(r.fields.kcal === 850, 'הקלוריות עדיין ממוצע');
  });

test('פריט שרק אחד ראה מזוהה', () => {
    const diff = w.Estimate.itemDifferences(
      { items: [{ name: 'עוף' }, { name: 'אורז' }] },
      { items: [{ name: 'עוף' }, { name: 'אורז' }, { name: 'שמן זית' }] }
    );
    assert(diff.onlyRich.length === 1 && diff.onlyRich[0] === 'שמן זית',
      'רק המחמיר ראה שמן: ' + JSON.stringify(diff));
    assert(diff.onlyLean.length === 0, 'לשמרן אין פריט ייחודי');
  });

test('אפשר לבחור ספק ידנית כשהמפתח לא מזוהה', () => {
    const P = w.Providers;
    assert(P.detect('xyz-unknown-format') === null, 'מפתח בצורה לא מוכרת');
    assert(P.detect('xyz-unknown-format', 'gemini') === 'gemini', 'העקיפה לא נלקחה');
    assert(P.label('xyz-unknown-format', 'gemini') === 'Gemini', 'התווית');
    assert(P.detect('AIzaX', 'openrouter') === 'openrouter', 'העקיפה גוברת על הזיהוי');

    const list = P.options();
    assert(list.length === 3, 'שלושה ספקים');
    assert(list.some((o) => o.value === 'gemini' && o.free), 'Gemini מסומן כחינמי');
  });

test('בקשה עם ספק שנבחר ידנית מגיעה לכתובת הנכונה', () => {
    const calls = stub(() => JSON.stringify({
      candidates: [{ content: { parts: [{ text: answer(700) }] } }]
    }));

    return w.Providers.ask({
      key: 'unknown-format-key', provider: 'gemini', system: 's', image: IMAGE, text: 't'
    }).then(() => {
      assert(calls[0].url.indexOf('generativelanguage') !== -1,
        'לא פנה ל-Gemini: ' + calls[0].url);
    });
  });

test('מפתח לא מזוהה ובלי בחירה -> שגיאה מנחה', () => {
    return w.Providers.ask({ key: 'totally-unknown', system: 's', image: IMAGE, text: 't' })
      .then(() => { throw new Error('היה צריך להיכשל'); },
        (error) => assert(error.message.indexOf('ידנית') !== -1,
          'השגיאה לא מנחה מה לעשות: ' + error.message));
  });

test('רשימת המודלים מסננת לחינמיים שקוראים תמונות', () => {
    stub(() => JSON.stringify({ data: [
      { id: 'a/vision:free', name: 'Vision Free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text', 'image'] } },
      { id: 'b/text:free', name: 'Text Free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'] } },
      { id: 'c/vision-paid', name: 'Vision Paid',
        pricing: { prompt: '0.0001', completion: '0.0002' },
        architecture: { input_modalities: ['text', 'image'] } },
      { id: 'd/another:free', name: 'Another Free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['image', 'text'] } }
    ] }));

    return w.Providers.freeVisionModels().then((models) => {
      assert(models.length === 2, 'ציפיתי לשניים, קיבלתי ' + models.length);
      const ids = models.map((m) => m.id);
      assert(ids.indexOf('a/vision:free') !== -1, 'חסר המודל החינמי עם תמונות');
      assert(ids.indexOf('d/another:free') !== -1, 'חסר המודל השני');
      assert(ids.indexOf('b/text:free') === -1, 'מודל בלי תמונות נכנס');
      assert(ids.indexOf('c/vision-paid') === -1, 'מודל בתשלום נכנס');
      // ממוין לפי שם, כדי שהרשימה תהיה יציבה
      assert(models[0].name === 'Another Free', 'לא ממוין: ' + models[0].name);
    });
  });

test('רשימה ריקה או שגיאה מדווחות ולא קורסות', () => {
    stub(() => JSON.stringify({ data: [] }));
    return w.Providers.freeVisionModels().then((models) => {
      assert(models.length === 0, 'רשימה ריקה');

      w.fetch = () => Promise.resolve({
        ok: false, status: 500, text: () => Promise.resolve('boom')
      });
      return w.Providers.freeVisionModels().then(
        () => { throw new Error('היה צריך להיכשל'); },
        (error) => assert(error.message.indexOf('500') !== -1, error.message)
      );
    });
  });

test('מודל שאינו זמין מוחלף אוטומטית באחר', () => {
    const seen = [];
    w.fetch = (url, opts) => {
      if (url.indexOf('/models') !== -1 && !opts) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
          JSON.stringify({ data: [
            { id: 'works/vision:free', name: 'Works',
              pricing: { prompt: '0', completion: '0' },
              architecture: { input_modalities: ['text', 'image'] } }
          ] })) });
      }
      const body = JSON.parse(opts.body);
      seen.push(body.model);
      if (body.model === 'gone/model:free') {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(
          '{"error":{"message":"No endpoints found for gone/model:free.","code":404}}') });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
        JSON.stringify({ choices: [{ message: { content: answer(800) } }] })) });
    };

    let chosen = null;
    return w.Providers.ask({
      key: 'sk-or-X', model: 'gone/model:free', system: 's', image: IMAGE, text: 't',
      onModelPicked: (name) => { chosen = name; }
    }).then((text) => {
      assert(text.indexOf('800') !== -1, 'לא חזרה תשובה');
      assert(seen[0] === 'gone/model:free', 'לא ניסה קודם את המקורי');
      assert(seen[1] === 'works/vision:free', 'לא עבר לחלופה: ' + seen[1]);
      assert(chosen === 'works/vision:free', 'המודל שנבחר לא דווח');
    });
  });

test('כשאין חלופה זמינה, השגיאה מסבירה מה לעשות', () => {
    w.fetch = (url, opts) => {
      if (url.indexOf('/models') !== -1 && !opts) {
        return Promise.resolve({ ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({ data: [] })) });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(
        '{"error":{"message":"No endpoints found","code":404}}') });
    };

    return w.Providers.ask({
      key: 'sk-or-X', model: 'gone:free', system: 's', image: IMAGE, text: 't'
    }).then(() => { throw new Error('היה צריך להיכשל'); },
      (error) => {
        assert(error.message.indexOf('מפתח אחד') !== -1,
          'השגיאה לא מציעה דרך המשך: ' + error.message);
      });
  });

test('שגיאה שאינה מודל חסר לא גוררת חיפוש חלופה', () => {
    let modelListCalls = 0;
    w.fetch = (url, opts) => {
      if (url.indexOf('/models') !== -1 && !opts) { modelListCalls++; }
      return Promise.resolve({ ok: false, status: 401,
        text: () => Promise.resolve('invalid key') });
    };

    return w.Providers.ask({
      key: 'sk-or-X', model: 'm:free', system: 's', image: IMAGE, text: 't'
    }).then(() => { throw new Error('היה צריך להיכשל'); },
      (error) => {
        assert(error.message.indexOf('401') !== -1, 'קוד השגיאה חסר');
        assert(modelListCalls === 0, 'לא היה צריך למשוך רשימת מודלים');
      });
  });

test('פענוח תשובה עמיד לעטיפות', () => {
    const E = w.Estimate;
    assert(E.parseAnswer('```json\n{"kcal":700}\n```').kcal === 700, 'סימני קוד');
    assert(E.parseAnswer('הנה:\n{"kcal":700}\nבהצלחה').kcal === 700, 'טקסט מסביב');
    assert(E.parseAnswer('בלי JSON') === null, 'בלי JSON');
    assert(E.parseAnswer('') === null, 'ריק');
    assert(E.parseAnswer('{"broken":') === null, 'שבור');
});

runAll().then(() => {
  console.log('');
  failures.forEach((f) => { console.log('\u2717 ' + f.name); console.log('   ' + f.message); });
  console.log('\n' + passed + ' עברו, ' + failures.length + ' נכשלו\n');
  process.exit(failures.length ? 1 : 0);
});
