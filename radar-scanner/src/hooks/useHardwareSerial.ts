import { useState, useEffect, useRef, useCallback } from 'react';
import type { Track } from '../types';

export type HardwareConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'LIVE' | 'STALE';

export interface HardwareState {
  isSupported: boolean;
  connected: boolean;
  connecting: boolean;
  connectionState: HardwareConnectionState;
  error: string | null;
  angle: number;
  distanceCm: number;
  pir: number;
  rfid: string;
  isIntrusion: boolean;
  telemetryStale: boolean;
  lastUpdate: number;
  targetHistory: Array<{ angle: number; distanceCm: number; timestamp: number }>;
  statusMsg: string;
  audioEnabled: boolean;
  toggleAudio: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const STALE_TIMEOUT_MS = 3000;
const ALERT_COOLDOWN_MS = 3000;

class WebAudioAlarmController {
  private ctx: AudioContext | null = null;
  private timer: any = null;
  private isPlaying: boolean = false;

  public unlockAudio(): boolean {
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return true;
    } catch {
      return false;
    }
  }

  public startAlarm() {
    if (this.isPlaying) return;
    this.unlockAudio();
    if (!this.ctx) return;

    this.isPlaying = true;

    const playBeep = () => {
      if (!this.isPlaying || !this.ctx) return;
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Square wave tone for authentic digital alert buzzer sound
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime); // 1.2kHz piercing alert pitch

        // Sharp digital ON/OFF pulse (no musical beat fade)
        gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, this.ctx.currentTime + 0.12); // 120ms sharp beep

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 0.13);
      } catch {
        /* ignore transient audio play errors */
      }
    };

    playBeep();
    // Rapid repeating alert beep pulse (120ms beep + 80ms pause)
    this.timer = setInterval(playBeep, 200);
  }

  public stopAlarm() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const alarmSynth = new WebAudioAlarmController();

export function useHardwareSerial(onHardwareBreach?: (track: Track) => void): HardwareState {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [angle, setAngle] = useState<number>(0);
  const [distanceCm, setDistanceCm] = useState<number>(300);
  const [pir, setPir] = useState<number>(0);
  const [rfid, setRfid] = useState<string>('0');
  const [isIntrusion, setIsIntrusion] = useState<boolean>(false);
  const [telemetryStale, setTelemetryStale] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [targetHistory, setTargetHistory] = useState<Array<{ angle: number; distanceCm: number; timestamp: number }>>([]);
  const [statusMsg, setStatusMsg] = useState<string>('DISCONNECTED');
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);

  const portRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const keepReadingRef = useRef<boolean>(false);
  const lastAlertTimeRef = useRef<number>(0);

  useEffect(() => {
    setIsSupported(typeof navigator !== 'undefined' && 'serial' in navigator);
  }, []);

  // Check for stale telemetry
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      if (Date.now() - lastUpdate > STALE_TIMEOUT_MS) {
        setTelemetryStale(true);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [connected, lastUpdate]);

  // Sync laptop audio alarm with intrusion state
  useEffect(() => {
    if (isIntrusion && audioEnabled) {
      alarmSynth.startAlarm();
    } else {
      alarmSynth.stopAlarm();
    }
    return () => {
      alarmSynth.stopAlarm();
    };
  }, [isIntrusion, audioEnabled]);

  const toggleAudio = useCallback(() => {
    setAudioEnabled(prev => {
      const next = !prev;
      if (next) {
        alarmSynth.unlockAudio();
        if (isIntrusion) alarmSynth.startAlarm();
      } else {
        alarmSynth.stopAlarm();
      }
      return next;
    });
  }, [isIntrusion]);

  const processLine = useCallback((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parts = trimmed.split(',');
    const header = parts[0]?.toUpperCase();

    if (header === 'READY') {
      setStatusMsg('ESP32 HARDWARE READY');
      setTelemetryStale(false);
      setLastUpdate(Date.now());
    } else if (header === 'DATA' && parts.length >= 3) {
      const parsedAngle = parseFloat(parts[1]);
      const parsedDist = parseFloat(parts[2]);
      const parsedPir = parts.length >= 4 ? parseInt(parts[3], 10) : 0;
      const parsedRfid = parts.length >= 5 ? parts[4] : '0';

      if (!isNaN(parsedAngle) && !isNaN(parsedDist)) {
        setAngle(parsedAngle);
        setDistanceCm(parsedDist);
        setPir(isNaN(parsedPir) ? 0 : parsedPir);
        setRfid(parsedRfid);
        setLastUpdate(Date.now());
        setTelemetryStale(false);

        // Update target history for valid detected objects (< 290 cm)
        if (parsedDist < 290.0 && parsedDist > 1.5) {
          setTargetHistory(prev => {
            const next = [{ angle: parsedAngle, distanceCm: parsedDist, timestamp: Date.now() }, ...prev];
            return next.slice(0, 15);
          });
        }
      }
    } else if (header === 'ALERT' && parts.length >= 3) {
      const parsedAngle = parseFloat(parts[1]);
      const parsedDist = parseFloat(parts[2]);

      if (!isNaN(parsedAngle) && !isNaN(parsedDist)) {
        setAngle(parsedAngle);
        setDistanceCm(parsedDist);
        setIsIntrusion(true);
        setStatusMsg('INTRUSION DETECTED');
        setLastUpdate(Date.now());
        setTelemetryStale(false);

        // Trigger debounced breach alert for React alert panel
        if (onHardwareBreach) {
          const now = Date.now();
          if (now - lastAlertTimeRef.current > ALERT_COOLDOWN_MS) {
            lastAlertTimeRef.current = now;
            const rad = (parsedAngle * Math.PI) / 180;
            const hwTrack: Track = {
              id: 'HW-RADAR-01',
              type: 'UNKNOWN_OBJECT',
              x: (parsedDist / 100) * Math.sin(rad),
              y: (parsedDist / 100) * Math.cos(rad),
              bearing: parsedAngle,
              distance: parsedDist,
              speed: 0,
              heading: 0,
              confidence: 98,
              firstDetected: now,
              lastSeen: now,
              trail: [],
              insidePerimeter: true,
              alertFired: true,
            };
            onHardwareBreach(hwTrack);
          }
        }
      }
    } else if (header === 'CLEAR' && parts.length >= 3) {
      const parsedAngle = parseFloat(parts[1]);
      const parsedDist = parseFloat(parts[2]);
      if (!isNaN(parsedAngle) && !isNaN(parsedDist)) {
        setAngle(parsedAngle);
        setDistanceCm(parsedDist);
      }
      setIsIntrusion(false);
      setStatusMsg('SCANNING MODE');
      setLastUpdate(Date.now());
      setTelemetryStale(false);
    } else if (header === 'RFID' && parts.length >= 2) {
      const tag = parts[1];
      setRfid(tag);
      setStatusMsg(`RFID CARD DETECTED: ${tag}`);
    }
  }, [onHardwareBreach]);

  const disconnect = useCallback(async () => {
    alarmSynth.stopAlarm();
    keepReadingRef.current = false;

    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch {
        /* ignore */
      }
      readerRef.current = null;
    }
    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch {
        /* ignore */
      }
      portRef.current = null;
    }

    setConnected(false);
    setConnecting(false);
    setIsIntrusion(false);
    setTelemetryStale(true);
    setStatusMsg('DISCONNECTED');
  }, []);

  const connect = useCallback(async () => {
    if (!('serial' in navigator)) {
      setError('Web Serial API is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    try {
      setError(null);
      setConnecting(true);

      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;

      setConnected(true);
      setConnecting(false);
      setStatusMsg('ESP32 LIVE');

      keepReadingRef.current = true;
      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable).catch(() => {});
      const reader = textDecoder.readable.getReader();
      readerRef.current = reader;

      let buffer = '';

      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          buffer += value;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            processLine(line);
          }
        }
      }
    } catch (err: any) {
      console.warn('Web Serial connection error:', err);
      if (err.name !== 'NotFoundError') {
        const msg = err.message || '';
        if (msg.includes('Failed to open serial port') || msg.includes('open')) {
          setError('COM port is in use or locked. Please CLOSE Arduino Serial Monitor, VSCode, or any other app using the COM port, then click Connect again.');
        } else {
          setError(msg || 'Failed to connect to ESP32 serial port.');
        }
      }
      await disconnect();
    }
  }, [disconnect, processLine]);

  const connectionState: HardwareConnectionState = !connected
    ? 'DISCONNECTED'
    : connecting
    ? 'CONNECTING'
    : telemetryStale
    ? 'STALE'
    : 'LIVE';

  return {
    isSupported,
    connected,
    connecting,
    connectionState,
    error,
    angle,
    distanceCm,
    pir,
    rfid,
    isIntrusion,
    telemetryStale,
    lastUpdate,
    targetHistory,
    statusMsg,
    audioEnabled,
    toggleAudio,
    connect,
    disconnect,
  };
}
