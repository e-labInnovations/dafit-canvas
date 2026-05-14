import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Battery,
  Bell,
  BellRing,
  Bluetooth,
  BluetoothOff,
  CalendarClock,
  Clock,
  CloudSun,
  Droplet,
  Footprints,
  Globe,
  Heart,
  MessageSquare,
  Plug,
  Power,
  Ruler,
  Search,
  Square,
  Unplug,
  Wind,
} from 'lucide-react'
import Tooltip from '../components/Tooltip'
import {
  MoyoungWatch,
  isWebBluetoothSupported,
  type DeviceInfo,
} from '../lib/moyoungBle'
import {
  CMD,
  MEDIA_OP,
  NOTIFICATION_TYPE,
  WEATHER,
  buildNotificationPayload,
  buildSyncTimePayload,
  buildWeatherTodayPayload,
  byte,
  opcodeName,
  readU32le,
  u32be,
  type NotificationTypeName,
  type WeatherName,
} from '../lib/moyoungProtocol'

type Status = 'idle' | 'connecting' | 'busy' | 'error'

type LogEntry = {
  id: number
  ts: number
  /** 'in' = packet received from watch; 'out' = command we sent;
   *  'info' = local UI event (connect, error, etc.). */
  dir: 'in' | 'out' | 'info'
  label: string
  detail?: string
}

const MAX_LOG_ENTRIES = 200

/** Render a Uint8Array as `aa bb cc` for the event log. Truncates after
 *  16 bytes so a stray big payload doesn't blow up the log row height. */
const hex = (data: Uint8Array, limit = 16): string => {
  if (data.length === 0) return '(empty)'
  const head = Array.from(data.slice(0, limit), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join(' ')
  return data.length > limit ? `${head} … (+${data.length - limit} more)` : head
}

const fmtTime = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

/** "YYYY-MM-DDTHH:MM" for an <input type="datetime-local"> initial value. */
const localDateTimeNow = (): string => {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function WatchConsole() {
  const supported = isWebBluetoothSupported()
  const watchRef = useRef<MoyoungWatch | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const logIdRef = useRef(0)

  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])

  // Form state.
  const [notifText, setNotifText] = useState(
    'Hello from the DaFit Canvas console!',
  )
  const [notifType, setNotifType] = useState<NotificationTypeName>('WHATSAPP')
  const [goalSteps, setGoalSteps] = useState('8000')
  const [faceSlot, setFaceSlot] = useState('0')
  const [customTime, setCustomTime] = useState<string>(localDateTimeNow())
  const [weatherCondition, setWeatherCondition] =
    useState<WeatherName>('SUNNY')
  const [weatherTemp, setWeatherTemp] = useState('25')
  const [weatherCity, setWeatherCity] = useState('Bengaluru')
  // Whether an HR measurement is currently in-flight. The watch sends
  // periodic update packets during the ~10-15 s reading; we track this so
  // the user can stop early via the explicit "Stop" button.
  const [hrMeasuring, setHrMeasuring] = useState(false)

  // Most-recent measurement results — set when the watch replies on the
  // corresponding TRIGGER opcode.
  const [hr, setHr] = useState<number | null>(null)
  const [spo2, setSpo2] = useState<number | null>(null)
  const [bp, setBp] = useState<{ sys: number; dia: number } | null>(null)
  // Last value the watch reported for its step goal (via QUERY_GOAL_STEP).
  // Distinct from the form input `goalSteps`, which is the *draft* the user
  // is typing — so reading the goal doesn't clobber a pending edit.
  const [currentGoal, setCurrentGoal] = useState<number | null>(null)

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      watchRef.current?.disconnect().catch(() => {})
      watchRef.current = null
    }
  }, [])

  const appendLog = (entry: Omit<LogEntry, 'id' | 'ts'>) => {
    setLog((prev) => {
      const next = [
        ...prev,
        { ...entry, id: ++logIdRef.current, ts: Date.now() },
      ]
      // Keep the log bounded so the page doesn't grow unbounded over a
      // long session. Older entries fall off the top.
      return next.length > MAX_LOG_ENTRIES
        ? next.slice(next.length - MAX_LOG_ENTRIES)
        : next
    })
  }

  const handleIncoming = (opcode: number, payload: Uint8Array) => {
    // Interpret the packet by opcode where we know the shape; everything
    // else falls through to a raw hex log line so unknown traffic is still
    // visible during exploration. Offsets come from Gadgetbridge's
    // MoyoungDeviceSupport.java handlePacket — verbatim.
    if (opcode === CMD.TRIGGER_HEARTRATE && payload.length >= 1) {
      const bpm = payload[0] & 0xff
      // BPM=0 is the watch saying "still measuring, no reading yet" — log
      // it but don't overwrite a prior good reading.
      if (bpm > 0) setHr(bpm)
      appendLog({
        dir: 'in',
        label: 'Heart rate',
        detail: bpm > 0 ? `${bpm} bpm` : 'measuring…',
      })
      return
    }
    if (opcode === CMD.TRIGGER_BLOOD_OXYGEN && payload.length >= 1) {
      const pct = payload[0] & 0xff
      if (pct > 0) setSpo2(pct)
      appendLog({
        dir: 'in',
        label: 'SpO2',
        detail: pct > 0 ? `${pct}%` : 'measuring…',
      })
      return
    }
    if (opcode === CMD.TRIGGER_BLOOD_PRESSURE && payload.length >= 3) {
      // payload[0] is a status byte ("measuring" vs "complete"); systolic
      // and diastolic live at offsets 1 and 2 (gadgetbridge).
      const sys = payload[1] & 0xff
      const dia = payload[2] & 0xff
      if (sys > 0 && dia > 0) setBp({ sys, dia })
      appendLog({
        dir: 'in',
        label: 'Blood pressure',
        detail: sys > 0 && dia > 0 ? `${sys} / ${dia} mmHg` : 'measuring…',
      })
      return
    }
    if (opcode === CMD.QUERY_GOAL_STEP) {
      const n = readU32le(payload)
      if (n !== null) {
        setCurrentGoal(n)
        appendLog({
          dir: 'in',
          label: 'Step goal',
          detail: `${n.toLocaleString()} steps`,
        })
      } else {
        appendLog({
          dir: 'in',
          label: 'Step goal',
          detail: `unparseable (${hex(payload)})`,
        })
      }
      return
    }
    if (opcode === CMD.FIND_MY_PHONE) {
      appendLog({
        dir: 'in',
        label: 'Find my phone',
        detail: 'Watch pressed the Find Phone button',
      })
      return
    }
    if (opcode === CMD.NOTIFY_PHONE_OPERATION && payload.length >= 1) {
      const op = payload[0]
      appendLog({
        dir: 'in',
        label: 'Media control',
        detail: MEDIA_OP[op] ?? `op = 0x${op.toString(16)}`,
      })
      return
    }
    appendLog({
      dir: 'in',
      label: opcodeName(opcode),
      detail: hex(payload),
    })
  }

  const handleConnect = async () => {
    if (!supported) return
    setError(null)
    setStatus('connecting')
    try {
      const watch = new MoyoungWatch()
      watch.onDisconnect(() => {
        unsubscribeRef.current?.()
        unsubscribeRef.current = null
        watchRef.current = null
        setDevice(null)
        setStatus('idle')
        appendLog({ dir: 'info', label: 'Disconnected' })
      })
      const info = await watch.connect()
      watchRef.current = watch
      const off = await watch.onPacket(handleIncoming)
      unsubscribeRef.current = off
      setDevice(info)
      setStatus('idle')
      appendLog({
        dir: 'info',
        label: 'Connected',
        detail: `${info.name} · ${info.software} · ${info.battery}%`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/user cancelled|user canceled|no device selected/i.test(message)) {
        setStatus('idle')
        return
      }
      setError(message)
      setStatus('error')
      appendLog({ dir: 'info', label: 'Connect failed', detail: message })
    }
  }

  const handleDisconnect = async () => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    await watchRef.current?.disconnect()
    watchRef.current = null
    setDevice(null)
    setStatus('idle')
  }

  const runCommand = async (
    label: string,
    opcode: number,
    payload?: Uint8Array,
    extraDetail?: string,
  ) => {
    const watch = watchRef.current
    if (!watch) return
    setError(null)
    setStatus('busy')
    try {
      await watch.sendCommand(opcode, payload)
      appendLog({
        dir: 'out',
        label,
        detail: extraDetail ?? (payload ? hex(payload) : undefined),
      })
      setStatus('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus('error')
      appendLog({ dir: 'info', label: `${label} failed`, detail: message })
    }
  }

  const onFindWatch = () =>
    runCommand('Find my watch', CMD.FIND_MY_WATCH)

  const onSyncNow = () => {
    const now = new Date()
    runCommand(
      'Sync time (now)',
      CMD.SYNC_TIME,
      buildSyncTimePayload(now),
      now.toLocaleString(),
    )
  }

  const onSyncCustomTime = () => {
    // <input type="datetime-local"> returns "YYYY-MM-DDTHH:MM[:SS]" in
    // the user's local timezone — Date(str) parses that as local time,
    // which is exactly what buildSyncTimePayload expects.
    if (!customTime) return
    const date = new Date(customTime)
    if (Number.isNaN(date.getTime())) return
    runCommand(
      'Sync time (custom)',
      CMD.SYNC_TIME,
      buildSyncTimePayload(date),
      date.toLocaleString(),
    )
  }

  const onSendNotif = () => {
    const text = notifText.trim()
    if (!text) return
    const type = NOTIFICATION_TYPE[notifType]
    runCommand(
      `Notification (${notifType})`,
      CMD.SEND_MESSAGE,
      buildNotificationPayload(type, text),
      `"${text}"`,
    )
  }

  const onSetGoal = () => {
    const n = parseInt(goalSteps, 10)
    if (!Number.isFinite(n) || n <= 0) return
    // Gadgetbridge's MoyoungSettingInt.encode uses BIG-endian for the SET
    // path. The response path reads back as little-endian (asymmetric by
    // design); we encode BE here, decode LE on the incoming side.
    runCommand('Set step goal', CMD.SET_GOAL_STEP, u32be(n), `${n} steps`)
  }

  const onQueryGoal = () =>
    runCommand('Read step goal', CMD.QUERY_GOAL_STEP)

  const onSetTimeSystem = (sys: 12 | 24) =>
    runCommand(
      `Set time system (${sys}h)`,
      CMD.SET_TIME_SYSTEM,
      byte(sys === 24 ? 1 : 0),
    )

  const onSetMetric = (metric: boolean) =>
    runCommand(
      `Set ${metric ? 'metric' : 'imperial'}`,
      CMD.SET_METRIC_SYSTEM,
      byte(metric ? 0 : 1),
    )

  const onSwitchFace = () => {
    const n = parseInt(faceSlot, 10)
    if (!Number.isFinite(n) || n < 0) return
    runCommand(
      `Switch face → slot ${n}`,
      CMD.SET_DISPLAY_WATCH_FACE,
      byte(n),
    )
  }

  // Gadgetbridge sends `[0x00]` to start the measurement and `[0xFF]` to
  // stop it early. The watch returns periodic update packets during the
  // ~10-15 s reading and a final value when it's done.
  const onTriggerHr = async () => {
    await runCommand('Start HR', CMD.TRIGGER_HEARTRATE, byte(0x00))
    setHrMeasuring(true)
  }
  const onStopHr = async () => {
    await runCommand('Stop HR', CMD.TRIGGER_HEARTRATE, byte(0xff))
    setHrMeasuring(false)
  }
  const onTriggerSpo2 = () =>
    runCommand('Start SpO2', CMD.TRIGGER_BLOOD_OXYGEN, byte(0x00))
  const onTriggerBp = () =>
    runCommand('Start BP', CMD.TRIGGER_BLOOD_PRESSURE, byte(0x00))

  const onSendWeather = () => {
    const temp = parseInt(weatherTemp, 10)
    if (!Number.isFinite(temp)) return
    const city = weatherCity.trim()
    const payload = buildWeatherTodayPayload(
      WEATHER[weatherCondition],
      temp,
      city,
    )
    runCommand(
      `Weather: ${weatherCondition.toLowerCase()} ${temp}°C`,
      CMD.SET_WEATHER_TODAY,
      payload,
      city ? `${city} · ${temp}°C` : `${temp}°C`,
    )
  }

  const onShutdown = () => {
    if (
      !window.confirm(
        'Power off the watch?\n\nThe watch will need to be powered back on by holding its side button. There is no remote power-on command.',
      )
    ) {
      return
    }
    runCommand('Shutdown', CMD.SHUTDOWN)
  }

  const connected = device !== null
  const disabled = !connected || status === 'busy'

  return (
    <section className="watch-console">
      <header className="faces-header">
        <h1>Watch console</h1>
        <p className="faces-endpoint">
          Live BLE playground over the MOYOUNG-V2 protocol. Pair a watch and
          send commands directly from the browser.
        </p>
      </header>

      {!supported && (
        <div className="banner banner-warn">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <strong>Web Bluetooth is not available.</strong> Use Chrome or
            Edge on desktop. Safari and Firefox do not implement{' '}
            <code>navigator.bluetooth</code>.
          </div>
        </div>
      )}

      <section className="console-section">
        <h2>Device</h2>
        {!connected ? (
          <button
            type="button"
            className="counter"
            onClick={handleConnect}
            disabled={!supported || status === 'connecting'}
          >
            <Bluetooth size={16} aria-hidden />
            {status === 'connecting' ? 'Connecting…' : 'Pair watch'}
          </button>
        ) : (
          <div className="device-card">
            <div className="device-row">
              <Plug size={16} aria-hidden />
              <strong>{device.name}</strong>
              <span className="device-tag">{device.manufacturer}</span>
            </div>
            <dl className="device-details">
              <dt>Software</dt>
              <dd>{device.software || '—'}</dd>
              <dt>
                <Battery size={14} aria-hidden /> Battery
              </dt>
              <dd>{device.battery}%</dd>
            </dl>
            <button
              type="button"
              className="counter ghost"
              onClick={handleDisconnect}
              disabled={status === 'busy'}
            >
              <Unplug size={16} aria-hidden />
              Disconnect
            </button>
          </div>
        )}
        {error && (
          <div className="banner banner-error">
            <BluetoothOff size={18} aria-hidden />
            <div>
              <strong>Error:</strong> {error}
            </div>
          </div>
        )}
      </section>

      <section className="console-section">
        <h2>Quick actions</h2>
        <div className="console-grid">
          <article className="console-card">
            <header>
              <BellRing size={16} aria-hidden />
              <h3>Find my watch</h3>
            </header>
            <p className="hint">
              Vibrates the watch and lights up the screen so you can locate
              it nearby.
            </p>
            <button
              type="button"
              className="counter"
              onClick={onFindWatch}
              disabled={disabled}
            >
              <Search size={14} aria-hidden />
              Buzz watch
            </button>
          </article>

          <article className="console-card">
            <header>
              <Clock size={16} aria-hidden />
              <h3>Sync time</h3>
            </header>
            <p className="hint">
              Pushes the wall-clock time to the watch. The watch's step
              counter resets at midnight on its own clock — pushing today's
              time keeps it intact.
            </p>
            <button
              type="button"
              className="counter"
              onClick={onSyncNow}
              disabled={disabled}
            >
              <Clock size={14} aria-hidden />
              Sync to current time
            </button>
            <label className="console-field">
              <span>Or set a custom time</span>
              <input
                type="datetime-local"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="counter ghost"
              onClick={onSyncCustomTime}
              disabled={disabled || !customTime}
            >
              <CalendarClock size={14} aria-hidden />
              Send custom time
            </button>
          </article>

          <article className="console-card">
            <header>
              <MessageSquare size={16} aria-hidden />
              <h3>Send notification</h3>
            </header>
            <label className="console-field">
              <span>Source</span>
              <select
                value={notifType}
                onChange={(e) =>
                  setNotifType(e.target.value as NotificationTypeName)
                }
              >
                {Object.keys(NOTIFICATION_TYPE).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="console-field">
              <span>Text</span>
              <textarea
                value={notifText}
                onChange={(e) => setNotifText(e.target.value)}
                rows={2}
              />
            </label>
            <button
              type="button"
              className="counter"
              onClick={onSendNotif}
              disabled={disabled || !notifText.trim()}
            >
              <Bell size={14} aria-hidden />
              Send
            </button>
          </article>
        </div>
      </section>

      <section className="console-section">
        <h2>Weather</h2>
        <p className="hint">
          Pushes today's weather to the watch face's weather widget. The
          condition + temperature are required; the city name is best-
          effort (some firmwares render only the condition icon).
        </p>
        <article className="console-card">
          <header>
            <CloudSun size={16} aria-hidden />
            <h3>Today</h3>
          </header>
          <label className="console-field">
            <span>Condition</span>
            <select
              value={weatherCondition}
              onChange={(e) =>
                setWeatherCondition(e.target.value as WeatherName)
              }
            >
              {Object.keys(WEATHER).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="console-field">
            <span>Temperature (°C)</span>
            <input
              type="number"
              min={-50}
              max={70}
              value={weatherTemp}
              onChange={(e) => setWeatherTemp(e.target.value)}
            />
          </label>
          <label className="console-field">
            <span>City</span>
            <input
              type="text"
              value={weatherCity}
              onChange={(e) => setWeatherCity(e.target.value)}
              placeholder="Bengaluru"
            />
          </label>
          <button
            type="button"
            className="counter"
            onClick={onSendWeather}
            disabled={disabled}
          >
            <CloudSun size={14} aria-hidden />
            Send weather
          </button>
        </article>
      </section>

      <section className="console-section">
        <h2>Measurements</h2>
        <p className="hint">
          Triggers a one-shot reading on the watch. The result arrives back
          over notify and lands in the event log below — measurements take
          a few seconds.
        </p>
        <div className="console-grid">
          <article className="console-card">
            <header>
              <Heart size={16} aria-hidden />
              <h3>Heart rate</h3>
            </header>
            <p className="console-result">
              {hr !== null ? (
                <>
                  <strong>{hr}</strong> bpm
                </>
              ) : (
                <span className="hint">No reading yet</span>
              )}
            </p>
            <div className="console-row">
              <button
                type="button"
                className="counter"
                onClick={onTriggerHr}
                disabled={disabled || hrMeasuring}
              >
                <Heart size={14} aria-hidden />
                {hrMeasuring ? 'Measuring…' : 'Start HR'}
              </button>
              {hrMeasuring && (
                <button
                  type="button"
                  className="counter ghost"
                  onClick={onStopHr}
                  disabled={disabled}
                >
                  <Square size={14} aria-hidden />
                  Stop
                </button>
              )}
            </div>
          </article>

          <article className="console-card">
            <header>
              <Wind size={16} aria-hidden />
              <h3>SpO2</h3>
            </header>
            <p className="console-result">
              {spo2 !== null ? (
                <>
                  <strong>{spo2}</strong> %
                </>
              ) : (
                <span className="hint">No reading yet</span>
              )}
            </p>
            <button
              type="button"
              className="counter"
              onClick={onTriggerSpo2}
              disabled={disabled}
            >
              <Wind size={14} aria-hidden />
              Trigger SpO2
            </button>
          </article>

          <article className="console-card">
            <header>
              <Droplet size={16} aria-hidden />
              <h3>Blood pressure</h3>
            </header>
            <p className="console-result">
              {bp !== null ? (
                <>
                  <strong>
                    {bp.sys} / {bp.dia}
                  </strong>{' '}
                  mmHg
                </>
              ) : (
                <span className="hint">No reading yet</span>
              )}
            </p>
            <button
              type="button"
              className="counter"
              onClick={onTriggerBp}
              disabled={disabled}
            >
              <Droplet size={14} aria-hidden />
              Trigger BP
            </button>
          </article>
        </div>
      </section>

      <section className="console-section">
        <h2>Settings</h2>
        <div className="console-grid">
          <article className="console-card">
            <header>
              <Footprints size={16} aria-hidden />
              <h3>Step goal</h3>
            </header>
            <p className="console-result">
              {currentGoal !== null ? (
                <>
                  <strong>{currentGoal.toLocaleString()}</strong> steps
                </>
              ) : (
                <span className="hint">Read to see current goal</span>
              )}
            </p>
            <label className="console-field">
              <span>Daily target</span>
              <input
                type="number"
                min={1000}
                step={500}
                value={goalSteps}
                onChange={(e) => setGoalSteps(e.target.value)}
              />
            </label>
            <p className="hint">
              The watch counts steps itself and resets at midnight on its
              own clock — there's no command in the MOYOUNG-V2 protocol to
              write the current step total from the phone.
            </p>
            <div className="console-row">
              <button
                type="button"
                className="counter"
                onClick={onSetGoal}
                disabled={disabled}
              >
                Save
              </button>
              <button
                type="button"
                className="counter ghost"
                onClick={onQueryGoal}
                disabled={disabled}
              >
                Read
              </button>
            </div>
          </article>

          <article className="console-card">
            <header>
              <Clock size={16} aria-hidden />
              <h3>Time system</h3>
            </header>
            <div className="console-row">
              <Tooltip content="Display time in 12-hour format">
                <button
                  type="button"
                  className="counter ghost"
                  onClick={() => onSetTimeSystem(12)}
                  disabled={disabled}
                >
                  12-hour
                </button>
              </Tooltip>
              <Tooltip content="Display time in 24-hour format">
                <button
                  type="button"
                  className="counter ghost"
                  onClick={() => onSetTimeSystem(24)}
                  disabled={disabled}
                >
                  24-hour
                </button>
              </Tooltip>
            </div>
          </article>

          <article className="console-card">
            <header>
              <Ruler size={16} aria-hidden />
              <h3>Units</h3>
            </header>
            <div className="console-row">
              <button
                type="button"
                className="counter ghost"
                onClick={() => onSetMetric(true)}
                disabled={disabled}
              >
                Metric
              </button>
              <button
                type="button"
                className="counter ghost"
                onClick={() => onSetMetric(false)}
                disabled={disabled}
              >
                Imperial
              </button>
            </div>
          </article>

          <article className="console-card">
            <header>
              <Globe size={16} aria-hidden />
              <h3>Active watch face</h3>
            </header>
            <label className="console-field">
              <span>Slot (0…N)</span>
              <input
                type="number"
                min={0}
                value={faceSlot}
                onChange={(e) => setFaceSlot(e.target.value)}
              />
            </label>
            <p className="hint">
              Slot indices are watch-specific. Slot 13 is the user-flashable
              gallery face.
            </p>
            <button
              type="button"
              className="counter"
              onClick={onSwitchFace}
              disabled={disabled}
            >
              Switch
            </button>
          </article>

          <article className="console-card console-card-danger">
            <header>
              <Power size={16} aria-hidden />
              <h3>Power off</h3>
            </header>
            <p className="hint">
              Tells the watch to shut down. You'll need to hold its side
              button to power it back on — there is no remote wake.
            </p>
            <button
              type="button"
              className="counter ghost danger"
              onClick={onShutdown}
              disabled={disabled}
            >
              <Power size={14} aria-hidden />
              Shutdown
            </button>
          </article>
        </div>
      </section>

      <section className="console-section">
        <div className="console-log-head">
          <h2>Event log</h2>
          <button
            type="button"
            className="counter ghost"
            onClick={() => setLog([])}
            disabled={log.length === 0}
          >
            Clear
          </button>
        </div>
        {log.length === 0 ? (
          <p className="hint">
            Connect to a watch, then send commands or interact with the
            watch (e.g. press its Find Phone button) to see traffic here.
          </p>
        ) : (
          <ol className="console-log">
            {log
              .slice()
              .reverse()
              .map((e) => (
                <li key={e.id} className={`console-log-row dir-${e.dir}`}>
                  <span className="console-log-time">{fmtTime(e.ts)}</span>
                  <span className="console-log-dir">
                    {e.dir === 'in' ? '←' : e.dir === 'out' ? '→' : '·'}
                  </span>
                  <span className="console-log-label">{e.label}</span>
                  {e.detail && (
                    <span className="console-log-detail">{e.detail}</span>
                  )}
                </li>
              ))}
          </ol>
        )}
      </section>
    </section>
  )
}

export default WatchConsole
