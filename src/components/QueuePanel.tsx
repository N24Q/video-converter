import { useState } from 'react';
import type { Job } from '../../shared/types';
import { api } from '../api';
import { formatBytes, formatDuration } from '../utils/format';

const STATUS_LABEL: Record<Job['status'], string> = {
  waiting: 'Waiting',
  preparing: 'Preparing',
  converting: 'Converting',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function QueuePanel({ jobs }: { jobs: Job[] }) {
  const [notice, setNotice] = useState<string | null>(null);
  if (jobs.length === 0) return null;
  const finished = jobs.some((j) => ['completed', 'failed', 'cancelled'].includes(j.status));
  return (
    <section className="panel" data-testid="queue">
      <div className="panel-head">
        <h2>Queue</h2>
        <div className="row">
          {finished && <button onClick={() => api.clearFinished()}>Clear finished</button>}
        </div>
      </div>
      {notice && <p className="info-box">{notice}</p>}
      <ul className="jobs">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} onNotice={setNotice} />
        ))}
      </ul>
    </section>
  );
}

function JobRow({ job: j, onNotice }: { job: Job; onNotice: (m: string) => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const p = j.progress;
  const active = j.status === 'converting' || j.status === 'preparing';
  const outName = j.outputPath.split('/').pop();
  return (
    <li className={`job ${j.status}`} data-testid="job" data-status={j.status}>
      <div className="job-head">
        <span className={`badge ${j.status}`}>{STATUS_LABEL[j.status]}</span>
        <span className="name" title={j.sources.join('\n')}>
          {j.mode === 'concat' ? `${j.sourceNames.length} clips combined` : j.sourceNames[0]} →{' '}
          {outName}
        </span>
        <span className="row">
          {(j.status === 'waiting' || active) && (
            <button onClick={() => api.cancelJob(j.id)}>Cancel</button>
          )}
          {(j.status === 'failed' || j.status === 'cancelled') && (
            <button onClick={() => api.retryJob(j.id)}>Retry</button>
          )}
          {j.status === 'failed' && j.error?.kind === 'hw-encoder-failed' && (
            <button
              onClick={async () => {
                const r = await api.retryJobSoftware(j.id);
                onNotice(r.message);
              }}
            >
              Retry with CPU encoder
            </button>
          )}
          {j.status === 'completed' && (
            <button onClick={() => api.openOutputFolder(j.id)}>Show in folder</button>
          )}
          {!active && <button onClick={() => api.removeJob(j.id)}>Remove</button>}
        </span>
      </div>
      {active && (
        <div className="progress-line">
          {p && p.percent !== null ? (
            <progress max={100} value={p.percent} aria-label="Conversion progress" />
          ) : (
            <progress aria-label="Conversion progress (duration unknown)" />
          )}
          <span className="small">
            {j.status === 'preparing'
              ? 'Checking files…'
              : p
                ? [
                    p.percent !== null
                      ? `${p.percent.toFixed(1)}%`
                      : `${formatDuration(p.outTimeSec)} processed`,
                    `elapsed ${formatDuration(p.elapsedSec)}`,
                    p.etaSec !== null ? `about ${formatDuration(p.etaSec)} left` : null,
                    p.speed ? `${p.speed.toFixed(2)}× speed` : null,
                    p.sizeBytes ? formatBytes(p.sizeBytes) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'Starting…'}
          </span>
        </div>
      )}
      {j.status === 'completed' && (
        <p className="small ok">
          Saved to <span className="path">{j.outputPath}</span>
          {j.startedAt && j.endedAt
            ? ` in ${formatDuration((Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000)}`
            : ''}
        </p>
      )}
      {j.error && j.status !== 'cancelled' && (
        <div className="error-box small">
          {j.error.message}{' '}
          {j.error.details && (
            <button className="link" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          )}
          {showDetails && <pre className="log">{j.error.details}</pre>}
        </div>
      )}
      {j.warnings.length > 0 && (
        <ul className="warnings small">
          {j.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
