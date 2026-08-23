/**
 * בונה גרסת קובץ־אחד: מטמיע את ה-CSS ואת כל קבצי ה-JS לתוך index.html.
 * התוצאה: dist/metrics-lab.html — קובץ בודד שאפשר לפתוח מכל מקום,
 * גם בלי שרת וגם בלי לשמור על מבנה תיקיות.
 *
 * הרצה:  node build/inline.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');


// --seed=<file>  מטמיע נתוני פתיחה שייטענו רק בהרצה הראשונה
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const outName = seedArg ? 'metrics-lab-with-data.html' : 'metrics-lab.html';

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// CSS
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (match, href) => {
  const css = fs.readFileSync(path.join(ROOT, href), 'utf8');
  return '<style>\n' + css + '\n  </style>';
});

// JS — סדר הטעינה נשמר כפי שהוא ב-index.html
let count = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, (match, src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  count++;
  return '<script>\n/* ' + src + ' */\n' + code + '\n  </script>';
});

if (seedArg) {
  const seedPath = path.resolve(seedArg.slice('--seed='.length));
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  html = html.replace('<!-- שכבת הלוגיקה',
    '<script>window.METRICS_SEED = ' + JSON.stringify(seed) + ';</script>\n\n  <!-- שכבת הלוגיקה');
  count++;
}

html = html.replace('<title>מדדים</title>',
  '<title>מדדים</title>\n  <!-- קובץ בנוי. המקור: ' + count + ' קבצי מקור, ראה README -->');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, outName), html, 'utf8');

console.log('נבנה: dist/' + outName + '  (' + Math.round(html.length / 1024) + ' KB, ' + count + ' סקריפטים הוטמעו)');
