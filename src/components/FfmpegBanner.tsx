import type { FfmpegStatus } from '../../shared/types';

export function FfmpegBanner({
  status,
  onOpenDiagnostics,
}: {
  status: FfmpegStatus | null;
  onOpenDiagnostics: () => void;
}) {
  if (!status || status.ok) return null;
  if (status.error === 'Not yet checked')
    return <div className="banner info">Checking for FFmpeg…</div>;
  return (
    <div className="banner error" role="alert">
      <strong>FFmpeg is not available.</strong> {status.error} Files can be added, but nothing can
      be converted until FFmpeg is installed. On ChromeOS / Debian, open the Terminal and run:
      <code className="cmd">sudo apt update && sudo apt install ffmpeg</code>
      then press <em>Re-check</em> on the{' '}
      <button className="link" onClick={onOpenDiagnostics}>
        Diagnostics
      </button>{' '}
      tab.
    </div>
  );
}
