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

        // Sharp digital ON/OFF pulse
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
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
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

  const triggerBreachAlert = useCallback((parsedAngle: number, effectiveDist: number) => {
    if (onHardwareBreach) {
      const now = Date.now();
      if (now - lastAlertTimeRef.current > ALERT_COOLDOWN_MS) {
        lastAlertTimeRef.current = now;
        const rad = (parsedAngle * Math.PI) / 180;
        const hwTrack: Track = {
          id: 'HW-RADAR-01',
          type: 'UNKNOWN_OBJECT',
          x: (effectiveDist / 100) * Math.sin(rad),
          y: (effectiveDist / 100) * Math.cos(rad),
          bearing: parsedAngle,
          distance: effectiveDist,
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
  }, [onHardwareBreach]);

  const processLine = useCallback((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    setTelemetryStale(false);
    setLastUpdate(Date.now());

    // 1. Structured CSV Protocol Parsing (e.g., READY | DATA,0,23.4,0 | ALERT,0,15.2,1)
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',');
      const header = parts[0]?.toUpperCase();

      if (header === 'READY') {
        setStatusMsg('ESP32 HARDWARE READY');
        setConnected(true);
        return;
      }

      if (header === 'DATA' || header === 'ALERT' || header === 'CLEAR') {
        let parsedAngle = 0;
        let parsedDist = -1;
        let parsedPir = 0;
        let parsedRfid = '0';

        if (parts.length === 3) {
          // Format: DATA,distance_cm,motion
          parsedAngle = 0;
          parsedDist = parseFloat(parts[1]);
          parsedPir = parseInt(parts[2], 10);
        } else if (parts.length >= 4) {
          // Format: DATA,angle,distance_cm,motion[,rfid]
          parsedAngle = parseFloat(parts[1]) || 0;
          parsedDist = parseFloat(parts[2]);
          parsedPir = parseInt(parts[3], 10) || 0;
          parsedRfid = parts[4] || '0';
        }

        if (!isNaN(parsedDist)) {
          // Normalize negative distance (no echo) to 300cm clear
          const effectiveDist = parsedDist <= 0 ? 300 : parsedDist;
          setAngle(parsedAngle);
          setDistanceCm(effectiveDist);
          setPir(isNaN(parsedPir) ? 0 : parsedPir);
          setRfid(parsedRfid);

          const isAlertHeader = header === 'ALERT' || parsedPir === 1 || (effectiveDist > 0 && effectiveDist < 50);

          if (isAlertHeader) {
            setIsIntrusion(true);
            setStatusMsg('INTRUSION DETECTED');
            triggerBreachAlert(parsedAngle, effectiveDist);
          } else {
            setIsIntrusion(false);
            setStatusMsg('ESP32 LIVE');
          }

          if (effectiveDist < 290.0 && effectiveDist > 1.5) {
            setTargetHistory(prev => [
              { angle: parsedAngle, distanceCm: effectiveDist, timestamp: Date.now() },
              ...prev
            ].slice(0, 15));
          }
        }
        return;
      }

      if (header === 'RFID' && parts.length >= 2) {
        const tag = parts[1];
        setRfid(tag);
        setStatusMsg(`RFID CARD DETECTED: ${tag}`);
        return;
      }
    }

    // 2. Fallback Parsing for Human-Readable Text (e.g. "Distance: 23.4 cm | Motion: NONE")
    const distMatch = trimmed.match(/Distance:\s*([\d.-]+|No echo)/i);
    const motionMatch = trimmed.match(/Motion:\s*(DETECTED|NONE|ALERT|1|0)/i);

    if (distMatch || motionMatch) {
      let parsedDist = 300;
      if (distMatch && distMatch[1] && distMatch[1] !== 'No echo') {
        const d = parseFloat(distMatch[1]);
        if (!isNaN(d) && d > 0) parsedDist = d;
      }

      let parsedPir = 0;
      if (motionMatch && (motionMatch[1].toUpperCase() === 'DETECTED' || motionMatch[1] === '1' || motionMatch[1].toUpperCase() === 'ALERT')) {
        parsedPir = 1;
      }

      setDistanceCm(parsedDist);
      setPir(parsedPir);

      const isThreat = parsedPir === 1 || (parsedDist > 0 && parsedDist < 50);
      setIsIntrusion(isThreat);
      setStatusMsg(isThreat ? 'INTRUSION DETECTED' : 'ESP32 LIVE');

      if (isThreat) {
        triggerBreachAlert(0, parsedDist);
      }
    }
  }, [triggerBreachAlert]);

  const cleanupSerial = useCallback(async () => {
    keepReadingRef.current = false;

    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch (err) {
        /* ignore */
      }
      try {
        readerRef.current.releaseLock();
      } catch (err) {
        /* ignore */
      }
      readerRef.current = null;
    }

    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch (err) {
        /* ignore */
      }
      portRef.current = null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    alarmSynth.stopAlarm();
    await cleanupSerial();
    setConnected(false);
    setConnecting(false);
    setIsIntrusion(false);
    setTelemetryStale(true);
    setStatusMsg('DISCONNECTED');
  }, [cleanupSerial]);

  const connect = useCallback(async () => {
    if (!('serial' in navigator)) {
      setError('Web Serial API is not supported in this browser. Please use Chrome or Edge via localhost or HTTPS.');
      return;
    }

    try {
      setError(null);
      setConnecting(true);

      // Clean up any existing stale port or reader connection first
      await cleanupSerial();

      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;

      setConnected(true);
      setConnecting(false);
      setStatusMsg('ESP32 LIVE');

      keepReadingRef.current = true;
      const decoder = new TextDecoder('utf-8');
      const reader: ReadableStreamDefaultReader<Uint8Array> = port.readable.getReader();
      readerRef.current = reader;

      let buffer = '';

      while (keepReadingRef.current) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
              processLine(line);
            }
          }
        } catch (readErr: any) {
          console.warn('Transient serial read error (framing/parity):', readErr);
          // Wait briefly on transient framing error chunk and continue reading loop safely
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } catch (err: any) {
      console.warn('Web Serial connection error:', err);
      const msg = err?.message || String(err);
      if (err?.name === 'NotFoundError') {
        setError(null); // User canceled port selection dialog
      } else if (msg.includes('Failed to open serial port') || msg.includes('locked') || msg.includes('in use') || err?.name === 'InvalidStateError') {
        setError('COM port is in use or locked. Please CLOSE Arduino Serial Monitor, VSCode, or any other app using the COM port, then click Connect again.');
      } else if (msg.includes('Framing error') || err?.name === 'FramingError') {
        setError('Serial Framing Error detected. Please verify baud rate is 115200 and reconnect.');
      } else {
        setError(msg || 'Failed to connect to ESP32 serial port.');
      }
      await disconnect();
    }
  }, [cleanupSerial, disconnect, processLine]);

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
