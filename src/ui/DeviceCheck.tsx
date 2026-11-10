import { useEffect, useState } from 'react';
import { type CheckResult, runAllChecks } from '../app/deviceCheck';
import { href } from '../app/router';
import { useDb } from '../app/store';

export function DeviceCheck() {
  const db = useDb();
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [run, setRun] = useState(0);
  useEffect(() => {
    let live = true;
    setResults(null);
    void runAllChecks(db).then((r) => live && setResults(r));
    return () => {
      live = false;
    };
  }, [db, run]);
  const failed = results?.filter((r) => r.status === 'fail').length ?? 0;
  const passed = results?.filter((r) => r.status === 'pass').length ?? 0;
  return (
    <div className="page" data-testid="device-check" data-state={results ? (failed ? 'failed' : 'passed') : 'running'} data-failed={failed}>
      <a className="back" href={href('progress')}>Progress</a>
      <h1>Device check</h1>
      <p className="lede">{results ? (failed ? `${failed} check${failed === 1 ? '' : 's'} failed, ${passed} passed.` : `All ${passed} checks passed on this device.`) : 'Running checks on this device'}</p>
      <p className="muted">These run here, on this device, with throwaway test data. Your history is not touched. {navigator.onLine ? 'You are online.' : 'You are offline, so this also shows what works with no connection.'}</p>
      <ul className="attempt-list">
        {results?.map((r) => (
          <li key={r.id}>
            <span className="journal-row" data-testid={`check-${r.id}`} data-status={r.status}>
              <span className="concept-name">{r.status === 'pass' ? 'Passed' : r.status === 'fail' ? 'Failed' : 'Note'}: {r.label}</span>
              <span className="concept-meta">{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="actions"><button onClick={() => setRun((n) => n + 1)}>Run again</button></div>
    </div>
  );
}
