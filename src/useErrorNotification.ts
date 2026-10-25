import { useCallback, useEffect, useState } from 'react';

export function useErrorNotification() {
  const [notification, setNotification] = useState<{ message: string } | null>(null);
  const setError = useCallback((message: string | null) => {
    setNotification(message === null ? null : { message });
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timeout = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(timeout);
  }, [notification]);

  return [notification?.message ?? null, setError] as const;
}
