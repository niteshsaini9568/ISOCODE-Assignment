export function dashboardData(jobs, client = false) {
  const rows = jobs.map(job => ({ ...job, applications: client ? job.submitted : job.count }));
  const total = rows.reduce((sum, job) => sum + job.applications, 0);
  const submitted = rows.reduce((sum, job) => sum + job.submitted, 0);
  const joined = rows.reduce((sum, job) => sum + job.joined, 0);
  const segments = client
    ? [{ label: 'With your team', value: submitted - joined, color: 'var(--chart-1)' }, { label: 'Joined', value: joined, color: 'var(--chart-2)' }]
    : [{ label: 'Not submitted', value: total - submitted, color: 'var(--chart-1)' }, { label: 'With clients', value: submitted - joined, color: 'var(--chart-3)' }, { label: 'Joined', value: joined, color: 'var(--chart-2)' }];
  return { rows, total, submitted, joined, segments };
}
