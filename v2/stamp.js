/**
 * מטביע את מספר הגרסה בכתובות הקבצים של v2.
 *
 * בלי זה הדפדפן ממשיך להגיש את js/dash.js הישן מהמטמון, כי הכתובת
 * לא השתנתה — וזה נראה בדיוק כמו תיקון שלא עבד. הגרסה נלקחת מקבוע
 * BUILD ב-app.js, כדי שיהיה מקור אמת אחד.
 *
 * הרצה:  node v2/stamp.js
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const INDEX = path.join(DIR, 'index.html');
const APP = path.join(DIR, 'js', 'app.js');

const match = fs.readFileSync(APP, 'utf8').match(/BUILD:\s*'([^']+)'/);
if (!match) {
  console.error('לא נמצא קבוע BUILD ב-v2/js/app.js');
  process.exit(1);
}
const version = match[1];

let html = fs.readFileSync(INDEX, 'utf8');
let count = 0;

// כולל את הקבצים המשותפים מ-../js, שגם הם משתנים
html = html.replace(/(src|href)="((?:\.\.\/)?(?:js|assets)\/[^"?]+)(\?v=[^"]*)?"/g,
  (whole, attr, file) => {
    count++;
    return `${attr}="${file}?v=${version}"`;
  });

fs.writeFileSync(INDEX, html, 'utf8');
console.log(`חותמת ${version} הוטבעה ב-${count} קבצים ב-v2`);
