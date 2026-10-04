import React, { useState, useCallback, useEffect } from 'react';
import type { Scenario } from './types';
import { usePersonnel }  from './hooks/usePersonnel';
import { useAlerts }     from './hooks/useAlerts';
import { useSimulation } from './hooks/useSimulation';
import { useC2Backend }  from './hooks/useC2Backend';
import { useHardwareSerial } from './hooks/useHardwareSerial';
import RadarScope        from './components/RadarScope';
import HardwareRadarScope from './components/HardwareRadarScope';
import TrackList         from './components/TrackList';
import PersonnelPanel    from './components/PersonnelPanel';
import AlertsPanel       from './components/AlertsPanel';
import TrackDetails      from './components/TrackDetails';
import ScenarioControls  from './components/ScenarioControls';
import { formatTime }    from './utils/radar';
import type { Track }    from './types';

function Clock() {
  const [time, setTime] = useState(formatTime(Date.now()));
  useEffect(() => {
    const id = setInterval(() => setTime(formatTime(Date.now())), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-cyan-400 font-bold tabular-nums">{time}</span>;
}

export default function App() {
  const { personnel, addPersonnel, updatePersonnel, removePersonnel, deactivatePersonnel } = usePersonnel();
  const { alerts, fireAlert, addFalseAlarm, acknowledge, dismiss, clearAll } = useAlerts();
  const personnelIds = personnel.filter(p => p.status === 'ACTIVE').map(p => p.id);

  // Data Source state: LIVE HARDWARE vs C2 SIMULATION
  const [dataSource, setDataSource] = useState<'LIVE_HARDWARE' | 'C2_SIMULATION'>('C2_SIMULATION');

  const handleBreach = useCallback((track: Track) => {
    fireAlert(track);
  }, [fireAlert]);

  const hardware = useHardwareSerial(handleBreach);
  const c2 = useC2Backend(handleBreach);

  const handleLocalBreach = useCallback((track: Track) => {
    if (!c2.isConnected && dataSource !== 'LIVE_HARDWARE') {
      fireAlert(track);
    }
  }, [c2.isConnected, dataSource, fireAlert]);

  const localSim = useSimulation(personnelIds, handleLocalBreach);

  // Switch to LIVE HARDWARE automatically when serial connects
  useEffect(() => {
    if (hardware.connected) {
      setDataSource('LIVE_HARDWARE');
    }
  }, [hardware.connected]);

  // Use canonical backend tracks and controls when connected; fallback to local simulation if offline
  const isConnected = c2.isConnected;
  const tracks = isConnected && c2.tracks.length > 0 ? c2.tracks : localSim.tracks;
  const sweepAngle = isConnected ? c2.sweepAngle : localSim.sweepAngle;
  const isPaused = isConnected ? c2.isPaused : localSim.isPaused;
  const scenario = (isConnected && c2.scenario ? c2.scenario : localSim.scenario) as Scenario;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setScenario = useCallback((s: Scenario) => {
    if (isConnected) {
      c2.selectScenario(s);
    } else {
      localSim.setScenario(s);
    }
  }, [isConnected, c2, localSim]);

  const pause = useCallback(() => {
    if (isConnected) c2.togglePause();
    else localSim.pause();
  }, [isConnected, c2, localSim]);

  const resume = useCallback(() => {
    if (isConnected) c2.togglePause();
    else localSim.resume();
  }, [isConnected, c2, localSim]);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (isConnected && id) c2.selectEntity(id);
  }, [isConnected, c2]);

  const selectedTrack = tracks.find(t => t.id === selectedId) ?? null;

  const handleReset = useCallback(() => {
    if (isConnected) c2.resetSim();
    else localSim.reset();
    clearAll();
    setSelectedId(null);
  }, [isConnected, c2, localSim, clearAll]);

  const handleReport = useCallback(() => {
    const report = {
      generated: new Date().toISOString(),
      scenario: dataSource === 'LIVE_HARDWARE' ? 'LIVE_HARDWARE_MONITORING' : scenario,
      dataSource,
      totalTracks: dataSource === 'LIVE_HARDWARE' ? (hardware.connected ? 1 : 0) : tracks.length,
      activeAlerts: alerts.filter(a => !a.dismissed).length,
      tracks: dataSource === 'LIVE_HARDWARE'
        ? [{
            id: 'HW-RADAR-01',
            type: 'UNKNOWN_OBJECT',
            distanceCm: hardware.distanceCm,
            angleDeg: hardware.angle,
            isIntrusion: hardware.isIntrusion,
            source: 'LIVE ESP32 (HC-SR04)',
          }]
        : tracks.map(t => ({
            id: t.id, type: t.type, distance: Math.round(t.distance),
            bearing: Math.round(t.bearing), speed: t.speed,
            insidePerimeter: t.insidePerimeter, confidence: t.confidence,
            firstDetected: new Date(t.firstDetected).toISOString(),
          })),
      alerts: alerts.map(a => ({
        id: a.id, severity: a.severity, message: a.message,
        timestamp: new Date(a.timestamp).toISOString(),
        acknowledged: a.acknowledged, dismissed: a.dismissed,
      })),
      disclaimer: dataSource === 'LIVE_HARDWARE'
        ? 'LIVE ESP32 ULTRASONIC TELEMETRY MODE ACTIVE.'
        : 'SIMULATION ONLY — NOT CONNECTED TO REAL CAMERAS, BIOMETRIC SYSTEMS, OR SECURITY NETWORKS.',
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `incident-report-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [tracks, alerts, scenario, dataSource, hardware]);

  return (
    <div className="h-screen flex flex-col bg-gray-950 font-mono overflow-hidden">
      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-700/60 bg-gray-950 flex-shrink-0 gap-2">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${hardware.connected && dataSource === 'LIVE_HARDWARE' ? 'bg-emerald-400 animate-ping' : isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'}`} />
          <span className="text-sm font-bold tracking-[0.15em] text-cyan-300">RADAR SECURITY SCANNER</span>
          
          {/* Data Source Selector */}
          <div className="flex items-center border border-gray-800 rounded bg-gray-900 p-0.5 text-[9px] font-bold">
            <button
              onClick={() => setDataSource('LIVE_HARDWARE')}
              className={`px-2 py-0.5 rounded transition ${dataSource === 'LIVE_HARDWARE' ? 'bg-cyan-900 text-cyan-300 border border-cyan-700 font-extrabold' : 'text-gray-400 hover:text-gray-200'}`}
            >
              LIVE HARDWARE
            </button>
            <button
              onClick={() => setDataSource('C2_SIMULATION')}
              className={`px-2 py-0.5 rounded transition ${dataSource === 'C2_SIMULATION' ? 'bg-cyan-900 text-cyan-300 border border-cyan-700 font-extrabold' : 'text-gray-400 hover:text-gray-200'}`}
            >
              C2 SIMULATION
            </button>
          </div>
        </div>

        {/* ESP32 Connect / Status Controls */}
        <div className="flex items-center gap-2">
          {hardware.connected ? (
            <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-500/50 px-2 py-0.5 rounded text-[10px] text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>ESP32: CONNECTED</span>
              <button
                onClick={hardware.disconnect}
                className="ml-1 px-1.5 py-0.2 bg-red-950 border border-red-800 text-red-300 hover:bg-red-900 rounded text-[9px]"
              >
                DISCONNECT
              </button>
            </div>
          ) : (
            <button
              onClick={hardware.connect}
              disabled={hardware.connecting}
              className="flex items-center gap-1.5 bg-cyan-950 border border-cyan-700 hover:bg-cyan-900 text-cyan-300 px-2.5 py-1 rounded text-[10px] font-bold transition shadow-sm"
            >
              <span>{hardware.connecting ? 'CONNECTING...' : '🔌 CONNECT ESP32'}</span>
            </button>
          )}

          <span className={`text-[8px] border px-2 py-0.5 rounded font-bold ${isConnected ? 'border-emerald-500/50 text-emerald-400 bg-emerald-950/40' : 'border-gray-700 text-gray-500'}`}>
            {isConnected ? 'C2 BACKEND: CONNECTED [8080]' : 'OFFLINE FALLBACK'}
          </span>
        </div>

        {/* Header Right */}
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-gray-500">
            MODE: <span className="text-cyan-400 font-bold">{dataSource === 'LIVE_HARDWARE' ? 'LIVE ESP32 (0–300 cm)' : String(scenario).replace(/_/g, ' ')}</span>
          </span>
          <Clock />
        </div>
      </header>

      {/* Hardware Error Toast Banner if unsupported or connection failed */}
      {hardware.error && (
        <div className="bg-red-950 border-b border-red-800 text-red-300 px-4 py-1 text-center text-[10px] font-bold flex items-center justify-between">
          <span>⚠ HARDWARE ERROR: {hardware.error}</span>
          <button onClick={() => hardware.disconnect()} className="text-red-400 hover:text-white underline ml-2">DISMISS</button>
        </div>
      )}

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-2 p-2">
        {/* LEFT — Track List */}
        <div className="w-52 flex-shrink-0 flex flex-col overflow-hidden">
          <TrackList tracks={dataSource === 'LIVE_HARDWARE' ? [] : tracks} selectedId={selectedId} onSelect={handleSelect} />
        </div>

        {/* CENTRE — Radar (Conditional rendering based on Data Source) */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <div className="panel w-full h-full flex items-center justify-center" style={{ minHeight: 0 }}>
            {dataSource === 'LIVE_HARDWARE' ? (
              <HardwareRadarScope hardware={hardware} />
            ) : (
              <RadarScope
                tracks={tracks}
                sweepAngle={sweepAngle}
                selectedId={selectedId}
                isPaused={isPaused}
                onSelect={handleSelect}
              />
            )}
          </div>
        </div>

        {/* RIGHT — Personnel + Alerts + TrackDetails */}
        <div className="w-60 flex-shrink-0 flex flex-col gap-2 overflow-hidden">
          {/* Track detail (shown when selected in simulation mode) */}
          {dataSource === 'C2_SIMULATION' && selectedTrack && (
            <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: '40%' }}>
              <TrackDetails
                track={selectedTrack}
                personnel={personnel}
                alerts={alerts}
                onAcknowledge={acknowledge}
                onDismiss={dismiss}
              />
            </div>
          )}

          {/* Personnel panel */}
          <div className="flex-shrink-0">
            <PersonnelPanel
              personnel={personnel}
              onAdd={addPersonnel}
              onUpdate={updatePersonnel}
              onRemove={removePersonnel}
              onDeactivate={deactivatePersonnel}
            />
          </div>

          {/* Alerts panel */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <AlertsPanel
              alerts={alerts}
              onAcknowledge={acknowledge}
              onDismiss={dismiss}
            />
          </div>
        </div>
      </div>

      {/* ── BOTTOM BAR ──────────────────────────────────────────────────────── */}
      <ScenarioControls
        scenario={scenario}
        isPaused={isPaused}
        alerts={alerts}
        onScenario={setScenario}
        onPause={pause}
        onResume={resume}
        onReset={handleReset}
        onFalseAlarm={addFalseAlarm}
        onReport={handleReport}
      />
    </div>
  );
}

