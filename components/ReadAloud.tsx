'use client';

/**
 * Read-aloud controls.
 *
 * The original implementation called `speechSynthesis.speak()` and then
 * reported "ไฟล์ใหม่ถูกดาวน์โหลดจากเบราว์เซอร์ของคุณ" — the wrong message
 * entirely — with no way to pause, resume or stop, no voice selection, and no
 * indication of whether a Thai voice existed at all. On a device with no Thai
 * voice installed the result was silence and a success message.
 *
 * Speech is a live control surface rather than a file to hand back, so this
 * component owns the whole interaction.
 */

import { Pause, Play, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ReadAloudProps = { text: string; onStopped?: () => void };

/** Browsers cap a single utterance; long documents must be chunked. */
const CHUNK = 900;

function splitForSpeech(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  // Prefer sentence-ish boundaries; Thai uses a space where English uses a
  // comma, so a blank line or a space after a clause is the best signal we get.
  for (const part of text.split(/(?<=[.!?\n])\s+/)) {
    if ((current + part).length > CHUNK) {
      if (current) chunks.push(current.trim());
      current = part;
      while (current.length > CHUNK) {
        chunks.push(current.slice(0, CHUNK));
        current = current.slice(CHUNK);
      }
    } else current += ` ${part}`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export function ReadAloud({ text, onStopped }: ReadAloudProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState('');
  const [rate, setRate] = useState(1);
  const [state, setState] = useState<'idle' | 'speaking' | 'paused'>('idle');
  const [progress, setProgress] = useState(0);
  const chunks = useRef<string[]>([]);
  const index = useRef(0);
  const cancelled = useRef(false);

  // Voice lists arrive asynchronously in every browser, and Chrome fires
  // `voiceschanged` more than once.
  useEffect(() => {
    const load = () => {
      const all = speechSynthesis.getVoices();
      setVoices(all);
      setVoiceUri((current) => {
        if (current) return current;
        const thai = all.find((voice) => voice.lang?.toLowerCase().startsWith('th'));
        return (thai ?? all[0])?.voiceURI ?? '';
      });
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const stop = useCallback(() => {
    cancelled.current = true;
    speechSynthesis.cancel();
    setState('idle');
    setProgress(0);
    index.current = 0;
    onStopped?.();
  }, [onStopped]);

  // Never leave a voice running after the dialog closes.
  useEffect(() => () => speechSynthesis.cancel(), []);

  const speakFrom = useCallback(
    (from: number) => {
      const queue = chunks.current;
      const voice = voices.find((v) => v.voiceURI === voiceUri);

      // The recursion lives inside the callback so it never has to reference
      // its own memoised binding.
      const speakNext = (at: number) => {
        if (at >= queue.length) {
          setState('idle');
          setProgress(1);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(queue[at]);
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang ?? 'th-TH';
        utterance.rate = rate;
        utterance.onend = () => {
          if (cancelled.current) return;
          index.current = at + 1;
          setProgress((at + 1) / queue.length);
          speakNext(at + 1);
        };
        utterance.onerror = () => setState('idle');
        speechSynthesis.speak(utterance);
      };

      speakNext(from);
    },
    [rate, voiceUri, voices],
  );

  const start = () => {
    cancelled.current = false;
    speechSynthesis.cancel();
    chunks.current = splitForSpeech(text);
    index.current = 0;
    setProgress(0);
    setState('speaking');
    speakFrom(0);
  };

  const hasThaiVoice = voices.some((voice) => voice.lang?.toLowerCase().startsWith('th'));

  return (
    <div className="space-y-4 rounded-xl border border-line bg-sunken p-4">
      <div className="flex items-center gap-2">
        {state === 'idle' ? (
          <button type="button" onClick={start} className="btn-primary flex-1 py-2.5">
            <Play size={16} aria-hidden="true" />
            เริ่มอ่านออกเสียง
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (state === 'speaking') {
                  speechSynthesis.pause();
                  setState('paused');
                } else {
                  speechSynthesis.resume();
                  setState('speaking');
                }
              }}
              className="btn-primary flex-1 py-2.5"
            >
              {state === 'speaking' ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {state === 'speaking' ? 'หยุดชั่วคราว' : 'เล่นต่อ'}
            </button>
            <button
              type="button"
              onClick={stop}
              className="rounded-[var(--radius-md)] border border-line px-4 py-2.5 font-semibold text-body hover:bg-card"
            >
              <Square size={15} aria-hidden="true" />
              <span className="sr-only">หยุด</span>
            </button>
          </>
        )}
      </div>

      {state !== 'idle' && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="ความคืบหน้าการอ่าน"
          className="progress-track"
        >
          <span className="progress-fill block" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="voice" className="block text-xs font-medium text-muted">เสียง</label>
          <select
            id="voice"
            value={voiceUri}
            onChange={(event) => setVoiceUri(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border border-line bg-card px-2 text-sm text-body"
          >
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rate" className="block text-xs font-medium text-muted">
            ความเร็ว {rate.toFixed(1)}×
          </label>
          <input
            id="rate"
            type="range"
            min={0.6}
            max={1.8}
            step={0.1}
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
            className="mt-3 w-full accent-[color:var(--brand)]"
          />
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs leading-6 text-subtle">
        <Volume2 size={14} className="mt-1 shrink-0" aria-hidden="true" />
        {hasThaiVoice
          ? 'ใช้เสียงที่ติดตั้งอยู่ในเครื่องคุณ ข้อความไม่ถูกส่งไปสังเคราะห์เสียงบนคลาวด์'
          : 'อุปกรณ์นี้ยังไม่มีเสียงภาษาไทยติดตั้งอยู่ — ระบบจะใช้เสียงอื่นแทน ' +
            'ซึ่งอาจออกเสียงภาษาไทยไม่ถูกต้อง'}
      </p>
    </div>
  );
}
