// Moyoung / DaFit protocol opcodes + helpers.
// Sourced from Gadgetbridge's MoyoungConstants.java (upstream) and the
// krzys-h/Gadgetbridge-MT863 fork. See docs/research notes in the repo
// README for the full table; this file carries only opcodes the editor
// actually issues.

/** Outgoing command opcodes. Names mirror the Gadgetbridge constants so
 *  cross-referencing the Java source stays trivial. */
export const CMD = {
  // Special
  SHUTDOWN: 0x51,
  FIND_MY_WATCH: 0x61,
  FIND_MY_PHONE: 0x62,

  // Health triggers
  TRIGGER_HEARTRATE: 0x6d,
  TRIGGER_BLOOD_PRESSURE: 0x69,
  TRIGGER_BLOOD_OXYGEN: 0x6b,

  // Notifications + time
  SEND_MESSAGE: 0x41,
  SYNC_TIME: 0x31,

  // Weather
  SET_WEATHER_TODAY: 0x43,

  // Settings
  SET_GOAL_STEP: 0x16,
  QUERY_GOAL_STEP: 0x26,
  SET_TIME_SYSTEM: 0x17,
  SET_METRIC_SYSTEM: 0x1a,
  SET_DEVICE_LANGUAGE: 0x1b,
  SET_DISPLAY_WATCH_FACE: 0x19,

  // Incoming-only notification opcodes from the watch.
  NOTIFY_PHONE_OPERATION: 0x67,
} as const

/** Notification "type" byte sent as the first byte of CMD.SEND_MESSAGE's
 *  payload. Drives the watch's app-icon + colour for the notification. */
export const NOTIFICATION_TYPE = {
  CALL_OFF_HOOK: -1,
  CALL: 0,
  SMS: 1,
  WECHAT: 2,
  QQ: 3,
  FACEBOOK: 4,
  TWITTER: 5,
  INSTAGRAM: 6,
  SKYPE: 7,
  WHATSAPP: 8,
  LINE: 9,
  KAKAO: 10,
  OTHER: 11,
} as const

export type NotificationTypeName = keyof typeof NOTIFICATION_TYPE

/** Media operation byte the watch sends on CMD.NOTIFY_PHONE_OPERATION.
 *  Lets the UI translate the raw byte into a human label in the event log. */
export const MEDIA_OP = {
  0: 'Play / pause',
  1: 'Previous song',
  2: 'Next song',
  3: 'Reject incoming call',
  4: 'Volume up',
  5: 'Volume down',
  6: 'Play',
  7: 'Pause',
  12: 'Send current volume',
} as Record<number, string>

/** Build a SEND_MESSAGE payload: `[typeByte][utf-8 text]`. The watch
 *  truncates long messages at its own limit (model-dependent) so we don't
 *  enforce a length cap here. */
export const buildNotificationPayload = (
  type: number,
  text: string,
): Uint8Array => {
  const encoded = new TextEncoder().encode(text)
  const out = new Uint8Array(encoded.length + 1)
  // Signed byte (the upstream protocol uses -1 for call-off-hook); mask to
  // u8 so TypedArray accepts the negative value.
  out[0] = type & 0xff
  out.set(encoded, 1)
  return out
}

/** Encode a wall-clock time as a SYNC_TIME payload.
 *  Wire format: `[u32 LE seconds-since-watch-epoch][i8 timezone-byte=8]`.
 *
 *  The watch internally interprets its stored timestamp as seconds since
 *  1970-01-01 in **GMT+8** (the manufacturer's home timezone — hardcoded
 *  in Gadgetbridge as `WATCH_INTERNAL_TIME_ZONE`). To make the watch's
 *  displayed wall clock match the user's local clock, we re-encode the
 *  user's local calendar fields as if they were GMT+8, then subtract the
 *  fixed 8-hour offset.
 *
 *  The trailing tz byte is always **8** — Gadgetbridge hard-codes it that
 *  way, and sending a different value confuses the watch's "is today
 *  still today" check, which on some models causes the daily step counter
 *  to zero out. The timestamp already carries the wall-clock offset; the
 *  tz byte is only metadata.
 *
 *  Pass `now` to sync a specific moment instead of the current time. */
export const buildSyncTimePayload = (now: Date = new Date()): Uint8Array => {
  // Date.UTC interprets its args as UTC; feeding it the local components
  // gives us "this local wall clock, but tagged as UTC seconds". Subtract
  // 8h to convert that into the GMT+8-anchored epoch the watch expects.
  const localAsUtcSeconds = Math.floor(
    Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    ) / 1000,
  )
  const watchSeconds = (localAsUtcSeconds - 8 * 3600) >>> 0
  const out = new Uint8Array(5)
  const view = new DataView(out.buffer)
  // u32 BIG-endian. Java's `ByteBuffer.allocate(5).putInt(...)` defaults
  // to BIG_ENDIAN — same asymmetry as the SET_GOAL_STEP path. Sending LE
  // here makes the watch interpret the byte-swapped value as a 1990s
  // timestamp, which is what was producing "random" sync results.
  view.setUint32(0, watchSeconds, false)
  out[4] = 8
  return out
}

/** Weather condition codes the watch's UI knows how to render. The mapping
 *  is fixed in the firmware — sending an unknown code lands on a generic
 *  fallback icon. */
export const WEATHER = {
  CLOUDY: 0,
  FOGGY: 1,
  OVERCAST: 2,
  RAINY: 3,
  SNOWY: 4,
  SUNNY: 5,
  SANDSTORM: 6,
  HAZE: 7,
} as const

export type WeatherName = keyof typeof WEATHER

/** Build a SET_WEATHER_TODAY (0x43) payload. Layout:
 *
 *      byte 0 : 0 (no PM2.5 follows) — we always omit PM2.5 for simplicity
 *      byte 1 : condition ID (see WEATHER.*)
 *      byte 2 : temperature, signed °C
 *      bytes 3.. : city name encoded as UTF-16 big-endian, no BOM
 *
 *  The "lunar/festival" field exists on Chinese-region firmwares; we send
 *  an empty one (no bytes) which most watches treat as "skip". If your
 *  watch shows a blank lunar line, that field is what's missing. */
export const buildWeatherTodayPayload = (
  conditionId: number,
  tempC: number,
  city: string,
): Uint8Array => {
  // Java's "unicodebigunmarked" is UTF-16BE without a BOM. TextEncoder
  // can't emit UTF-16 directly, so encode manually.
  const cityBytes = utf16Be(city)
  const out = new Uint8Array(3 + cityBytes.length)
  out[0] = 0 // no PM2.5
  out[1] = conditionId & 0xff
  // Signed byte: clamp to [-128, 127] and cast to two's-complement.
  const t = Math.max(-128, Math.min(127, Math.round(tempC)))
  out[2] = t < 0 ? t + 256 : t
  out.set(cityBytes, 3)
  return out
}

const utf16Be = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    out[i * 2] = (code >> 8) & 0xff
    out[i * 2 + 1] = code & 0xff
  }
  return out
}

/** Most settings opcodes accept a single byte (0/1 flag, enum value, or
 *  small integer). Sugar over `new Uint8Array([n])` for readability. */
export const byte = (n: number): Uint8Array => new Uint8Array([n & 0xff])

/* Endianness on this protocol is deliberately asymmetric:
 *   - Outgoing SET / SYNC packets pack their multi-byte integers BIG-endian
 *     (Java's `ByteBuffer.allocate().putInt()` default — Gadgetbridge's
 *     `MoyoungSettingInt.encode` and `setTime` both rely on it).
 *   - Incoming QUERY responses read those same bytes back as LITTLE-endian
 *     (Gadgetbridge's `MoyoungSettingInt.decode` uses LITTLE_ENDIAN).
 * Sending a value with the wrong order makes the watch interpret a byte-
 * swapped number — e.g. sending the time LE landed on a 1991-ish date,
 * and sending the step goal LE landed on a huge bogus value.
 *
 * Only the upload-file PREP protocol (in moyoungBle.ts) uses BE both ways
 * end-to-end, matching the dawft Rust reference implementation. */

/** 4-byte big-endian u32 — use for any outgoing SET_* / SYNC_* command. */
export const u32be = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n >>> 0, false)
  return out
}

/** Decode a 4-byte u32 from a setting-query response (little-endian). */
export const readU32le = (data: Uint8Array): number | null => {
  if (data.length < 4) return null
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    0,
    true,
  )
}

/** Lookup table for human-friendly opcode names in the event log. Falls
 *  back to `"0xNN"` when the watch sends an opcode we don't recognise. */
export const opcodeName = (op: number): string => {
  switch (op) {
    case CMD.FIND_MY_PHONE:
      return 'Find my phone'
    case CMD.NOTIFY_PHONE_OPERATION:
      return 'Media control'
    case CMD.TRIGGER_HEARTRATE:
      return 'Heart rate'
    case CMD.TRIGGER_BLOOD_PRESSURE:
      return 'Blood pressure'
    case CMD.TRIGGER_BLOOD_OXYGEN:
      return 'SpO2'
    case CMD.SYNC_TIME:
      return 'Sync time'
    default:
      return `0x${op.toString(16).padStart(2, '0')}`
  }
}
