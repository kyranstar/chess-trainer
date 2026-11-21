import { Component, type ReactNode, useEffect, useState } from 'react';
import { href, useRoute } from './app/router';
import { useDb, useLearner, useOnline, usePack } from './app/store';
import { AccountGate } from './account/Gate';
import { currentRole } from './account/role';
import { ScreenFlag } from './ui/Flag';
import { AccountPage } from './account/AccountPage';
import { AdminPage } from './account/AdminPage';
import { useAutoSync, useRemoteCopy } from './app/useAutoSync';
import { ensureReviewPolicy } from './db/db';
import { installPack, packStatus } from './db/pack';
import { ConceptPage, LearnHome } from './ui/Learn';
import { OpeningsHome } from './ui/Openings';
import { PracticeHome, PracticeRun } from './ui/Practice';
import { DeviceCheck } from './ui/DeviceCheck';
import { GameEventsList, GameEventView } from './ui/Games';
import { PositionsList, PositionView, ProgressHome, sinceDateOf } from './ui/Progress';
import { GameBreakdown, GamesList, HowYouPlay, MetricDetail } from './ui/ProgressDetail';
import { MorePageView } from './ui/ProgressMore';
import { DeepGamesList, DeepPage } from './ui/ProgressDeep';
import { BaselineRun, SessionRun, Today } from './ui/Today';

/** The four places, each with an icon so they can be told apart at a glance (ADR-064). */
const TABS = [
  { key: 'today', label: 'Today', icon: 'M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z' },
  { key: 'learn', label: 'Learn', icon: 'M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z' },
  { key: 'practice', label: 'Practice', icon: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 12h16M12 4v16' },
  { key: 'progress', label: 'Progress', icon: 'M4 19V9M10 19V5M16 19v-7M22 19H2' },
] as const;

/** A failure on one screen must not blank the app: show what happened and a way back. Data is untouched. */
class ScreenBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page" data-testid="screen-error">
        <h1>This screen hit an error</h1>
        <p className="note is-error">{this.state.error.message}</p>
        <p>Your recorded progress is stored separately and is not affected. Go to another tab or reload.</p>
        <div className="actions"><button className="primary" onClick={() => window.location.reload()}>Reload</button></div>
      </div>
    );
  }
}

function Shell({ updateReady, applyUpdate }: { updateReady: boolean; applyUpdate: () => void }) {
  const route = useRoute();
  const db = useDb();
  const learner = useLearner();
  const online = useOnline();
  const [packError, setPackError] = useState<string | null>(null);
  const pack = usePack();
  useAutoSync(db);
  useRemoteCopy(db);
  // An app update can change which missed positions are kept in review; old history follows the new rules.
  useEffect(() => {
    void ensureReviewPolicy(db);
  }, [db]);
  const tab = route.parts[0] ?? 'today';

  // First run: copy the practice pack into local storage. Later runs are a cheap manifest check.
  useEffect(() => {
    void (async () => {
      try {
        const st = await packStatus(db);
        if (st.state === 'missing' || navigator.onLine) await installPack(db);
        setPackError(null);
      } catch (e) {
        if ((await packStatus(db)).state === 'missing') setPackError((e as Error).message);
      }
    })();
  }, [db, online]);

  let page;
  if (tab === 'today') page = route.parts[1] === 'run' ? <SessionRun learner={learner} /> : route.parts[1] === 'baseline' ? <BaselineRun learner={learner} /> : <Today learner={learner} />;
  else if (tab === 'learn') page = route.parts[1] ? <ConceptPage key={route.parts[1]} id={route.parts[1]} learner={learner} /> : <LearnHome learner={learner} />;
  else if (tab === 'practice') page = route.parts[1] === 'run' ? <PracticeRun key={route.query.toString()} route={route} learner={learner} /> : route.parts[1] === 'openings' ? <OpeningsHome learner={learner} /> : <PracticeHome learner={learner} />;
  else if (tab === 'progress') {
    if (route.parts[1] === 'positions') page = <PositionsList route={route} learner={learner} />;
    else if (route.parts[1] === 'device-check') page = <DeviceCheck />;
    else if (route.parts[1] === 'game-events') page = <GameEventsList route={route} sinceDateOf={sinceDateOf} />;
    else if (route.parts[1] === 'game-event' && route.parts[2] && route.parts[3]) page = <GameEventView key={`${route.parts[2]}:${route.parts[3]}`} gameId={route.parts[2]} ply={Number(route.parts[3])} />;
    else if (route.parts[1] === 'position' && route.parts[2]) page = <PositionView key={route.parts[2]} uuid={route.parts[2]} learner={learner} />;
    else if (route.parts[1] === 'metric' && route.parts[2]) page = <MetricDetail key={route.parts[2]} id={route.parts[2]} learner={learner} />;
    else if (route.parts[1] === 'game' && route.parts[2]) page = <GameBreakdown key={route.parts[2]} gameId={route.parts[2]} learner={learner} />;
    else if (route.parts[1] === 'games') page = <GamesList learner={learner} />;
    else if (route.parts[1] === 'how') page = <HowYouPlay learner={learner} />;
    else if (route.parts[1] === 'more' && route.parts[2]) page = <MorePageView key={route.parts[2]} page={route.parts[2]} learner={learner} />;
    else if (route.parts[1] === 'deep' && route.parts[2]) page = <DeepPage key={route.query.toString() + route.parts[2]} area={route.parts[2]} route={route} learner={learner} />;
    else if (route.parts[1] === 'deep-games') page = <DeepGamesList key={route.query.toString()} route={route} />;
    else page = <ProgressHome learner={learner} />;
  } else if (tab === 'account') page = <AccountPage />;
  else if (tab === 'admin') page = <AdminPage />;
  else page = <Today learner={learner} />;

  return (
    <div className="app" data-testid="app" data-pack={pack?.state ?? 'checking'} data-ready={learner.ready}>
      {!online && <p className="status-strip" data-testid="offline-strip">Offline. Installed lessons, practice and progress all work.</p>}
      {packError && <p className="status-strip is-error" data-testid="pack-error">{packError}</p>}
      {updateReady && (
        <p className="status-strip">
          A new version is ready. <button className="link" onClick={applyUpdate}>Update now</button> Your progress is kept.
        </p>
      )}
      <main><ScreenBoundary resetKey={window.location.hash}>{page}</ScreenBoundary></main>
      {currentRole() === 'admin' && <ScreenFlag floating />}
      <nav className="tabs" aria-label="Main">
        {TABS.map((t) => (
          <a key={t.key} href={href(t.key)} className={tab === t.key ? 'is-on' : ''} aria-current={tab === t.key ? 'page' : undefined} data-testid={`tab-${t.key}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

export function App({ updateReady, applyUpdate }: { updateReady: boolean; applyUpdate: () => void }) {
  return (
    <AccountGate>
      <Shell updateReady={updateReady} applyUpdate={applyUpdate} />
    </AccountGate>
  );
}
