import { useState } from 'react';
import { useAppData } from './hooks/useAppData';
import { ConvertPage } from './pages/ConvertPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { FfmpegBanner } from './components/FfmpegBanner';

type Tab = 'convert' | 'history' | 'settings' | 'diagnostics';

export function App() {
  const data = useAppData();
  const [tab, setTab] = useState<Tab>('convert');
  const active = data.jobs.filter(
    (j) => j.status === 'converting' || j.status === 'preparing',
  ).length;

  if (!data.settings) return <div className="loading">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Video Converter</h1>
        <nav role="tablist">
          {(
            [
              ['convert', `Convert${active ? ` (${active} running)` : ''}`],
              ['history', 'History'],
              ['settings', 'Settings'],
              ['diagnostics', 'Diagnostics'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <label className="mode-switch" title="Advanced mode exposes every encoder option">
          <input
            type="checkbox"
            checked={data.settings.uiMode === 'advanced'}
            onChange={(e) =>
              data.updateSettings({ uiMode: e.target.checked ? 'advanced' : 'simple' })
            }
          />
          Advanced mode
        </label>
      </header>
      <FfmpegBanner status={data.ffmpeg} onOpenDiagnostics={() => setTab('diagnostics')} />
      <main>
        {tab === 'convert' && <ConvertPage data={data} />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'settings' && <SettingsPage data={data} />}
        {tab === 'diagnostics' && <DiagnosticsPage data={data} />}
      </main>
    </div>
  );
}
