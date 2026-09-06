/**
 * בדיקת הוויכוח עצמו, עם שרת מדומה במקום ה-API.
 * מוודאת שהתמונה נשלחת בכל קריאה, שכל צד רואה את הערכת השני,
 * ושההכרעה היא זו שנלקחת בסוף.
 */
// בדיקה שהוויכוח עצמו מתנהל נכון, עם שרת מדומה במקום ה-API
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div></div>',{url:'https://x.local/'});
const w=dom.window;
// הקובץ נטען לתוך ההקשר של החלון כדי ש-fetch המדומה ייתפס
w.eval(fs.readFileSync(path.join(__dirname,'js/estimate.js'),'utf8'));
if(!w.Estimate){ // חלק מהסביבות מריצות eval בהקשר אחר
  const src=fs.readFileSync(path.join(__dirname,'js/estimate.js'),'utf8');
  new Function('window','globalThis',src+'\n;window.Estimate=window.Estimate||Estimate;')(w,w);
}

let calls=[];
w.fetch=(url,opts)=>{
  const body=JSON.parse(opts.body);
  calls.push(body);
  const isJudge=/הכרע/.test(body.system||'');
  const lean=/בחר בנמוכה/.test(body.system||'');
  const kcal=isJudge?800:(lean?600:1000);
  const answer={kcal,protein:50,carbs:60,fat:30,fiber:8,items:[{name:'עוף',grams:180,kcal:kcal*0.5,confidence:'medium'}],reasoning:'נימוק'};
  if(isJudge){answer.range={low:700,high:900};answer.verdict='הכרעה';}
  return Promise.resolve({ok:true,json:()=>Promise.resolve({content:[{type:'text',text:'```json\n'+JSON.stringify(answer)+'\n```'}]})});
};

const stages=[];
w.Estimate.debate('k','BASE64','image/jpeg',m=>stages.push(m)).then(r=>{
  const fail=[];
  if(calls.length!==5)fail.push('ציפיתי ל-5 קריאות (2 פתיחה, 2 תגובה, הכרעה), היו '+calls.length);
  if(r.rounds.length!==5)fail.push('ציפיתי ל-5 סיבובים, היו '+r.rounds.length);
  if(r.final.kcal!==800)fail.push('ההכרעה לא נלקחה');
  if(Math.abs(r.initialGap-400)>1)fail.push('הפער ההתחלתי: '+r.initialGap);
  if(!stages.length)fail.push('לא דווחו שלבים');
  // התמונה נשלחת בכל קריאה
  calls.forEach((c,i)=>{
    const hasImage=JSON.stringify(c.messages).includes('BASE64');
    if(!hasImage)fail.push('קריאה '+i+' בלי התמונה');
  });
  // המעריך רואה את הערכת השני בסיבוב התגובה
  const rebuttal=JSON.stringify(calls[2].messages);
  if(!rebuttal.includes('1000')&&!rebuttal.includes('600'))fail.push('התגובה לא כללה את הערכת השני');
  // כשהשניים כבר מסכימים, סיבוב התגובה מיותר ונחסך
  calls = [];
  w.fetch = (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const isJudge = /הכרע/.test(body.system || '');
    const answer = { kcal: isJudge ? 810 : 800, protein: 50, carbs: 60, fat: 30, items: [] };
    if (isJudge) answer.verdict = 'קרובים';
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      content: [{ type: 'text', text: JSON.stringify(answer) }] }) });
  };

  w.Estimate.debate('k', 'B', 'image/jpeg', () => {}).then((agreed) => {
    if (calls.length !== 3) fail.push('בהסכמה ציפיתי ל-3 קריאות בלבד, היו ' + calls.length);
    if (agreed.rounds.length !== 3) fail.push('ציפיתי ל-3 סיבובים בהסכמה');

    console.log(fail.length ? '\u2717 ' + fail.join(' | ')
      : '\u2713 חמישה שלבים במחלוקת, שלושה בהסכמה, התמונה בכל קריאה');
    process.exit(fail.length ? 1 : 0);
  });
}).catch(e=>{console.log('✗ '+e.message);process.exit(1);});
