'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icon';

type Toast = { id: number; text: string; bad?: boolean };

let push: ((t: Omit<Toast, 'id'>) => void) | null = null;
let seq = 0;

/** Imperative so a server action result can announce itself from anywhere. */
export function toast(text: string, bad = false) {
  push?.({ text, bad });
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);

  const add = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq;
    setItems((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.bad ? 6000 : 3200);
  }, []);

  useEffect(() => {
    push = add;
    return () => {
      push = null;
    };
  }, [add]);

  if (!items.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.bad ? 'toast-bad' : ''}`}>
          <Icon name={t.bad ? 'alert' : 'checkcircle'} size={15} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
