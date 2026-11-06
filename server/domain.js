import { createHash, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const stages = ['Sourced', 'Reviewed', 'Submitted', 'Shortlisted', 'Interview', 'Offered', 'Joined', 'Rejected'];
export const criterionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/), label: z.string().trim().min(1).max(100),
  kind: z.enum(['skill', 'experience', 'notice', 'ctc', 'location']),
  value: z.string().trim().max(100), min: z.number().min(0).max(100).nullable().default(null),
  max: z.number().min(0).max(200).nullable().default(null),
  weight: z.number().int().min(1).max(100), mustHave: z.boolean(),
}).strict().refine(c => c.min === null || c.max === null || c.min <= c.max, 'Minimum must not exceed maximum');
export const scorecardSchema = z.array(criterionSchema).min(1).max(20).superRefine((rows, ctx) => {
  if (new Set(rows.map(c => c.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: 'Criterion IDs must be unique' });
  if (rows.some(c => /\b(name|gender|age|photo|marital|religion|caste|sex|nationality)\b/i.test(`${c.label} ${c.value}`))) ctx.addIssue({ code: 'custom', message: 'Personal traits cannot be scoring criteria' });
  for (const c of rows) {
    if (['experience','notice','ctc'].includes(c.kind) && c.min === null && c.max === null) ctx.addIssue({ code: 'custom', message: `${c.label} needs a minimum or maximum` });
    if (['skill','location'].includes(c.kind) && !c.value) ctx.addIssue({ code: 'custom', message: `${c.label} needs a value` });
  }
});
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const hash = text => createHash('sha256').update(text).digest('hex');
export const now = () => new Date().toISOString();
export function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function passwordMatches(password, encoded) {
  const [salt, value] = encoded.split(':');
  return timingSafeEqual(Buffer.from(value, 'hex'), scryptSync(password, salt, 64));
}
export function identity(text) {
  const email = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || null;
  const explicit = text.match(/(?:^|\n)\s*(?:candidate name|full name|name)\s*:\s*([^\n|]+)/i)?.[1];
  const name = explicit?.trim() || text.split(/\r?\n/).slice(0,12).flatMap(s=>s.split(/[|\t•]/)).map(s => s.trim()).find(s => /^[\p{L} .'-]{3,60}$/u.test(s) && s.split(/\s+/).length>=2 && !/resume|curriculum|vitae|profile|developer|engineer|analyst|experience|skills|education|summary|project|university|college|career/i.test(s)) || 'Candidate';
  return { name, email };
}

// Allow only job-relevant facts through the scoring boundary; the full CV stays private.
export function scoringLines(text, name = '') {
  let skillsSection = false;
  const relevant = /\b(skill|tech|java|spring|hibernate|microservice|rest|python|sql|react|node|aws|azure|kyc|aml|excel|retail|sales|customer|inventory|experience|years?|notice|ctc|lpa|salary|location|noida|delhi|mumbai|bengaluru|project|develop|engineer|analyst|worked|built|led|design|implement|managed|bank|compliance)\b/i;
  return text.split(/\r?\n/).map((line, i) => ({ line: i + 1, quote: line.trim() })).filter(({ quote }) => {
    if (/^(?:technical\s+skills|skills|technologies|technical\s+proficiencies)\s*:?$/i.test(quote)) skillsSection = true;
    else if (/^(?:personal(?:\s+(?:details|information))?|contact(?:\s+(?:details|information))?|education|work\s+experience|employment|projects?|hobbies|references|declaration)\s*:?$/i.test(quote)) skillsSection = false;
    if (!quote || (!skillsSection && !relevant.test(quote))) return false;
    if (/(@|https?:|linkedin|github|\b(gender|sex|male|female|woman|man|nonbinary|dob|birth|age|marital|married|single|nationality|religion|caste|father|mother|wife|husband|photo|passport|address|phone|mobile|contact|name)\b|\d+[- ]year[- ]old|\+?\d[\d ()-]{8,}\d)/i.test(quote)) return false;
    return !name || name === 'Candidate' || !quote.toLowerCase().includes(name.toLowerCase());
  }).slice(0, 800);
}

export function demoScorecard(jd) {
  const criteria = [];
  const add = (kind, label, value = '', min = null, max = null, weight = 20) => criteria.push({ id: `${kind}_${criteria.length}`, kind, label, value, min, max, weight, mustHave: true });
  for (const skill of ['Java','Spring Boot','Hibernate','REST APIs','microservices','Python','SQL','React','KYC','AML','Excel','retail','sales']) if (new RegExp(`\\b${skill}\\b`, 'i').test(jd)) add('skill', skill, skill);
  const exp = jd.match(/(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)\s*years?/i);
  if (exp) add('experience','Experience','', Number(exp[1]), Number(exp[2]));
  const notice = jd.match(/notice[^\d\n]{0,25}(\d+)\s*days?/i);
  if (notice) add('notice','Notice period','', null, Number(notice[1]), 15);
  const ctc = jd.match(/(?:ctc|budget|salary)[^\d\n]{0,20}(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(?:lpa|lakh)/i);
  if (ctc) add('ctc','Annual CTC','', null, Number(ctc[2] || ctc[1]), 10);
  if (/\bNoida\b/i.test(jd)) add('location','Location','Noida',null,null,10);
  if (!criteria.length) fail(422, 'No supported requirements found. Add skills and an experience range, or enable AI extraction.');
  return scorecardSchema.parse(criteria);
}
export function profileFromLines(lines) {
  const all = lines.map(l => l.quote).join('\n');
  return {
    role: all.match(/(?:current role|role)\s*:\s*([^\n]+)/i)?.[1] || 'Profile awaiting review',
    experience: all.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs)\b/i) ? Number(all.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs)\b/i)[1]) : null,
    notice: all.match(/notice[^\d\n]{0,20}(\d+)\s*days?/i)?.[1] ?? null,
    ctc: all.match(/(?:ctc|salary)[^\d\n]{0,15}(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/i)?.[1] ?? null,
    skills: ['Java','Spring Boot','Hibernate','REST APIs','microservices','Python','SQL','React','KYC','AML','Excel','retail','sales'].filter(s => all.toLowerCase().includes(s.toLowerCase())),
  };
}
export function calculateScore(criteria, results, mode) {
  const total = criteria.reduce((s,c) => s+c.weight, 0);
  return { total: Math.round(criteria.reduce((s,c) => s + c.weight * ({ met: 1, partial: .5 }[results.find(r => r.id === c.id)?.status] || 0), 0) / total * 100), criteria: results, mode };
}
export function demoScore(criteria, lines) {
  const results = criteria.map(c => {
    let line;
    let status = 'unknown';
    if (['skill','location'].includes(c.kind)) {
      line = lines.find(l => l.quote.toLowerCase().includes(c.value.toLowerCase()));
      if (line) status = 'met';
    } else {
      const pattern = { experience: /(\d+(?:\.\d+)?)\s*(?:years?|yrs)\b/i, notice: /notice[^\d\n]{0,20}(\d+)\s*days?/i, ctc: /(?:ctc|salary)[^\d\n]{0,15}(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/i }[c.kind];
      line = lines.find(l => pattern.test(l.quote));
      if (line) { const n = Number(line.quote.match(pattern)[1]); status = (c.min === null || n >= c.min) && (c.max === null || n <= c.max) ? 'met' : 'not_met'; }
    }
    return { id: c.id, status, evidence: line ? [line] : [] };
  });
  return calculateScore(criteria, results, 'demo');
}
export function validateAiScore(result, criteria, lines) {
  const schema = z.object({ criteria: z.array(z.object({ id: z.string(), status: z.enum(['met','partial','not_met','unknown']), evidence: z.array(z.object({ line: z.number().int(), quote: z.string().min(1).max(2000) }).strict()).max(4) }).strict()) }).strict();
  const parsed = schema.parse(result).criteria;
  if (parsed.length !== criteria.length || new Set(parsed.map(c => c.id)).size !== criteria.length || parsed.some(r => !criteria.some(c => c.id === r.id))) fail(502, 'AI returned incomplete criteria. Retry scoring.');
  for (const row of parsed) {
    if (row.status !== 'unknown' && !row.evidence.length) fail(502, 'AI result has no evidence. Retry scoring.');
    for (const e of row.evidence) if (!lines.some(l => l.line === e.line && l.quote.includes(e.quote))) fail(502, 'AI evidence could not be verified. Retry scoring.');
  }
  return calculateScore(criteria, parsed, 'ai');
}
