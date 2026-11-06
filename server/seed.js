import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { openDb } from './db.js';
import { now, passwordHash, demoScorecard, scoringLines, profileFromLines, demoScore, hash } from './domain.js';

export const samples = [
  { id:'CND-91022', name:'Ritika Bansal', role:'Senior Java Developer', years:6.5, skills:'Java, Spring Boot, microservices', notice:60 },
  { id:'CND-91047', name:'Arjun Rawat', role:'KYC Analyst', years:3, skills:'KYC, AML checks, Excel', notice:30 },
  { id:'CND-91088', name:'Pooja Nair', role:'Java Developer', years:4, skills:'Java, Hibernate, REST APIs', notice:90 },
];
export const sampleText = s => `${s.name}\nCurrent role: ${s.role}\nTotal experience: ${s.years} years\nKey skills: ${s.skills}\nNotice period: ${s.notice} days`;
export function seed(db) {
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) return;
  const stamp = now();
  const password = passwordHash('Demo@12345');
  db.exec('BEGIN');
  try {
    const user = db.prepare('INSERT INTO users(id,email,name,password,role,client_id) VALUES(?,?,?,?,?,?)');
    user.run('recruiter','recruiter@company-a.test','Aditi Sharma',password,'recruiter',null);
    user.run('client','client@northstar.test','Vikram Mehta',password,'client','northstar');
    user.run('client2','client@meridian.test','Priya Kapoor',password,'client','meridian');
    const jobs = [
      ['REQ-2401','Senior Java Developer','northstar','Northstar Technologies','Noida','Senior Java Developer, 5-8 years, Java, Spring Boot, Noida, notice up to 60 days'],
      ['REQ-2402','KYC Analyst','meridian','Meridian Banking Services','Noida','KYC Analyst, 2-5 years, KYC, AML, Excel, Noida, notice up to 30 days'],
      ['REQ-2403','Retail Sales Associate','northstar','Northstar Technologies','Noida','Retail Sales Associate, 1-4 years, retail, sales, Noida, notice up to 30 days'],
    ];
    for (const [id,title,clientId,clientName,location,jd] of jobs) db.prepare('INSERT INTO jobs(id,title,client_id,client_name,location,jd,criteria,version,mode,created_at) VALUES(?,?,?,?,?,?,?,1,?,?)').run(id,title,clientId,clientName,location,jd,JSON.stringify(demoScorecard(jd)),'demo',stamp);
    for (const s of samples) {
      const text = sampleText(s), lines = scoringLines(text,s.name);
      db.prepare('INSERT INTO candidates(id,name,email,text,profile,file_path,file_hash,text_hash,consent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.id,s.name,null,text,JSON.stringify(profileFromLines(lines)),null,null,`demo:${hash(text.toLowerCase().replace(/\s+/g,''))}`,JSON.stringify({ purpose:'Hiring evaluation only', source:'Assignment sample data; synthetic consent for demonstration', grantedAt:stamp, recordedBy:'seed', aiProcessing:false }),stamp);
      for (const job of db.prepare('SELECT * FROM jobs WHERE id IN (?,?)').all('REQ-2401',s.id === 'CND-91047' ? 'REQ-2402' : 'REQ-2401')) {
        const appId = `APP-${job.id}-${s.id}`;
        db.prepare('INSERT INTO applications(id,job_id,candidate_id,stage,score,score_version,created_at) VALUES(?,?,?,?,?,1,?)').run(appId,job.id,s.id,'Sourced',JSON.stringify(demoScore(JSON.parse(job.criteria),lines)),stamp);
      }
    }
    db.prepare('INSERT INTO audit(actor,action,detail,created_at) VALUES(?,?,?,?)').run('seed','demo.seeded','Three supplied profiles. Client names, users, two extra requisitions and consent are illustrative.',stamp);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.DEMO_MODE === 'false' || process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled outside demo mode.');
  const db = openDb(path.resolve(process.env.DATA_DIR || 'data')); seed(db); db.close(); console.log('Demo data ready. Existing data was preserved.');
}
