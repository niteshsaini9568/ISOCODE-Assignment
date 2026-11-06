import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardData } from '../src/dashboard-data.js';
test('dashboard partitions applications without double counting submitted and joined hires', () => {
  const jobs = [{
    id: 'A',
    count: 7,
    submitted: 3,
    joined: 1
  }, {
    id: 'B',
    count: 4,
    submitted: 2,
    joined: 2
  }];
  const recruiter = dashboardData(jobs);
  assert.deepEqual(recruiter.segments.map(segment => segment.value), [6, 2, 3]);
  assert.equal(recruiter.total, 11);
  const client = dashboardData(jobs, true);
  assert.equal(client.total, 5);
  assert.deepEqual(client.rows.map(row => row.applications), [3, 2]);
  assert.equal(client.segments.reduce((sum, segment) => sum + segment.value, 0), client.total);
  assert.equal(dashboardData([]).total, 0);
  assert.ok(dashboardData([]).segments.every(segment => segment.value === 0));
});
