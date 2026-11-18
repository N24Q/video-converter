import type { PreviewResult } from '../../shared/types';

const ACTION: Record<string, string> = {
  encode: 'Re-encode',
  copy: 'Copy',
  convert: 'Convert',
  drop: 'Not included',
};

export function PlanPreview({
  preview,
  showCommand,
}: {
  preview: PreviewResult | null;
  showCommand: boolean;
}) {
  if (!preview) return null;
  const v = preview.validation;
  return (
    <div className="plan" data-testid="plan-preview">
      {v.errors.length > 0 && (
        <div className="error-box" role="alert">
          {v.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      {v.warnings.length > 0 && (
        <ul className="warnings">
          {v.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <table className="list compact">
        <thead>
          <tr>
            <th>Stream</th>
            <th>Source</th>
            <th>Action</th>
            <th>Output</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {v.plan.map((p) => (
            <tr key={p.sourceIndex} className={p.action === 'drop' ? 'muted' : undefined}>
              <td>
                #{p.sourceIndex} {p.type}
              </td>
              <td>{p.sourceCodec ?? '?'}</td>
              <td>{ACTION[p.action]}</td>
              <td>{p.action === 'drop' ? '—' : p.targetCodec}</td>
              <td className="small">{p.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {showCommand && preview.args.length > 0 && (
        <details>
          <summary>FFmpeg command (for reference)</summary>
          <code className="cmd">
            ffmpeg {preview.args.map((a) => (/[\s'"]/.test(a) ? `'${a}'` : a)).join(' ')}
          </code>
        </details>
      )}
    </div>
  );
}
