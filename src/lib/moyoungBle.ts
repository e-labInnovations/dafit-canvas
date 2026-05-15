// Web Bluetooth client for MO YOUNG / DA FIT smartwatches.
// Protocol mirrors https://github.com/david47k/dawfu (btleplug-based Rust CLI).
// Generic command framing matches Gadgetbridge's MoyoungPacketOut.buildPacket:
//   bytes 0..1: 0xFE 0xEA
//   bytes 2..3: size (high byte: 0x20 + (len>>8), low byte: len & 0xff)
//   byte 4    : opcode
//   bytes 5+  : payload
// No checksum. Notify char delivers replies in the same shape.

const MOYOUNG_SERVICE = 0xfeea
const SEND_CHAR = 0xfee2 // write w/o response — control commands
const SENDFILE_CHAR = 0xfee6 // write w/o response — chunk payload
const NOTIFY_CHAR = 0xfee3 // notify — watch acks

const DEVINFO_SERVICE = 0x180a
const MANUFACTURER_CHAR = 0x2a29
const SOFTREV_CHAR = 0x2a28
// 0x2a25 (Serial Number) is on the Web Bluetooth blocklist (exclude-reads)
// for privacy reasons, so we can't read it from a browser.

const BATTERY_SERVICE = 0x180f
const BATTERY_CHAR = 0x2a19

const CHUNK_SIZE = 244
const SLOT_GALLERY = 0x74 // file slot 116 = 103 + 13 (Watch Gallery)

const REQUIRED_MANUFACTURER = 'MOYOUNG-V2'

const PREP_HEADER = [0xfe, 0xea, 0x20, 0x09, SLOT_GALLERY] as const
const READY_HEADER = [0xfe, 0xea, 0x20, 0x07, SLOT_GALLERY] as const
const APPLY_FACE_GALLERY = [0xfe, 0xea, 0x20, 0x06, 0x19, 0x0d] as const

export type DeviceInfo = {
  name: string
  manufacturer: string
  software: string
  battery: number
}

export type UploadProgress = {
  bytesSent: number
  totalBytes: number
  chunkIndex: number
  totalChunks: number
}

export type UploadResult = {
  checksum: number
  totalBytes: number
}

export const isWebBluetoothSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator

const decodeText = (view: DataView): string =>
  new TextDecoder('utf-8').decode(view).replace(/\0+$/, '')

const headerEquals = (a: Uint8Array, header: readonly number[]): boolean => {
  if (a.length < header.length) return false
  for (let i = 0; i < header.length; i++) if (a[i] !== header[i]) return false
  return true
}

export class MoyoungWatch {
  private device: BluetoothDevice | null = null
  private send: BluetoothRemoteGATTCharacteristic | null = null
  private sendFile: BluetoothRemoteGATTCharacteristic | null = null
  private notify: BluetoothRemoteGATTCharacteristic | null = null
  private onDisconnectCb: (() => void) | null = null

  async connect(): Promise<DeviceInfo> {
    if (!isWebBluetoothSupported()) {
      throw new Error(
        'Web Bluetooth is not supported in this browser. Use Chrome or Edge on desktop, served over HTTPS or localhost.',
      )
    }

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [MOYOUNG_SERVICE, DEVINFO_SERVICE, BATTERY_SERVICE],
    })

    if (!device.gatt) {
      throw new Error('Selected device exposes no GATT server.')
    }

    device.addEventListener('gattserverdisconnected', this.handleDisconnect)
    const server = await device.gatt.connect()

    // Android Chrome's BLE stack serializes GATT operations strictly —
    // issuing multiple `getPrimaryService` / `getCharacteristic` /
    // `readValue` calls in parallel via `Promise.all` returns
    // "GATT operation failed for unknown reason" on the second one.
    // Desktop Chrome tolerates concurrent reads, but the safe baseline
    // (and what the spec actually requires of implementations) is
    // sequential `await`s — slightly slower on desktop, but identical
    // behaviour across platforms.
    const info = await server.getPrimaryService(DEVINFO_SERVICE)
    const battery = await server.getPrimaryService(BATTERY_SERVICE)
    const moyoung = await server.getPrimaryService(MOYOUNG_SERVICE)

    const manufacturerChar = await info.getCharacteristic(MANUFACTURER_CHAR)
    const softChar = await info.getCharacteristic(SOFTREV_CHAR)
    const batteryChar = await battery.getCharacteristic(BATTERY_CHAR)
    const send = await moyoung.getCharacteristic(SEND_CHAR)
    const sendFile = await moyoung.getCharacteristic(SENDFILE_CHAR)
    const notify = await moyoung.getCharacteristic(NOTIFY_CHAR)

    const manufacturer = decodeText(await manufacturerChar.readValue())
    const software = decodeText(await softChar.readValue())
    const batteryValue = (await batteryChar.readValue()).getUint8(0)

    if (manufacturer !== REQUIRED_MANUFACTURER) {
      device.gatt.disconnect()
      throw new Error(
        `Unsupported device. Manufacturer is "${manufacturer}", expected "${REQUIRED_MANUFACTURER}".`,
      )
    }

    this.device = device
    this.send = send
    this.sendFile = sendFile
    this.notify = notify

    return {
      name: device.name ?? '(unknown)',
      manufacturer,
      software,
      battery: batteryValue,
    }
  }

  onDisconnect(cb: (() => void) | null): void {
    this.onDisconnectCb = cb
  }

  async uploadWatchFace(
    file: ArrayBuffer,
    onProgress?: (p: UploadProgress) => void,
  ): Promise<UploadResult> {
    const send = this.send
    const sendFile = this.sendFile
    const notify = this.notify
    if (!send || !sendFile || !notify) {
      throw new Error('Not connected.')
    }

    const totalBytes = file.byteLength
    if (totalBytes === 0) throw new Error('File is empty.')
    const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE)
    const fileBytes = new Uint8Array(file)

    await notify.startNotifications()

    return new Promise<UploadResult>((resolve, reject) => {
      let expectedChunk = 0
      let settled = false

      const cleanup = () => {
        notify.removeEventListener('characteristicvaluechanged', onValue)
        notify.stopNotifications().catch(() => {})
      }

      const fail = (err: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
      }

      const succeed = (result: UploadResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const onValue = (event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic
        const view = target.value
        if (!view) return
        const data = new Uint8Array(
          view.buffer,
          view.byteOffset,
          view.byteLength,
        )

        // Watch finished receiving the file → checksum at bytes 5..8 (BE u32).
        if (headerEquals(data, PREP_HEADER) && data.length >= 9) {
          const checksum =
            ((data[5] << 24) | (data[6] << 16) | (data[7] << 8) | data[8]) >>> 0
          ;(async () => {
            try {
              await send.writeValueWithoutResponse(
                new Uint8Array([...PREP_HEADER, 0x00, 0x00, 0x00, 0x00]),
              )
              await send.writeValueWithoutResponse(
                new Uint8Array(APPLY_FACE_GALLERY),
              )
              succeed({ checksum, totalBytes })
            } catch (err) {
              fail(err)
            }
          })()
          return
        }

        // Watch ready for chunk N → bytes 5..6 carry chunk index (BE u16).
        if (headerEquals(data, READY_HEADER) && data.length >= 7) {
          const chunkNum = (data[5] << 8) | data[6]
          if (chunkNum !== expectedChunk) {
            console.warn(
              `[moyoung] expected chunk ${expectedChunk}, watch asked for ${chunkNum}`,
            )
          }
          expectedChunk = chunkNum + 1
          const start = chunkNum * CHUNK_SIZE
          if (start >= totalBytes) {
            fail(new Error(`Watch requested chunk ${chunkNum} past end of file`))
            return
          }
          const end = Math.min(start + CHUNK_SIZE, totalBytes)
          const chunk = fileBytes.subarray(start, end)
          ;(async () => {
            try {
              await sendFile.writeValueWithoutResponse(chunk)
              onProgress?.({
                bytesSent: end,
                totalBytes,
                chunkIndex: chunkNum + 1,
                totalChunks,
              })
            } catch (err) {
              fail(err)
            }
          })()
          return
        }

        console.warn(
          '[moyoung] unexpected notification:',
          Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' '),
        )
      }

      notify.addEventListener('characteristicvaluechanged', onValue)

      // Send prep command: PREP_HEADER + size as BE u32.
      const prep = new Uint8Array(9)
      prep.set(PREP_HEADER)
      new DataView(prep.buffer).setUint32(5, totalBytes, false)
      send.writeValueWithoutResponse(prep).catch(fail)
    })
  }

  /** Build and send a generic Moyoung control packet on the SEND char.
   *  Payload defaults to empty (for opcodes like FIND_MY_WATCH that take
   *  no arguments). Throws if not connected. */
  async sendCommand(
    opcode: number,
    payload: Uint8Array = new Uint8Array(0),
  ): Promise<void> {
    const send = this.send
    if (!send) throw new Error('Not connected.')
    const total = payload.length + 5
    const packet = new Uint8Array(total)
    packet[0] = 0xfe
    packet[1] = 0xea
    // Use the MTU>20 size encoding (matches the existing upload flow:
    // byte[2] = 0x20 + (len>>8), byte[3] = len & 0xff). On Web Bluetooth
    // the negotiated MTU is generally well above 20 so this is the safe
    // default; if a watch insists on MTU=20 framing it can be added later.
    packet[2] = (0x20 + ((total >> 8) & 0xff)) & 0xff
    packet[3] = total & 0xff
    packet[4] = opcode & 0xff
    packet.set(payload, 5)
    await send.writeValueWithoutResponse(packet)
  }

  /** Subscribe to incoming control packets from the watch. The handler
   *  receives the parsed (opcode, payload) pair so callers don't have to
   *  re-decode the framing each time. `startNotifications` is called once
   *  per subscriber — Web Bluetooth allows multiple listeners on the same
   *  characteristic, and the upload flow uses its own listener in parallel
   *  without conflict. Returns an unsubscribe function. */
  async onPacket(
    handler: (opcode: number, payload: Uint8Array) => void,
  ): Promise<() => void> {
    const notify = this.notify
    if (!notify) throw new Error('Not connected.')
    await notify.startNotifications()
    const listener = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic
      const view = target.value
      if (!view) return
      const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      // Drop anything that doesn't carry the Moyoung header — upload acks
      // share this framing too, but checking lets us ignore stray fragments
      // from other Web Bluetooth clients on the same characteristic.
      if (data.length < 5 || data[0] !== 0xfe || data[1] !== 0xea) return
      handler(data[4], data.subarray(5))
    }
    notify.addEventListener('characteristicvaluechanged', listener)
    return () => {
      notify.removeEventListener('characteristicvaluechanged', listener)
    }
  }

  async disconnect(): Promise<void> {
    const device = this.device
    this.device = null
    this.send = null
    this.sendFile = null
    this.notify = null
    if (device) {
      device.removeEventListener('gattserverdisconnected', this.handleDisconnect)
      if (device.gatt?.connected) device.gatt.disconnect()
    }
  }

  private handleDisconnect = () => {
    this.send = null
    this.sendFile = null
    this.notify = null
    this.onDisconnectCb?.()
  }
}
