import type { MatchTerminalProjection } from '@bravers/protocol';
import type { RecoverySnapshot } from './recoveryMachine';
import {
  recoveryMessage,
  type OnlineLocale,
  type RecoveryMessageKey,
} from './recoveryMessages';

interface RecoveryBannerProps {
  snapshot: RecoverySnapshot;
  locale: OnlineLocale;
  onResume(): void;
  onRetry(): void;
  onOpen(): void;
  onDismiss(): void;
}

function errorMessage(kind: Extract<RecoverySnapshot, { phase: 'error' }>['kind']): RecoveryMessageKey {
  switch (kind) {
    case 'offline': return 'offline';
    case 'temporary': return 'temporary';
    case 'session': return 'sessionExpired';
    case 'unavailable': return 'unavailable';
    case 'protocol': return 'protocol';
  }
}

function resultMessage(result: MatchTerminalProjection | null): RecoveryMessageKey {
  if (!result) return 'terminalPending';
  if (result.state !== 'finished') return 'terminalCancelled';
  if (result.winner === null) return 'terminalDraw';
  return result.winner === 0 ? 'terminalWin' : 'terminalLose';
}

export function RecoveryBanner({
  snapshot,
  locale,
  onResume,
  onRetry,
  onOpen,
  onDismiss,
}: RecoveryBannerProps) {
  const t = (key: RecoveryMessageKey) => recoveryMessage(locale, key);
  if (snapshot.phase === 'idle') return null;

  if (snapshot.phase === 'checking') {
    return <p className="recovery-quiet" role="status" aria-live="polite">{t('checking')}</p>;
  }
  if (snapshot.phase === 'provisioning') {
    return (
      <aside className="recovery-banner muted" role="status" aria-live="polite">
        <span className="recovery-pulse" aria-hidden="true" />
        <p>{t('provisioning')}</p>
      </aside>
    );
  }
  if (snapshot.phase === 'offer') {
    return (
      <aside className="recovery-banner active" aria-labelledby="recovery-title">
        <div className="recovery-copy">
          <strong id="recovery-title">{t('activeTitle')}</strong>
          <span>{t('activeBody')}</span>
        </div>
        <button className="recovery-button" type="button" onClick={onResume}>{t('resume')}</button>
      </aside>
    );
  }
  if (snapshot.phase === 'connecting') {
    return (
      <aside className="recovery-banner active" role="status" aria-live="polite" aria-atomic="true">
        <span className="recovery-pulse" aria-hidden="true" />
        <p>{snapshot.stage === 'sync' ? t('syncing') : t('connecting')}</p>
        <button className="recovery-button" type="button" disabled>{t('resume')}</button>
      </aside>
    );
  }
  if (snapshot.phase === 'playing') {
    return (
      <aside className="recovery-banner active" aria-labelledby="recovery-playing-title">
        <div className="recovery-copy">
          <strong id="recovery-playing-title">{t('activeTitle')}</strong>
          <span>{t('activeBody')}</span>
        </div>
        <button className="recovery-button" type="button" onClick={onOpen}>{t('openBattle')}</button>
      </aside>
    );
  }
  if (snapshot.phase === 'terminal-loading') {
    return (
      <aside className="recovery-banner muted" role="status" aria-live="polite">
        <span className="recovery-pulse" aria-hidden="true" />
        <p>{t('terminalLoading')}</p>
      </aside>
    );
  }
  if (snapshot.phase === 'terminal') {
    return (
      <aside
        className="recovery-banner terminal"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-labelledby="recovery-result-title"
      >
        <div className="recovery-copy">
          <strong id="recovery-result-title">{t('terminalTitle')}</strong>
          <span>{t(resultMessage(snapshot.result))}</span>
        </div>
        <div className="recovery-actions">
          {snapshot.result === null && (
            <button className="recovery-button secondary" type="button" onClick={onRetry}>{t('retry')}</button>
          )}
          <button className="recovery-button secondary" type="button" onClick={onDismiss}>{t('dismiss')}</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="recovery-banner error" role="alert">
      <p>{t(errorMessage(snapshot.kind))}</p>
      {snapshot.retryable && (
        <button className="recovery-button secondary" type="button" onClick={onRetry}>{t('retry')}</button>
      )}
    </aside>
  );
}
