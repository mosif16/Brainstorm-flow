import { useEffect, useRef } from 'react';
import type { RunEvent } from '../types';
import { eventsUrl } from '../api';

export function useRunStream(
  runId: string | null,
  onEvent: (event: RunEvent) => void,
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(eventsUrl(runId));

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RunEvent;
        handlerRef.current(data);
      } catch (err) {
        console.error('Failed to parse run event', err);
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [runId]);
}
