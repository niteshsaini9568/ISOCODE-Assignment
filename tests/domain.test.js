import test from 'node:test';
import assert from 'node:assert/strict';
import { demoScorecard, demoScore, scoringLines, validateAiScore, scorecardSchema, identity } from '../server/domain.js';
import { samples, sampleText } from '../server/seed.js';
test('sample rankings follow explicit evidence and never invent missing facts', () => {
  const criteria = demoScorecard('Senior Java Developer, 5-8 years, Java, Spring Boot, Noida, notice up to 60 days');
  const scores = samples.map(s => demoScore(criteria, scoringLines(sampleText(s), s.name)));
  assert(scores[0].total > scores[2].total);
  assert(scores[2].total > scores[1].total);
  assert.equal(scores[0].criteria.find(c => c.id.startsWith('location')).status, 'unknown');
  assert.equal(scores[2].criteria.find(c => c.id.startsWith('experience')).status, 'not_met');
  for (const s of scores) for (const criterion of s.criteria) if (criterion.status !== 'unknown') assert(criterion.evidence.length);
});
test('the scoring boundary excludes identity, contacts and protected trait lines', () => {
  const text = 'Ritika Bansal\nName: Ritika Bansal, Java\nGender: Female, Java\nAge: 29, Python\nMarital status: Single\nEmail: test@example.com, SQL\nPhone: +91 9876543210, Spring Boot\nRitika Bansal built Java services\nKey skills: Java, Spring Boot\nTotal experience: 6.5 years';
  const lines = scoringLines(text, 'Ritika Bansal');
  assert.deepEqual(lines.map(l => l.line), [9, 10]);
  assert(!JSON.stringify(lines).includes('Ritika'));
});
test('AI scores reject fabricated quotes, absent criteria, duplicates and missing evidence', () => {
  const criteria = demoScorecard('Java developer, 5-8 years'),
    lines = [{
      line: 1,
      quote: 'Java; total experience: 6 years'
    }];
  const valid = {
    criteria: criteria.map(c => ({
      id: c.id,
      status: 'met',
      evidence: [{
        line: 1,
        quote: 'Java; total experience: 6 years'
      }]
    }))
  };
  assert.equal(validateAiScore(valid, criteria, lines).total, 100);
  assert.throws(() => validateAiScore({
    criteria: [valid.criteria[0]]
  }, criteria, lines));
  assert.throws(() => validateAiScore({
    criteria: valid.criteria.map(c => ({
      ...c,
      evidence: [{
        line: 1,
        quote: 'invented'
      }]
    }))
  }, criteria, lines));
  assert.throws(() => validateAiScore({
    criteria: valid.criteria.map(c => ({
      ...c,
      evidence: []
    }))
  }, criteria, lines));
  assert.throws(() => validateAiScore({
    criteria: [valid.criteria[0], valid.criteria[0]]
  }, criteria, lines));
});
test('scorecards reject protected traits, inverted ranges and duplicate IDs', () => {
  const criteria = demoScorecard('Java developer, 5-8 years');
  assert.throws(() => scorecardSchema.parse([{
    ...criteria[0],
    label: 'Candidate gender'
  }]));
  assert.throws(() => scorecardSchema.parse([{
    ...criteria[1],
    min: 8,
    max: 5
  }]));
  assert.throws(() => scorecardSchema.parse([criteria[0], criteria[0]]));
});
test('column-style and labelled headers identify names before job facts are filtered', () => {
  assert.equal(identity('Ritika Bansal | Senior Java Developer\nKey skills: Java').name, 'Ritika Bansal');
  assert.equal(identity('CV\nName: Ritika Bansal\nCurrent role: Java Developer').name, 'Ritika Bansal');
  assert.deepEqual(scoringLines('Female Java developer\n29-year-old Java developer\nKey skills: Java'), [{
    line: 3,
    quote: 'Key skills: Java'
  }]);
});
test('sectioned CVs retain unfamiliar technologies without admitting personal sections', () => {
  const text = 'Nisha Raman\nTechnical Skills\nGolang\nKubernetes\nDocker\nWork Experience\nSenior Platform Developer\nTotal experience: 6 years\nPersonal Details\nFemale\nMarried\nNisha Raman\nPhone: 9999999999';
  const lines = scoringLines(text, 'Nisha Raman');
  assert(lines.some(line => line.quote === 'Golang'));
  assert(lines.some(line => line.quote === 'Kubernetes'));
  assert(lines.some(line => line.quote === 'Docker'));
  assert(!JSON.stringify(lines).match(/Female|Married|Nisha Raman|9999999999/));
  const criteria = scorecardSchema.parse([{
    id: 'k8s',
    kind: 'skill',
    label: 'Kubernetes',
    value: 'Kubernetes',
    weight: 20,
    mustHave: true
  }]);
  assert.equal(demoScore(criteria, lines).total, 100);
});
