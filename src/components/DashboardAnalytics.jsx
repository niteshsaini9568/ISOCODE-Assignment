import { ArrowUpRight, BriefcaseBusiness, ShieldCheck } from 'lucide-react';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/Card.jsx';
import { dashboardData } from '../dashboard-data.js';

export function DashboardMetrics({ items }) {
  return <div className="stats-grid">{items.map(([Icon, value, label, note]) => <Card className="metric-card" key={label}>
    <CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle><CardAction><Icon size={18}/></CardAction></CardHeader>
    <CardFooter><strong>{note}</strong><span>Current workspace snapshot</span></CardFooter>
  </Card>)}</div>;
}

export default function DashboardAnalytics({ jobs, client = false, navigate }) {
  const { rows, total, segments } = dashboardData(jobs, client);
  const maximum = Math.max(1, ...rows.map(job => job.applications));
  let offset = 0;
  return <div className="dashboard-analytics">
    <Card><CardHeader><CardTitle>{client ? 'Your submitted candidates' : 'Applications by requisition'}</CardTitle><CardDescription>Current counts, grouped by open role</CardDescription><CardAction><span className="badge">{jobs.length} roles</span></CardAction></CardHeader>
      <CardContent><div className="requisition-chart">{rows.length ? rows.map(job => <button key={job.id} className="requisition-chart-row" onClick={() => navigate(client ? 'portal' : 'ranked', false, job.id)} aria-label={`${job.title}: ${job.applications} candidates. Open ${client ? 'shortlist' : 'ranking'}.`}>
        <span className="chart-row-label"><span><BriefcaseBusiness size={15}/>{job.title}</span><strong>{job.applications}</strong></span><span className="chart-track"><span style={{ width: `${job.applications / maximum * 100}%` }}/></span><small>{job.id} <ArrowUpRight size={13}/></small>
      </button>) : <p className="chart-empty">Create a requisition to see applications here.</p>}</div></CardContent>
      <CardFooter><ShieldCheck size={16}/><span>{client ? 'Only candidates submitted to your account appear here.' : 'Open any role to review candidates and their CV evidence.'}</span></CardFooter>
    </Card>
    <Card><CardHeader><CardTitle>Application breakdown</CardTitle><CardDescription>{client ? 'Submitted applications and joined hires' : 'Recruiter review, client handoff and joined hires'}</CardDescription></CardHeader>
      <CardContent><div className="application-breakdown"><div className="ring-chart" role="img" aria-label={`${total} applications. ${segments.map(segment => `${segment.label}: ${segment.value}`).join('. ')}`}>
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="ring-track" cx="60" cy="60" r="47"/>{segments.map(segment => { const length = total ? segment.value / total * 100 : 0; const start = offset; offset += length; return <circle key={segment.label} cx="60" cy="60" r="47" pathLength="100" stroke={segment.color} strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start}/>; })}</svg><div><strong>{total}</strong><span>applications</span></div>
      </div><div className="chart-legend">{segments.map(segment => <div key={segment.label}><span className="legend-label"><i style={{ background: segment.color }}/>{segment.label}</span><span><strong>{segment.value}</strong><small>{total ? Math.round(segment.value / total * 100) : 0}%</small></span></div>)}</div></div></CardContent>
      <CardFooter><span>Counts refer to applications per role, rather than unique people.</span></CardFooter>
    </Card>
  </div>;
}
