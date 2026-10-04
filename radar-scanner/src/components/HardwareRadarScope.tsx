import React from 'react';
import type { HardwareState } from '../hooks/useHardwareSerial';

interface Props {
  hardware: HardwareState;
}

const MAX_DIST_CM = 300;
const THREAT_DIST_CM = 50; // Intrusion threshold 50cm
const RINGS = [50, 100, 150, 200, 250, 300];

const SVG_W = 700;
const SVG_H = 460;
const CX = 350;
const CY = 400;
const RADIUS = 340;

function polarToSVG(angleDeg: number, distCm: number) {
  const clampedDist = Math.min(Math.max(distCm, 0), MAX_DIST_CM);
  // Map 0 deg -> left (-X), 90 deg -> top (-Y), 180 deg -> right (+X)
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  const rPx = (clampedDist / MAX_DIST_CM) * RADIUS;
  return {
    px: CX + rPx * Math.cos(rad),
    py: CY + rPx * Math.sin(rad),
  };
}

export default function HardwareRadarScope({ hardware }: Props) {
  const {
    connected,
    connectionState,
    angle,
    distanceCm,
    pir,
    rfid,
    isIntrusion,
    telemetryStale,
    targetHistory,
    audioEnabled,
    toggleAudio,
  } = hardware;

  const currentSweepRad = ((angle - 180) * Math.PI) / 180;
  const sweepX = CX + RADIUS * Math.cos(currentSweepRad);
  const sweepY = CY + RADIUS * Math.sin(currentSweepRad);

  const targetPt = polarToSVG(angle, distanceCm);
  const hasTarget = connected && distanceCm < 290.0 && distanceCm > 1.5;
  const isThreat = isIntrusion;

  return (
    <div className="flex flex-col items-center justify-center w-full h-full relative font-mono text-cyan-400 select-none">
      {/* ── TOP TELEMETRY DISPLAY HEADER ───────────────────────────────────── */}
      <div className="w-full max-w-2xl flex flex-col gap-1.5 p-2 bg-gray-900/95 border border-gray-800 rounded-t-lg text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                connectionState === 'DISCONNECTED'
                  ? 'bg-red-500'
                  : connectionState === 'STALE'
                  ? 'bg-amber-400 animate-ping'
                  : isThreat
                  ? 'bg-red-500 animate-ping'
                  : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span className="font-bold text-gray-200">LIVE HARDWARE RADAR</span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                connectionState === 'LIVE'
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                  : connectionState === 'STALE'
                  ? 'bg-amber-950 border-amber-700 text-amber-300'
                  : 'bg-red-950 border-red-800 text-red-400'
              }`}
            >
              {connectionState}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Toggle Button */}
            <button
              onClick={toggleAudio}
              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition flex items-center gap-1 ${
                audioEnabled
                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300 hover:bg-emerald-900'
                  : 'bg-cyan-950 border-cyan-700 text-cyan-300 hover:bg-cyan-900'
              }`}
            >
              <span>{audioEnabled ? '🔊 ALARM SOUND: ACTIVE' : '🔇 ENABLE ALERT SOUND'}</span>
            </button>
          </div>
        </div>

        {/* Telemetry Numbers */}
        <div className="flex items-center justify-between text-[11px] bg-gray-950 px-3 py-1 rounded border border-gray-850">
          <div>
            <span className="text-gray-500 text-[10px]">ANGLE: </span>
            <span className="font-bold text-cyan-300">{angle}°</span>
          </div>

          <div>
            <span className="text-gray-500 text-[10px]">RANGE: </span>
            <span className={`font-bold ${isThreat ? 'text-red-400 animate-bounce' : hasTarget ? 'text-emerald-400' : 'text-gray-400'}`}>
              {hasTarget ? `${distanceCm.toFixed(1)} cm` : 'CLEAR (>300 cm)'}
            </span>
          </div>

          <div>
            <span className="text-gray-500 text-[10px]">PIR: </span>
            <span className={`font-bold ${pir === 1 ? 'text-amber-400' : 'text-gray-500'}`}>
              {pir === 1 ? 'MOTION' : '0'}
            </span>
          </div>

          <div>
            <span className="text-gray-500 text-[10px]">RFID: </span>
            <span className={`font-bold ${rfid && rfid !== '0' ? 'text-cyan-300' : 'text-gray-500'}`}>
              {rfid && rfid !== '0' ? rfid : 'NONE'}
            </span>
          </div>

          <div>
            <span className="text-gray-500 text-[10px]">STATUS: </span>
            <span className={`font-bold ${!connected ? 'text-red-400' : telemetryStale ? 'text-amber-400' : isThreat ? 'text-red-500 animate-pulse' : 'text-emerald-400'}`}>
              {!connected ? 'DISCONNECTED' : telemetryStale ? 'STALE' : isThreat ? 'INTRUSION DETECTED' : 'CLEAR'}
            </span>
          </div>
        </div>
      </div>

      {/* ── SEMI-CIRCULAR RADAR SCOPE SVG ──────────────────────────────────── */}
      <div className="relative w-full max-w-2xl bg-gray-950 border-x border-b border-gray-800 rounded-b-lg p-2 flex items-center justify-center">
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-auto max-h-[460px]">
          <defs>
            <radialGradient id="hwSweepGrad" cx="50%" cy="100%" r="100%">
              <stop offset="0%" stopColor={isThreat ? '#ef4444' : '#06b6d4'} stopOpacity="0.4" />
              <stop offset="70%" stopColor={isThreat ? '#ef4444' : '#06b6d4'} stopOpacity="0.1" />
              <stop offset="100%" stopColor={isThreat ? '#ef4444' : '#06b6d4'} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="hwBgGrad" cx="50%" cy="100%" r="100%">
              <stop offset="0%" stopColor={isThreat ? '#260909' : '#091826'} />
              <stop offset="100%" stopColor="#020810" />
            </radialGradient>
          </defs>

          {/* Background Arc */}
          <path
            d={`M ${CX - RADIUS - 10} ${CY} A ${RADIUS + 10} ${RADIUS + 10} 0 0 1 ${CX + RADIUS + 10} ${CY} Z`}
            fill="url(#hwBgGrad)" stroke={isThreat ? '#450e0e' : '#0f2942'} strokeWidth="2"
          />

          {/* Concentric Range Rings */}
          {RINGS.map(dist => {
            const rPx = (dist / MAX_DIST_CM) * RADIUS;
            const isThreatRing = dist === THREAT_DIST_CM;
            return (
              <g key={dist}>
                <path
                  d={`M ${CX - rPx} ${CY} A ${rPx} ${rPx} 0 0 1 ${CX + rPx} ${CY}`}
                  fill="none"
                  stroke={isThreatRing ? '#ef4444' : '#113554'}
                  strokeWidth={isThreatRing ? 1.8 : 1}
                  strokeDasharray={isThreatRing ? '4 4' : undefined}
                />
                <text
                  x={CX + 6} y={CY - rPx + 11}
                  fill={isThreatRing ? '#ef4444' : '#2d6085'}
                  fontSize={9} fontFamily="JetBrains Mono, monospace" fontWeight={isThreatRing ? 700 : 400}
                >
                  {dist} cm{isThreatRing ? ' (ALERT <50cm)' : ''}
                </text>
              </g>
            );
          })}

          {/* Threat Zone 50cm Arc */}
          {(() => {
            const threatPx = (THREAT_DIST_CM / MAX_DIST_CM) * RADIUS;
            return (
              <path
                d={`M ${CX - threatPx} ${CY} A ${threatPx} ${threatPx} 0 0 1 ${CX + threatPx} ${CY} Z`}
                fill="#ef4444" fillOpacity={isThreat ? '0.22' : '0.05'}
                stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 3"
              />
            );
          })()}

          {/* Angle Grid Lines & Ticks */}
          {Array.from({ length: 13 }, (_, i) => i * 15).map(deg => {
            const rad = ((deg - 180) * Math.PI) / 180;
            const isMajor = deg % 45 === 0;
            const xInner = CX + (RADIUS - (isMajor ? 14 : 8)) * Math.cos(rad);
            const yInner = CY + (RADIUS - (isMajor ? 14 : 8)) * Math.sin(rad);
            const xOuter = CX + RADIUS * Math.cos(rad);
            const yOuter = CY + RADIUS * Math.sin(rad);
            const xLabel = CX + (RADIUS + 20) * Math.cos(rad);
            const yLabel = CY + (RADIUS + 20) * Math.sin(rad);

            return (
              <g key={deg}>
                <line
                  x1={CX} y1={CY} x2={xOuter} y2={yOuter}
                  stroke={isThreat ? '#401212' : '#0e2a45'} strokeWidth={isMajor ? 1.2 : 0.6}
                />
                <line
                  x1={xInner} y1={yInner} x2={xOuter} y2={yOuter}
                  stroke={isThreat ? '#ef4444' : '#18b8d6'} strokeWidth={isMajor ? 1.8 : 1}
                />
                <text
                  x={xLabel} y={yLabel}
                  fill={isThreat ? '#ef4444' : '#18b8d6'} fontSize={10} fontWeight={isMajor ? 700 : 400}
                  fontFamily="JetBrains Mono, monospace" textAnchor="middle" dominantBaseline="middle"
                >
                  {deg}°
                </text>
              </g>
            );
          })}

          {/* Base Baseline Axis */}
          <line x1={CX - RADIUS - 15} y1={CY} x2={CX + RADIUS + 15} y2={CY} stroke={isThreat ? '#ef4444' : '#18b8d6'} strokeWidth="2" opacity="0.6" />

          {/* Target Trail Points */}
          {targetHistory.filter(pt => pt.distanceCm < 290.0 && pt.distanceCm > 1.5).map((pt, idx) => {
            const svgPt = polarToSVG(pt.angle, pt.distanceCm);
            const opacity = Math.max(0.1, 0.8 - idx * 0.05);
            return (
              <circle
                key={`${pt.timestamp}-${idx}`}
                cx={svgPt.px} cy={svgPt.py} r={3}
                fill={isThreat ? '#ef4444' : '#06b6d4'} opacity={opacity}
              />
            );
          })}

          {/* Live Hardware Sweep Line */}
          {connected && !telemetryStale && (
            <>
              <line
                x1={CX} y1={CY} x2={sweepX} y2={sweepY}
                stroke={isThreat ? '#ef4444' : '#06b6d4'} strokeWidth="2" opacity="0.9"
              />
              <circle cx={sweepX} cy={sweepY} r="3" fill={isThreat ? '#ef4444' : '#06b6d4'} />
            </>
          )}

          {/* Current Live Target Dot */}
          {hasTarget && (
            <g>
              {/* Threat pulse ring */}
              {isThreat && (
                <circle
                  cx={targetPt.px} cy={targetPt.py} r={20}
                  fill="none" stroke="#ef4444" strokeWidth="2"
                  className="animate-ping" opacity="0.8"
                />
              )}
              {/* Target Reticle Outer Ring */}
              <circle
                cx={targetPt.px} cy={targetPt.py} r={10}
                fill="none" stroke={isThreat ? '#ef4444' : '#22c55e'} strokeWidth="1.8"
              />
              {/* Target Solid Center Dot */}
              <circle
                cx={targetPt.px} cy={targetPt.py} r={4}
                fill={isThreat ? '#ef4444' : '#22c55e'}
              />
              {/* Reticle Crosshairs */}
              <line x1={targetPt.px - 14} y1={targetPt.py} x2={targetPt.px + 14} y2={targetPt.py} stroke={isThreat ? '#ef4444' : '#22c55e'} strokeWidth="1" />
              <line x1={targetPt.px} y1={targetPt.py - 14} x2={targetPt.px} y2={targetPt.py + 14} stroke={isThreat ? '#ef4444' : '#22c55e'} strokeWidth="1" />
              {/* Target Data Tag */}
              <rect
                x={targetPt.px + 12} y={targetPt.py - 22} width={105} height={32}
                fill="rgba(3,10,18,0.92)" stroke={isThreat ? '#ef4444' : '#22c55e'} strokeWidth="1" rx="3"
              />
              <text x={targetPt.px + 17} y={targetPt.py - 10} fill={isThreat ? '#ef4444' : '#22c55e'} fontSize="9" fontWeight="bold">
                {isThreat ? '⚠ INTRUDER' : 'TARGET'}
              </text>
              <text x={targetPt.px + 17} y={targetPt.py + 2} fill="#9cb1c5" fontSize="8">
                {distanceCm.toFixed(1)}cm · {angle}°
              </text>
            </g>
          )}

          {/* Center Sensor Origin Reticle */}
          <circle cx={CX} cy={CY} r="6" fill="none" stroke="#18b8d6" strokeWidth="2" />
          <circle cx={CX} cy={CY} r="2" fill="#18b8d6" />
        </svg>

        {/* ── INTRUSION ALERT BANNER OVERLAY ─────────────────────────────────── */}
        {isThreat && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-950/95 border-2 border-red-500 text-red-100 px-5 py-2.5 rounded shadow-2xl flex items-center gap-4 animate-bounce z-20">
            <div className="w-4 h-4 rounded-full bg-red-500 animate-ping" />
            <div>
              <div className="font-extrabold text-sm tracking-wider text-red-400">⚠ INTRUSION DETECTED!</div>
              <div className="text-[10px] text-red-200">
                ANGLE: <span className="font-bold text-white">{angle}°</span> | DISTANCE: <span className="font-bold text-white">{distanceCm.toFixed(1)} cm</span> | THREAT LEVEL: <span className="font-bold text-red-400">HIGH</span>
              </div>
            </div>
            <div className="text-[9px] bg-red-900 border border-red-700 px-2 py-1 rounded text-red-300 font-bold">
              LIVE ESP32
            </div>
          </div>
        )}

        {/* ── DISCONNECTED OVERLAY ────────────────────────────────────────── */}
        {!connected && (
          <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <div className="w-12 h-12 rounded-full border border-cyan-500/30 flex items-center justify-center mb-3 bg-cyan-950/40 text-cyan-400">
              🔌
            </div>
            <div className="text-cyan-300 font-bold text-sm mb-1">ESP32 HARDWARE DISCONNECTED</div>
            <div className="text-gray-400 text-xs max-w-sm mb-4">
              Connect your ESP32 Dev Module via USB (115200 Baud) to stream real HC-SR04 ultrasonic distance telemetry.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
