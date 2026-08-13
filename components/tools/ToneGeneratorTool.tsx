"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type Waveform = OscillatorType;

const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const MAX_GAIN = 0.25;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function frequencyToSlider(frequency: number) {
  return Math.round((Math.log(frequency / MIN_FREQUENCY) / Math.log(MAX_FREQUENCY / MIN_FREQUENCY)) * 1000);
}

function sliderToFrequency(position: number) {
  return Math.round(MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, position / 1000));
}

export function ToneGeneratorTool() {
  const frequencyId = useId();
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [frequency, setFrequency] = useState(440);
  const [waveform, setWaveform] = useState<Waveform>("sine");
  const [volume, setVolume] = useState(8);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("Ready. Start with a low device volume.");

  const stopTone = useCallback((announce = true) => {
    const context = audioContextRef.current;
    const oscillator = oscillatorRef.current;
    const gain = gainRef.current;

    if (context && oscillator && gain) {
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      try {
        oscillator.stop(now + 0.04);
      } catch {
        // The oscillator may already be stopping; cleanup below is still safe.
      }
      oscillator.disconnect();
      gain.disconnect();
    }

    oscillatorRef.current = null;
    gainRef.current = null;
    setPlaying(false);
    if (announce) setStatus("Tone stopped.");
  }, []);

  async function startTone() {
    if (playing) return;
    try {
      let context = audioContextRef.current;
      if (!context || context.state === "closed") {
        context = new AudioContext();
        audioContextRef.current = context;
      }
      if (context.state === "suspended") await context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = waveform;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(volume / 100, MAX_GAIN)), now + 0.05);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.onended = () => {
        if (oscillatorRef.current === oscillator) {
          oscillatorRef.current = null;
          gainRef.current = null;
          setPlaying(false);
        }
      };
      oscillatorRef.current = oscillator;
      gainRef.current = gain;
      setPlaying(true);
      setStatus(`Playing ${frequency.toLocaleString()} hertz at a limited output level.`);
    } catch {
      setStatus("Audio could not start. Check browser audio permission and try again.");
    }
  }

  useEffect(() => {
    const context = audioContextRef.current;
    const oscillator = oscillatorRef.current;
    if (!context || !oscillator || !playing) return;
    const now = context.currentTime;
    oscillator.frequency.cancelScheduledValues(now);
    oscillator.frequency.setTargetAtTime(frequency, now, 0.012);
    oscillator.type = waveform;
    setStatus(`Playing ${frequency.toLocaleString()} hertz at a limited output level.`);
  }, [frequency, playing, waveform]);

  useEffect(() => {
    const context = audioContextRef.current;
    const gain = gainRef.current;
    if (!context || !gain || !playing) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(Math.max(0.0001, Math.min(volume / 100, MAX_GAIN)), now, 0.015);
  }, [playing, volume]);

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden && oscillatorRef.current) stopTone(false);
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => document.removeEventListener("visibilitychange", stopWhenHidden);
  }, [stopTone]);

  useEffect(() => () => {
    const oscillator = oscillatorRef.current;
    oscillatorRef.current = null;
    gainRef.current?.disconnect();
    gainRef.current = null;
    if (oscillator) {
      try { oscillator.stop(); } catch { /* Already stopped. */ }
      oscillator.disconnect();
    }
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, []);

  function setSafeFrequency(next: number) {
    if (!Number.isFinite(next)) return;
    setFrequency(clamp(Math.round(next), MIN_FREQUENCY, MAX_FREQUENCY));
  }

  const sliderPosition = frequencyToSlider(frequency);

  return (
    <div className="tool-workspace tone-workspace">
      <div className="tool-controls">
        <div className="frequency-readout" aria-live="off">
          <span className="eyebrow">Frequency</span>
          <strong>{frequency.toLocaleString()} <small>Hz</small></strong>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor={frequencyId}>Frequency in hertz</label>
          <input
            id={frequencyId}
            className="tool-input tool-input--numeric"
            type="number"
            min={MIN_FREQUENCY}
            max={MAX_FREQUENCY}
            step={1}
            value={frequency}
            onChange={(event) => setSafeFrequency(Number(event.target.value))}
          />
          <input
            className="range-control range-control--log"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={sliderPosition}
            onChange={(event) => setFrequency(sliderToFrequency(Number(event.target.value)))}
            aria-label="Frequency, logarithmic scale from 20 to 20,000 hertz"
          />
          <div className="range-labels" aria-hidden="true"><span>20 Hz</span><span>20 kHz</span></div>
        </div>

        <fieldset className="control-fieldset">
          <legend>Quick frequencies</legend>
          <div className="preset-row">
            {[100, 440, 1000, 8000].map((preset) => (
              <button
                key={preset}
                className={frequency === preset ? "chip chip--active" : "chip"}
                type="button"
                onClick={() => setFrequency(preset)}
                aria-pressed={frequency === preset}
              >
                {preset >= 1000 ? `${preset / 1000} kHz` : `${preset} Hz`}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field-group">
          <span className="field-label">Waveform</span>
          <select className="tool-select" value={waveform} onChange={(event) => setWaveform(event.target.value as Waveform)}>
            <option value="sine">Sine · smooth</option>
            <option value="triangle">Triangle · soft</option>
            <option value="square">Square · bright</option>
            <option value="sawtooth">Sawtooth · rich</option>
          </select>
        </label>

        <div className="field-group">
          <label className="field-label" htmlFor={`${frequencyId}-volume`}>Tool volume · {volume}%</label>
          <input
            id={`${frequencyId}-volume`}
            className="range-control"
            type="range"
            min={0}
            max={25}
            step={1}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
          <p className="field-hint">Output is capped at 25%. Your device volume still applies.</p>
        </div>

        <div className="button-row">
          {playing ? (
            <button className="button button--danger" type="button" onClick={() => stopTone(true)}>Stop tone</button>
          ) : (
            <button className="button button--primary" type="button" onClick={startTone}>Play tone</button>
          )}
        </div>

        <aside className="tool-callout tool-callout--warning" role="note">
          <strong>Protect your hearing.</strong>
          <span>Lower your device volume before playing. Stop immediately if the sound is uncomfortable. This is not a medical hearing test.</span>
        </aside>
        <p className="tool-status" role="status" aria-live="polite">{status}</p>
      </div>

      <div className={playing ? "tool-preview tone-preview tone-preview--playing" : "tool-preview tone-preview"}>
        <div className="preview-heading">
          <span>Oscillator</span>
          <span className={playing ? "status-dot status-dot--active" : "status-dot"} aria-hidden="true" />
        </div>
        <div className="tone-visual" aria-hidden="true">
          {Array.from({ length: 48 }, (_, index) => (
            <span key={index} style={{ "--wave-index": index } as React.CSSProperties} />
          ))}
        </div>
        <div className="tone-meta">
          <span>{waveform}</span>
          <span>{playing ? "Playing" : "Stopped"}</span>
        </div>
      </div>
    </div>
  );
}
