/**
 * מוסיף חותמת גרסה לכתובות של קבצי ה-JS וה-CSS ב-index.html.
 *
 * למה זה נחוץ: הדפדפן מחזיק במטמון את js/app.js לפי הכתובת שלו.
 * כשהתוכן משתנה אבל הכתובת נשארה, הוא ממשיך להגיש את הגרסה הישנה —
 * המשתמש רואה מסך ישן ומדווח שהתיקון לא הגיע. הוספת ?v=<גרסה>
 * משנה את הכתובת בכל בנייה, ולכן המטמון נפסל אוטומטית.
 *
 * הגרסה נלקחת מקבוע BUILD ב-app.js, כדי שיהיה מקור אמת אחד.
 *
 * הרצה:  node build/stamp.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const APP = path.join(ROOT, 'js', 'app.js');

const match = fs.readFileSync(APP, 'utf8').match(/BUILD:\s*'([^']+)'/);
if (!match) {
  console.error('לא נמצא קבוע BUILD ב-js/app.js');
  process.exit(1);
}
const version = match[1];

let html = fs.readFileSync(INDEX, 'utf8');
let count = 0;

// רק קבצים מקומיים. כתובות חיצוניות, כמו הפונטים, נשארות כמו שהן.
html = html.replace(/(src|href)="((?:js|assets)\/[^"?]+)(\?v=[^"]*)?"/g, (m, attr, file) => {
  count++;
  return `${attr}="${file}?v=${version}"`;
});

fs.writeFileSync(INDEX, html, 'utf8');
console.log(`חותמת ${version} הוטבעה ב-${count} קבצים`);
