import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  createMatchRecoveryController,
  type MatchRecoveryController,
  type RecoverySnapshot,
} from './recoveryMachine';

export interface MatchRecoveryHandle {
  snapshot: RecoverySnapshot;
  resume(): Promise<boolean>;
  retry(): Promise<boolean>;
  dismissTerminal(): void;
  controller: MatchRecoveryController;
}

export function useMatchRecovery(provided?: MatchRecoveryController): MatchRecoveryHandle {
  const controllerRef = useRef<MatchRecoveryController>();
  if (!controllerRef.current) {
    controllerRef.current = provided ?? createMatchRecoveryController();
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void controller.refresh();
    };
    const onPageShow = () => void controller.refresh();
    window.addEventListener('online', refreshWhenVisible);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('online', refreshWhenVisible);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [controller]);

  return {
    snapshot,
    resume: () => controller.resume(),
    retry: () => controller.retry(),
    dismissTerminal: () => controller.dismissTerminal(),
    controller,
  };
}
