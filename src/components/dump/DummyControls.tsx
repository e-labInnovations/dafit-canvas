import { Bluetooth, BluetoothOff, RefreshCw } from 'lucide-react'
import type { DummyState } from '../../lib/renderFace'
import type { DummyStateN } from '../../lib/renderFaceN'

type Props = {
  dummy: DummyStateN
  onPatch: <K extends keyof DummyStateN>(key: K, value: DummyStateN[K]) => void
  onReset: () => void
  /** Maximum allowed value for the weatherIcon slider (count - 1). undefined hides it. */
  maxWeatherIcon?: number
}

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n))

const num = (e: React.ChangeEvent<HTMLInputElement>, fallback: number): number => {
  const n = parseInt(e.target.value, 10)
  return Number.isFinite(n) ? n : fallback
}

function DummyControls({ dummy, onPatch, onReset, maxWeatherIcon }: Props) {
  // patch helper for the base DummyState fields (a narrower type than DummyStateN)
  const patchBase = <K extends keyof DummyState>(key: K, value: DummyState[K]) =>
    onPatch(key as keyof DummyStateN, value as DummyStateN[keyof DummyStateN])

  return (
    <div className="dummy-controls">
      <div className="dummy-row">
        <label className="prop-field">
          <span>hour</span>
          <input
            type="number"
            min={0}
            max={23}
            value={dummy.hour}
            onChange={(e) => patchBase('hour', clamp(num(e, 0), 0, 23))}
          />
        </label>
        <label className="prop-field">
          <span>minute</span>
          <input
            type="number"
            min={0}
            max={59}
            value={dummy.minute}
            onChange={(e) => patchBase('minute', clamp(num(e, 0), 0, 59))}
          />
        </label>
        <label className="prop-field">
          <span>second</span>
          <input
            type="number"
            min={0}
            max={59}
            value={dummy.second}
            onChange={(e) => patchBase('second', clamp(num(e, 0), 0, 59))}
          />
        </label>
      </div>
      <div className="dummy-row">
        <label className="prop-field">
          <span>day</span>
          <input
            type="number"
            min={1}
            max={31}
            value={dummy.day}
            onChange={(e) => patchBase('day', clamp(num(e, 1), 1, 31))}
          />
        </label>
        <label className="prop-field">
          <span>month</span>
          <input
            type="number"
            min={1}
            max={12}
            value={dummy.month}
            onChange={(e) => patchBase('month', clamp(num(e, 1), 1, 12))}
          />
        </label>
        <label className="prop-field">
          <span>dow (0=Sun)</span>
          <input
            type="number"
            min={0}
            max={6}
            value={dummy.dow}
            onChange={(e) => patchBase('dow', clamp(num(e, 0), 0, 6))}
          />
        </label>
      </div>
      <div className="dummy-row">
        <label className="prop-field">
          <span>steps</span>
          <input
            type="number"
            min={0}
            value={dummy.steps}
            onChange={(e) => patchBase('steps', Math.max(0, num(e, 0)))}
          />
        </label>
        <label className="prop-field">
          <span>hr</span>
          <input
            type="number"
            min={0}
            value={dummy.hr}
            onChange={(e) => patchBase('hr', Math.max(0, num(e, 0)))}
          />
        </label>
        <label className="prop-field">
          <span>kcal</span>
          <input
            type="number"
            min={0}
            value={dummy.kcal}
            onChange={(e) => patchBase('kcal', Math.max(0, num(e, 0)))}
          />
        </label>
      </div>
      <div className="dummy-row">
        <label className="prop-field">
          <span>battery %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={dummy.battery}
            onChange={(e) => patchBase('battery', clamp(num(e, 0), 0, 100))}
          />
        </label>
        <label className="prop-field">
          <span>distance (0.1 km)</span>
          <input
            type="number"
            min={0}
            value={dummy.distance}
            onChange={(e) => patchBase('distance', Math.max(0, num(e, 0)))}
          />
        </label>
        {maxWeatherIcon !== undefined && maxWeatherIcon >= 0 && (
          <label className="prop-field">
            <span>weather icon</span>
            <input
              type="number"
              min={0}
              max={maxWeatherIcon}
              value={dummy.weatherIcon}
              onChange={(e) =>
                onPatch('weatherIcon', clamp(num(e, 0), 0, maxWeatherIcon))
              }
            />
          </label>
        )}
      </div>
      <div className="dummy-actions">
        <button
          type="button"
          className="counter ghost"
          onClick={() => patchBase('btConnected', !dummy.btConnected)}
          aria-pressed={dummy.btConnected}
        >
          {dummy.btConnected ? (
            <Bluetooth size={14} aria-hidden />
          ) : (
            <BluetoothOff size={14} aria-hidden />
          )}
          {dummy.btConnected ? 'BT connected' : 'BT off'}
        </button>
        <button type="button" className="counter ghost" onClick={onReset}>
          <RefreshCw size={14} aria-hidden />
          Now
        </button>
      </div>
    </div>
  )
}

export default DummyControls
