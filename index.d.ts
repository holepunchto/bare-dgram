import EventEmitter, { EventMap } from 'bare-events'
import Buffer from 'bare-buffer'
import { IPFamily, LookupOptions } from 'bare-dns'
import type { IPCAcceptable } from 'bare-pipe'
import DgramError from './lib/errors'
import constants from './lib/constants'

interface DNSLookup {
  (
    hostname: string,
    opts: LookupOptions,
    cb: (err: Error | null, address: string | null, family: IPFamily | 0) => void
  ): void
}

type DgramSocketType = 'udp4' | 'udp6'

interface DgramSocketAddress {
  address: string
  family: `IPv${IPFamily}`
  port: number
}

interface DgramRemoteInfo {
  address: string
  family: `IPv${IPFamily}`
  port: number
  size: number
}

interface DgramSocketEvents extends EventMap {
  close: []
  connect: []
  error: [err: Error]
  listening: []
  message: [message: Buffer, remote: DgramRemoteInfo]
}

interface DgramSocketOptions {
  ipv6Only?: boolean
  lookup?: DNSLookup
  readBufferSize?: number
  recvBufferSize?: number
  reuseAddr?: boolean
  reusePort?: boolean
  sendBufferSize?: number
  type?: DgramSocketType | null
}

interface DgramSocketBindOptions {
  address?: string
  fd?: number
  port?: number
}

interface DgramSocketConnectOptions {
  address?: string
  port?: number
}

interface DgramSocket<M extends DgramSocketEvents = DgramSocketEvents>
  extends EventEmitter<M>, IPCAcceptable {
  readonly type: DgramSocketType | null
  readonly bound: boolean
  readonly connected: boolean
  readonly closing: boolean
  readonly closed: boolean

  address(): DgramSocketAddress | null

  remoteAddress(): DgramSocketAddress | null

  bind(port?: number, address?: string, onlistening?: () => void): this
  bind(port: number, onlistening: () => void): this
  bind(opts: DgramSocketBindOptions, onlistening?: () => void): this
  bind(onlistening: () => void): this

  connect(port: number, address?: string, onconnect?: () => void): this
  connect(port: number, onconnect: () => void): this
  connect(opts: DgramSocketConnectOptions, onconnect?: () => void): this

  disconnect(): this

  send(
    msg: DgramMessage,
    offset: number,
    length: number,
    port?: number,
    address?: string,
    cb?: (err: Error | null, bytes: number) => void
  ): void
  send(
    msg: DgramMessage,
    offset: number,
    length: number,
    port: number,
    cb: (err: Error | null, bytes: number) => void
  ): void
  send(
    msg: DgramMessage,
    offset: number,
    length: number,
    cb?: (err: Error | null, bytes: number) => void
  ): void
  send(
    msg: DgramMessage,
    port: number,
    address?: string,
    cb?: (err: Error | null, bytes: number) => void
  ): void
  send(msg: DgramMessage, port: number, cb: (err: Error | null, bytes: number) => void): void
  send(msg: DgramMessage, cb?: (err: Error | null, bytes: number) => void): void

  setBroadcast(flag: boolean): void

  setTTL(ttl: number): number

  setMulticastTTL(ttl: number): number

  setMulticastLoopback(flag: boolean): boolean

  setMulticastInterface(iface: string): void

  addMembership(group: string, iface?: string | null): void

  dropMembership(group: string, iface?: string | null): void

  addSourceSpecificMembership(source: string, group: string, iface?: string | null): void

  dropSourceSpecificMembership(source: string, group: string, iface?: string | null): void

  getSendBufferSize(): number

  setSendBufferSize(size: number): void

  getRecvBufferSize(): number

  setRecvBufferSize(size: number): void

  getSendQueueSize(): number

  getSendQueueCount(): number

  pause(): this

  resume(): this

  close(onclose?: () => void): this

  ref(): this
  unref(): this
}

declare class DgramSocket<M extends DgramSocketEvents = DgramSocketEvents> extends EventEmitter<M> {
  constructor(
    opts?: DgramSocketOptions | DgramSocketType | null,
    onmessage?: (message: Buffer, remote: DgramRemoteInfo) => void
  )
  constructor(onmessage: (message: Buffer, remote: DgramRemoteInfo) => void)
}

type DgramMessage = string | Buffer | ArrayBufferView | (string | Buffer | ArrayBufferView)[]

declare function createSocket(
  opts?: DgramSocketOptions | DgramSocketType | null,
  onmessage?: (message: Buffer, remote: DgramRemoteInfo) => void
): DgramSocket

declare function createSocket(
  onmessage: (message: Buffer, remote: DgramRemoteInfo) => void
): DgramSocket

declare function isIP(host: string): IPFamily | 0

declare function isIPv4(host: string): boolean

declare function isIPv6(host: string): boolean

export {
  type DgramSocket,
  DgramSocket as Socket,
  createSocket,
  constants,
  type DgramError,
  DgramError as errors,
  type IPFamily,
  isIP,
  isIPv4,
  isIPv6,
  type DgramMessage,
  type DgramRemoteInfo,
  type DgramSocketAddress,
  type DgramSocketBindOptions,
  type DgramSocketConnectOptions,
  type DgramSocketEvents,
  type DgramSocketOptions,
  type DgramSocketType
}
