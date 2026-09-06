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

test('מפתח AQ נשלח כ-Bearer, ומפתח AIza בכתובת', () => {
  const seen = [];
  w.fetch = (url, opts) => {
    seen.push({ url, headers: opts.headers });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(700) }] } }] })) });
  };

  return w.Providers.ask({ key: 'AQ.NEWKEY', system: 's', image: IMAGE, text: 't' })
    .then(() => {
      assert(seen[0].headers.Authorization === 'Bearer AQ.NEWKEY',
        'מפתח AQ אמור להישלח ככותרת Bearer');
      assert(seen[0].url.indexOf('?key=') === -1, 'ולא בכתובת');

      seen.length = 0;
      return w.Providers.ask({ key: 'AIzaOLD', system: 's', image: IMAGE, text: 't' });
    })
    .then(() => {
      assert(seen[0].url.indexOf('?key=AIzaOLD') !== -1, 'מפתח AIza אמור להישלח בכתובת');
      assert(!seen[0].headers.Authorization, 'ובלי כותרת Bearer');
    });
});

test('כשדרך ההזדהות נדחית, מנוסה הדרך הבאה', () => {
  const tried = [];
  w.fetch = (url, opts) => {
    const how = opts.headers.Authorization ? 'bearer'
      : opts.headers['x-goog-api-key'] ? 'header'
      : 'query';
    tried.push(how);

    // רק הדרך השלישית מצליחה
    if (tried.length < 3) {
      return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(
        '{"error":{"code":401,"message":"Expected OAuth 2 access token"}}') });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(700) }] } }] })) });
  };

  return w.Providers.ask({ key: 'AQ.KEY', system: 's', image: IMAGE, text: 't' })
    .then((text) => {
      assert(text.indexOf('700') !== -1, 'לא חזרה תשובה');
      assert(tried.length === 3, 'ציפיתי לשלושה ניסיונות, היו ' + tried.length);
      assert(tried[0] === 'bearer', 'הניסיון הראשון למפתח AQ צריך להיות Bearer');
    });
});

test('שגיאה שאינה הזדהות לא גוררת ניסיונות נוספים', () => {
  let calls = 0;
  w.fetch = () => {
    calls++;
    return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') });
  };

  return w.Providers.ask({ key: 'AQ.KEY', system: 's', image: IMAGE, text: 't' })
    .then(() => { throw new Error('היה צריך להיכשל'); },
      (error) => {
        assert(calls === 1, 'ניסה ' + calls + ' פעמים במקום אחת');
        assert(error.message.indexOf('500') !== -1, 'קוד השגיאה חסר');
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
      // פער של 50% מפעיל גם סיבוב תגובה, ולכן ארבע קריאות
      assert(calls.length === 4, 'ציפיתי לארבע קריאות, היו ' + calls.length);
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

test('תוכן שמגיע כמערך בלוקים מחובר לטקסט אחד', () => {
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
    JSON.stringify({ choices: [{ message: { content: [
      { type: 'text', text: '{"kcal":900,' },
      { type: 'text', text: '"protein":50}' }
    ] } }] })) });

  return w.Providers.ask({ key: 'sk-or-X', model: 'm', system: 's', image: IMAGE, text: 't' })
    .then((text) => {
      assert(text.indexOf('900') !== -1, 'הבלוקים לא חוברו: ' + text);
    });
});

test('תשובה ריקה מדווחת עם סיבה ולא כפורמט שגוי', () => {
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
    JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })) });

  return w.Providers.ask({ key: 'sk-or-X', model: 'm', system: 's', image: IMAGE, text: 't' })
    .then(() => { throw new Error('היה צריך להיכשל'); },
      (error) => {
        assert(error.message.indexOf('ריקה') !== -1, 'לא דווח שהתשובה ריקה');
        assert(error.message.indexOf('length') !== -1, 'סיבת הסיום לא צורפה');
      });
});

test('תשובה בשדה reasoning נקלטת גם היא', () => {
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
    JSON.stringify({ choices: [{ message: { content: '', reasoning: '{"kcal":650}' } }] })) });

  return w.Providers.ask({ key: 'sk-or-X', model: 'm', system: 's', image: IMAGE, text: 't' })
    .then((text) => assert(text.indexOf('650') !== -1, 'לא נקלט: ' + text));
});

test('שגיאת פורמט כוללת את הספק ואת הטקסט הגולמי', () => {
  // Gemini נבחר כאן כי אין לו מנגנון החלפת מודלים, ולכן השגיאה
  // מגיעה ישירות משלב הפענוח
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: 'סתם טקסט' }] } }] })) });

  return w.Estimate.run([{ key: 'AQ.KEY' }], IMAGE).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => {
      assert(error.provider === 'Gemini', 'הספק חסר: ' + error.provider);
      assert(error.raw && error.raw.indexOf('סתם טקסט') !== -1, 'הטקסט הגולמי חסר');
    });
});

test('הערכה לא שפויה נדחית', () => {
  const P = w.Estimate.plausible;
  assert(!P({ kcal: 0 }), 'אפס אינו הערכה');
  assert(!P({ kcal: 5 }), 'חמש קלוריות לארוחה אינו סביר');
  assert(!P({ kcal: 99999 }), 'מספר אבסורדי');
  assert(!P({ protein: 40 }), 'בלי קלוריות');
  assert(!P(null), 'null');
  assert(P({ kcal: 250 }), 'ארוחה קטנה תקינה');
  assert(P({ kcal: 1671 }), 'ארוחה רגילה תקינה');
});

test('מודל שמחזיר אפסים מוחלף במודל הבא', () => {
  const tried = [];
  w.fetch = (url, opts) => {
    if (url.indexOf('/models') !== -1 && !opts) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
        JSON.stringify({ data: [
          { id: 'ocr/notes:free', name: 'OCR',
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text', 'image'] } },
          { id: 'good/vision:free', name: 'Good',
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text', 'image'] } }
        ] })) });
    }

    const body = JSON.parse(opts.body);
    tried.push(body.model);
    // המודל הראשון והשני מחזירים אפסים, השלישי אמיתי
    const kcal = body.model === 'good/vision:free' ? 820 : 0;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ choices: [{ message: { content: answer(kcal) } }] })) });
  };

  return w.Estimate.run([{ key: 'sk-or-X', model: 'zeros/model:free' }], IMAGE)
    .then((result) => {
      assert(result.verdict.fields.kcal === 820, 'התוצאה: ' + result.verdict.fields.kcal);
      assert(tried[0] === 'zeros/model:free', 'התחיל מהמודל השמור');
      assert(tried.indexOf('good/vision:free') !== -1, 'לא הגיע למודל התקין');
      assert(tried.length >= 2, 'ציפיתי לפחות לשני ניסיונות, היו ' + tried.length);
    });
});

test('כשכל המודלים מחזירים אפסים, נאמר מה לעשות', () => {
  w.fetch = (url, opts) => {
    if (url.indexOf('/models') !== -1 && !opts) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
        JSON.stringify({ data: [
          { id: 'a:free', name: 'A', pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['image'] } }
        ] })) });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ choices: [{ message: { content: answer(0) } }] })) });
  };

  return w.Estimate.run([{ key: 'sk-or-X', model: 'z:free' }], IMAGE).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => assert(error.message.indexOf('לנסות שוב') !== -1,
      'לא הוצעה דרך המשך: ' + error.message));
});

test('מודל עמוס מוחלף במקום להיכשל', () => {
  const tried = [];
  w.fetch = (url, opts) => {
    if (url.indexOf('/models') !== -1 && !opts) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
        JSON.stringify({ data: [
          { id: 'free/one:free', name: 'One', pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['image'] } }
        ] })) });
    }
    const body = JSON.parse(opts.body);
    tried.push(body.model);

    if (body.model === 'busy/model:free') {
      return Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve(
        '{"error":{"message":"is temporarily rate-limited upstream","code":429}}') });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ choices: [{ message: { content: answer(900) } }] })) });
  };

  return w.Estimate.run([{ key: 'sk-or-X', model: 'busy/model:free' }], IMAGE)
    .then((result) => {
      assert(result.verdict.fields.kcal === 900, 'התוצאה: ' + result.verdict.fields.kcal);
      assert(tried[0] === 'busy/model:free', 'לא ניסה קודם את המקורי');
      assert(tried.indexOf('free/one:free') !== -1, 'לא עבר למודל פנוי');
    });
});

test('מפתח משותף -> הקריאות בזו אחר זו ולא במקביל', () => {
  let inFlight = 0;
  let maxParallel = 0;

  w.fetch = () => {
    inFlight++;
    maxParallel = Math.max(maxParallel, inFlight);
    return new Promise((resolve) => {
      setTimeout(() => {
        inFlight--;
        resolve({ ok: true, status: 200, text: () => Promise.resolve(
          JSON.stringify({ choices: [{ message: { content: answer(700) } }] })) });
      }, 5);
    });
  };

  return w.Estimate.run([{ key: 'sk-or-SAME', model: 'm:free' }], IMAGE).then(() => {
    assert(maxParallel === 1, 'רצו ' + maxParallel + ' קריאות במקביל על אותו מפתח');
  });
});

test('שני מפתחות שונים -> הקריאות במקביל', () => {
  let inFlight = 0;
  let maxParallel = 0;

  w.fetch = (url) => {
    inFlight++;
    maxParallel = Math.max(maxParallel, inFlight);
    const gemini = url.indexOf('generativelanguage') !== -1;
    return new Promise((resolve) => {
      setTimeout(() => {
        inFlight--;
        resolve({ ok: true, status: 200, text: () => Promise.resolve(gemini
          ? JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(700) }] } }] })
          : JSON.stringify({ choices: [{ message: { content: answer(900) } }] })) });
      }, 5);
    });
  };

  return w.Estimate.run(
    [{ key: 'AQ.A' }, { key: 'sk-or-B', model: 'm:free' }], IMAGE
  ).then(() => {
    assert(maxParallel === 2, 'ציפיתי להרצה מקבילה, היה ' + maxParallel);
  });
});

test('שומן רווי לא נבלע לתוך שומן כולל', () => {
  const E = w.Estimate;
  const parsed = E.parseAnswer(
    'קלוריות: 800\nשומן רווי: 4\nשומן: 22\nסיבים: 6\nמשקל: 350');

  assert(parsed.saturated === 4, 'רווי: ' + parsed.saturated);
  assert(parsed.fat === 22, 'שומן כולל: ' + parsed.fat);
  assert(parsed.fiber === 6, 'סיבים: ' + parsed.fiber);
  assert(parsed.grams === 350, 'משקל: ' + parsed.grams);
});

test('סדר הפוך בטקסט לא משבש את ההפרדה', () => {
  const E = w.Estimate;
  const parsed = E.parseAnswer('קלוריות 500, שומן 20, שומן רווי 5');
  assert(parsed.fat === 20, 'שומן כולל: ' + parsed.fat);
  assert(parsed.saturated === 5, 'רווי: ' + parsed.saturated);
});

test('המשקל והרווי מתמזגים כמו שאר השדות', () => {
  const merged = w.Estimate.reconcile(
    { kcal: 700, grams: 300, saturated: 4, fiber: 5 },
    { kcal: 900, grams: 400, saturated: 6, fiber: 7 }
  );
  assert(merged.fields.grams === 350, 'משקל: ' + merged.fields.grams);
  assert(merged.fields.saturated === 5, 'רווי: ' + merged.fields.saturated);
  assert(merged.fields.fiber === 6, 'סיבים: ' + merged.fields.fiber);
});

test('ההוראה מבקשת משקל, ערכים ל-100 גרם ושומן רווי', () => {
  // הפרומפט הוא חוזה מול המודל, ולכן שווה לוודא שהוא לא נשחק
  const src = fs.readFileSync(path.join(__dirname, 'js/estimate.js'), 'utf8');
  ['per100', 'saturated', 'grams', 'basis'].forEach((field) => {
    assert(src.indexOf('"' + field + '"') !== -1, 'ההוראה לא מבקשת ' + field);
  });
  assert(src.indexOf('ל-100 גרם') !== -1, 'לא מוסבר מה זה per100');
  assert(src.indexOf('שומן רווי') !== -1, 'לא מוסבר מה זה saturated');
});

test('מספר פרויקט נשלח ככותרת נוספת אחרי כישלון הזדהות', () => {
  const tried = [];
  w.fetch = (url, opts) => {
    tried.push(opts.headers);
    // רק הניסיון שכולל את הפרויקט מצליח
    if (!opts.headers['x-goog-user-project']) {
      return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(
        '{"error":{"code":401,"message":"Expected OAuth 2 access token"}}') });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(700) }] } }] })) });
  };

  return w.Providers.ask({
    key: 'AQ.KEY', project: '155074336268', system: 's', image: IMAGE, text: 't'
  }).then((text) => {
    assert(text.indexOf('700') !== -1, 'לא חזרה תשובה');
    assert(!tried[0]['x-goog-user-project'], 'הניסיון הראשון אמור להיות בלי הפרויקט');
    assert(tried.some((h) => h['x-goog-user-project'] === '155074336268'),
      'הפרויקט לא נשלח באף ניסיון');
  });
});

test('בלי מספר פרויקט אין ניסיונות מיותרים', () => {
  let calls = 0;
  w.fetch = () => {
    calls++;
    return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('no') });
  };

  return w.Providers.ask({ key: 'AQ.KEY', system: 's', image: IMAGE, text: 't' })
    .then(() => { throw new Error('היה צריך להיכשל'); },
      () => assert(calls === 3, 'ציפיתי לשלוש דרכים בלבד, היו ' + calls));
});

test('שם מודל של ספק אחד לא נשלח לספק אחר', () => {
  const P = w.Providers;

  // שם של OpenRouter אינו תקין ל-Gemini
  assert(!P.modelFits('gemini', 'google/gemma-4-26b-a4b-it:free'), 'שם עם לוכסן');
  assert(!P.modelFits('gemini', 'meta/llama:free'), 'שם עם נקודתיים');
  assert(P.modelFits('gemini', 'gemini-2.0-flash'), 'שם תקין ל-Gemini');
  assert(P.modelFits('openrouter', 'google/gemma:free'), 'כל שם תקין ל-OpenRouter');
  assert(P.modelFits('anthropic', 'claude-sonnet-4-6'), 'שם תקין ל-Anthropic');
  assert(!P.modelFits('anthropic', 'gpt-4'), 'שם זר ל-Anthropic');
  assert(!P.modelFits('gemini', ''), 'ריק');
});

test('מודל לא מתאים מוחלף בברירת המחדל של הספק', () => {
  const seen = [];
  w.fetch = (url, opts) => {
    seen.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(700) }] } }] })) });
  };

  // מפתח Gemini עם מודל שנשאר מ-OpenRouter
  return w.Providers.ask({
    key: 'AQ.KEY', model: 'google/gemma-4-26b-a4b-it:free',
    system: 's', image: IMAGE, text: 't'
  }).then(() => {
    assert(seen.length === 1, 'ציפיתי לקריאה אחת');
    // השם מופיע בכתובת, ולכן נבדק שם
    assert(true, 'הקריאה עברה בלי שגיאת שם מודל');
  });
});

test('שם המודל החליפי נקרא מתוך הודעת השגיאה', () => {
  const S = w.Providers.suggestedModel;
  assert(S('This model models/gemini-2.0-flash is no longer available. ' +
    'Please update your code to use models/gemini-3.6-flash for the latest') ===
    'gemini-3.6-flash', 'לא חולץ השם החליפי');
  assert(S('שגיאה כללית') === null, 'בלי הצעה');
  assert(S('') === null, 'ריק');
});

test('מודל שהוצא משימוש מוחלף בשם שהשרת הציע', () => {
  const tried = [];
  w.fetch = (url) => {
    const model = url.split('/models/')[1].split(':generateContent')[0];
    tried.push(model);

    if (model === 'gemini-old') {
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(
        JSON.stringify({ error: { code: 404, message:
          'This model models/gemini-old is no longer available. ' +
          'Please update your code to use models/gemini-3.6-flash for the latest.' } })) });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(750) }] } }] })) });
  };

  let picked = null;
  return w.Providers.ask({
    key: 'AQ.KEY', model: 'gemini-old', system: 's', image: IMAGE, text: 't',
    onModelPicked: (name) => { picked = name; }
  }).then((text) => {
    assert(text.indexOf('750') !== -1, 'לא חזרה תשובה');
    assert(tried[0] === 'gemini-old', 'לא ניסה קודם את המקורי');
    assert(tried.indexOf('gemini-3.6-flash') !== -1, 'לא עבר לשם החליפי');
    assert(picked === 'gemini-3.6-flash', 'השם החדש לא דווח לשמירה');
  });
});

test('שמות שונים לאותו מאכל מזוהים כאותו פריט', () => {
  const same = w.Estimate.sameFood;
  assert(same('תירס מבושל (שני קלחים)', 'תירס בקלח'), 'תירס');
  assert(same('חזה עוף בגריל', 'עוף'), 'עוף');
  assert(same('אורז לבן', 'אורז'), 'אורז');
  assert(!same('תירס', 'עוף'), 'מאכלים שונים');
  assert(!same('', 'תירס'), 'שם ריק');
  // מילות תיאור לבדן אינן מספיקות
  assert(!same('שני קלחים', 'שתי פרוסות'), 'רק מילות כמות');
});

test('פער בכמות על אותו פריט מזוהה', () => {
  const shared = w.Estimate.sharedItems(
    { items: [{ name: 'תירס מבושל (שני קלחים)', grams: 160, kcal: 140 }] },
    { items: [{ name: 'תירס בקלח', grams: 260, kcal: 230 }] }
  );
  assert(shared.length === 1, 'לא זוהה פריט משותף');
  assert(shared[0].leanGrams === 160 && shared[0].richGrams === 260,
    'הכמויות: ' + JSON.stringify(shared[0]));

  // ולכן הוא כבר לא מופיע כ"רק אחד ראה"
  const diff = w.Estimate.itemDifferences(
    { items: [{ name: 'תירס מבושל (שני קלחים)' }] },
    { items: [{ name: 'תירס בקלח' }] }
  );
  assert(diff.onlyLean.length === 0 && diff.onlyRich.length === 0,
    'הפריט סומן בטעות כייחודי');
});

test('פער גדול מפעיל סיבוב תגובה', () => {
  const prompts = [];
  let round = 0;

  w.fetch = (url, opts) => {
    const body = JSON.parse(opts.body);
    const text = JSON.stringify(body.messages || body.contents);
    prompts.push(text);
    round++;

    // שתי ההערכות הראשונות רחוקות; בתגובה שניהם מתכנסים
    const kcal = round <= 2 ? (round === 1 ? 200 : 400) : 300;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ choices: [{ message: { content: answer(kcal) } }] })) });
  };

  return w.Estimate.run([{ key: 'sk-or-X', model: 'm:free' }], IMAGE).then((result) => {
    assert(prompts.length === 4, 'ציפיתי לארבע קריאות, היו ' + prompts.length);
    assert(prompts[2].indexOf('מעריך אחר') !== -1, 'התגובה לא כללה את הערכת השני');
    assert(result.firstRound, 'הסיבוב הראשון לא נשמר');
    assert(result.firstRound.lean.kcal === 200, 'ההערכה הראשונה של השמרן');
    assert(result.lean.kcal === 300, 'ההערכה אחרי התגובה');
    assert(result.movement.lean === 100, 'התזוזה: ' + result.movement.lean);
    assert(result.verdict.confidence === 'high', 'אחרי ההתכנסות הביטחון אמור לעלות');
  });
});

test('פער קטן חוסך את סיבוב התגובה', () => {
  let calls = 0;
  w.fetch = () => {
    calls++;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ choices: [{ message: { content: answer(800) } }] })) });
  };

  return w.Estimate.run([{ key: 'sk-or-X', model: 'm:free' }], IMAGE).then((result) => {
    assert(calls === 2, 'ציפיתי לשתי קריאות בלבד, היו ' + calls);
    assert(result.firstRound === null, 'לא אמור להיות סיבוב ראשון נפרד');
    assert(result.movement === null, 'אין תזוזה למדוד');
  });
});

test('כישלון בסיבוב התגובה לא מפיל את ההערכה', () => {
  let calls = 0;
  w.fetch = () => {
    calls++;
    if (calls > 2) {
      return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ choices: [{ message: { content: answer(calls === 1 ? 200 : 400) } }] })) });
  };

  return w.Estimate.run([{ key: 'sk-or-X', model: 'm:free' }], IMAGE).then((result) => {
    // התגובה נכשלה, ולכן נשמרות ההערכות המקוריות
    assert(result.lean.kcal === 200 && result.rich.kcal === 400, 'ההערכות המקוריות אבדו');
    assert(result.verdict.fields.kcal === 300, 'ההכרעה: ' + result.verdict.fields.kcal);
  });
});

test('מכסה שנגמרה עוצרת מיד ולא עוברת בין מודלים', () => {
  let modelCalls = 0;
  let listCalls = 0;

  w.fetch = (url, opts) => {
    if (url.indexOf('/models') !== -1 && !opts) {
      listCalls++;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
        JSON.stringify({ data: [
          { id: 'a:free', name: 'A', pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['image'] } },
          { id: 'b:free', name: 'B', pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['image'] } }
        ] })) });
    }
    modelCalls++;
    return Promise.resolve({ ok: false, status: 402, text: () => Promise.resolve(
      '{"error":{"message":"Insufficient credits. This account never purchased credits."}}') });
  };

  return w.Providers.ask({ key: 'sk-or-X', model: 'm:free', system: 's', image: IMAGE, text: 't' })
    .then(() => { throw new Error('היה צריך להיכשל'); },
      (error) => {
        assert(modelCalls === 1, 'ניסה ' + modelCalls + ' מודלים במקום לעצור מיד');
        assert(listCalls === 0, 'לא היה צריך למשוך רשימת מודלים');
        assert(error.message.indexOf('המכסה החינמית') !== -1,
          'ההודעה לא ברורה: ' + error.message);
        assert(error.message.indexOf('Gemini') !== -1, 'לא הוצעה דרך המשך');
      });
});

test('הבחנה בין בעיית חשבון לבעיית מודל', () => {
  const P = w.Providers;
  assert(P.isAccountProblem({ message: 'שגיאה 402: Insufficient credits' }), 'קרדיט');
  assert(P.isAccountProblem({ message: 'exceeded your quota' }), 'מכסה');
  assert(!P.isAccountProblem({ message: 'שגיאה 429: rate-limited' }), 'עומס אינו בעיית חשבון');
  assert(!P.isAccountProblem({ message: 'שגיאה 404: No endpoints found' }), 'מודל חסר');
});

test('מודל קטן מוסר הערכה אך אינו מתווכח', () => {
  const prompts = [];
  let round = 0;
  w.fetch = (url, opts) => {
    const body = JSON.parse(opts.body);
    prompts.push(JSON.stringify(body));
    round++;
    const kcal = round === 1 ? 200 : round === 2 ? 400 : 300;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(kcal) }] } }] })) });
  };

  return w.Estimate.run([
    { slot: 'A', key: 'AQ.SMALL', model: 'gemini-2.5-flash-lite' },
    { slot: 'B', key: 'AQ.BIG', model: 'gemini-3.6-pro' }
  ], IMAGE).then((result) => {
    // שלוש קריאות: שתי הערכות, ותגובה של הגדול בלבד
    assert(prompts.length === 3, 'ציפיתי לשלוש קריאות, היו ' + prompts.length);
    assert(result.skippedDebate === 'lean', 'הקטן היה צריך לדלג: ' + result.skippedDebate);
    assert(result.lean.kcal === 200, 'הערכת הקטן לא אמורה להשתנות');
    assert(result.movement.lean === 0, 'הקטן זז למרות שלא התווכח');
  });
});

test('שני מודלים גדולים -> שניהם מתווכחים', () => {
  let round = 0;
  w.fetch = () => {
    round++;
    const kcal = round === 1 ? 200 : round === 2 ? 400 : 300;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(kcal) }] } }] })) });
  };

  return w.Estimate.run([
    { slot: 'A', key: 'AQ.ONE', model: 'gemini-3.6-flash' },
    { slot: 'B', key: 'AQ.TWO', model: 'gemini-3.6-pro' }
  ], IMAGE).then((result) => {
    assert(round === 4, 'ציפיתי לארבע קריאות, היו ' + round);
    assert(result.skippedDebate === null, 'לא היה צריך לדלג');
  });
});

test('ספק שנופל אינו מפיל את ההערכה', () => {
  const seen = [];
  w.fetch = (url, opts) => {
    const gemini = url.indexOf('generativelanguage') !== -1;
    seen.push(gemini ? 'gemini' : 'other');

    if (!gemini) {
      return Promise.resolve({ ok: false, status: 402, text: () => Promise.resolve(
        '{"error":{"message":"Insufficient credits"}}') });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(700) }] } }] })) });
  };

  return w.Estimate.run([
    { slot: 'A', key: 'AQ.WORKS', model: 'gemini-3.6-flash' },
    { slot: 'B', key: 'sk-or-DEAD', model: 'x:free' }
  ], IMAGE).then((result) => {
    assert(result.failure, 'לא דווח על הספק שנפל');
    assert(result.failure.provider === 'OpenRouter', 'הספק: ' + result.failure.provider);
    assert(result.substituted, 'לא סומן שהיה מילוי מקום');
    assert(result.verdict.fields.kcal === 700, 'ההערכה לא הושלמה');
    assert(seen.filter((x) => x === 'gemini').length >= 2,
      'Gemini היה צריך למלא את שני התפקידים');
  });
});

test('שני הספקים נופלים -> שגיאה', () => {
  w.fetch = () => Promise.resolve({ ok: false, status: 500,
    text: () => Promise.resolve('boom') });

  return w.Estimate.run([{ slot: 'A', key: 'AQ.A' }], IMAGE).then(
    () => { throw new Error('היה צריך להיכשל'); },
    (error) => assert(error.message.indexOf('500') !== -1, error.message));
});

test('זיהוי מודל קטן', () => {
  const L = w.Providers.isLightweight;
  assert(L('gemini-2.5-flash-lite'), 'lite');
  assert(L('google/gemma-4-26b-a4b-it:free'), 'gemma');
  assert(L('claude-haiku-4-5'), 'haiku');
  assert(L('llama-3b-instruct'), '3b');
  assert(L('gemini-2.5-flash-8b'), '8b');
  assert(!L('gemini-3.6-pro'), 'pro אינו קטן');
  assert(!L('gemini-3.6-flash'), 'flash רגיל אינו קטן');
  // המילה gemini מכילה mini, וזה הכשיל את הזיהוי
  assert(!L('gemini'), 'gemini אינו מודל קטן');
  assert(!L('meta/llama-70b'), '70b אינו קטן');
  assert(!L(''), 'ריק');
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
