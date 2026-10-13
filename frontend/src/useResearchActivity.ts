import { useCallback, useEffect, useRef, useState } from 'react';
import { CompletionTracker } from './researchActivityModel';
import type { ChatActivity, ChatJob } from './researchChatModel';

type Api = (path: string, init?: RequestInit) => Promise<any>;
export function useResearchActivity(api: Api, userId: string, refreshList: (signal?: AbortSignal) => Promise<void>) {
  const [activities, setActivities] = useState<ChatActivity[]>([]);
  const [connectionLost, setConnectionLost] = useState(false);
  const preference = 'nexora-chat-sound:' + userId, deliveredKey = 'nexora-chat-completed:' + userId;
  const [sound, setSound] = useState(() => { try { return localStorage.getItem(preference) !== 'off'; } catch { return true; } });
  const enabled = useRef(sound); enabled.current = sound;
  const tracker = useRef(new CompletionTracker()), audio = useRef<AudioContext | null>(null), alive = useRef(true);
  const play = useCallback(() => {
    const context = audio.current;
    if (!enabled.current || !context || context.state !== 'running' || !alive.current) return;
    // A short original two-note chime. No external audio, no autoplay bypass.
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + index * .14;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.09, start + .015); gain.gain.exponentialRampToValueAtTime(.001, start + .25);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .26);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }, []);
  const observe = useCallback((jobs: readonly ChatJob[]) => {
    const ids = tracker.current.observe(jobs);
    if (!ids.length) return;
    const deliver = () => {
      if (!alive.current) return;
      let previous: string[] = [];
      try { const value = JSON.parse(localStorage.getItem(deliveredKey) || '[]'); if (Array.isArray(value)) previous = value.filter(item => typeof item === 'string').slice(-200); } catch { /* storage is optional */ }
      const fresh = ids.filter(id => !previous.includes(id));
      if (!fresh.length) return;
      try { localStorage.setItem(deliveredKey, JSON.stringify([...previous, ...fresh].slice(-200))); } catch { /* no contents or credentials stored */ }
      try { play(); } catch { /* audio failure must not become a network error */ }
    };
    // Serialize delivery across tabs on browsers supporting Web Locks.
    if (navigator.locks) void navigator.locks.request(deliveredKey, deliver).catch(() => {}); else deliver();
  }, [deliveredKey, play]);
  useEffect(() => {
    alive.current = true;
    const prime = () => {
      if (!enabled.current) return;
      try { audio.current ||= new AudioContext(); if (audio.current.state === 'suspended') void audio.current.resume().catch(() => {}); } catch { /* visual status remains available */ }
    };
    const preferenceChange = (event: StorageEvent) => { if (event.key === preference) setSound(event.newValue !== 'off'); };
    document.addEventListener('pointerdown', prime); document.addEventListener('keydown', prime); window.addEventListener('storage', preferenceChange);
    return () => { alive.current = false; document.removeEventListener('pointerdown', prime); document.removeEventListener('keydown', prime); window.removeEventListener('storage', preferenceChange); void audio.current?.close().catch(() => {}); audio.current = null; };
  }, [preference]);
  useEffect(() => { try { localStorage.setItem(preference, sound ? 'on' : 'off'); } catch { /* optional */ } }, [sound, preference]);
  useEffect(() => {
    let disposed = false, timer: number, controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const deadline = window.setTimeout(() => controller.abort(), 12000);
      try {
        const result = await api('/activity', { signal: controller.signal });
        if (disposed) return;
        if (!Array.isArray(result.activities)) throw new Error('Invalid activity response');
        setActivities(result.activities); setConnectionLost(false); observe(result.activities);
        await refreshList(controller.signal);
      } catch { if (!disposed) setConnectionLost(true); }
      finally { clearTimeout(deadline); if (!disposed) timer = window.setTimeout(() => void poll(), 2000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [api, refreshList, observe]);
  return { activities, connectionLost, sound, setSound, observe };
}
