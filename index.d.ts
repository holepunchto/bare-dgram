import EventEmitter from 'bare-events'
import Buffer from 'bare-buffer'

export interface rinfo {
  address: string
  family: 'IPv4' | 'IPv6'
  port: number
  size: number
}

export class Socket extends EventEmitter<{
  close: []
  connect: []
  error: [Error]
  listening: []
  message: [string | Buffer, rinfo]
}> {
  constructor(opts?: { ipv6Only?: boolean; reuseAddress?: boolean })

  address(): { address: string; family: string; port: number } | null

  remoteAddress(): { address: string; family: string; port: number } | null

  bind(port: number, address: string, cb?: () => void): this
  bind(opts: { port?: number; address?: string }, cb?: () => void): this
  bind(port: number, cb?: () => void): this
  bind(cb?: () => void): this

  connect(port: number, address: string, cb?: () => void): void
  connect(port: number, cb?: () => void): void

  close(cb?: (err: Error) => void): Promise<void>

  send(
    msg: string | Buffer,
    offset: number,
    length: number,
    port?: number,
    address?: string,
    cb?: (err: Error) => void
  ): Promise<void>

  send(
    msg: string | Buffer,
    offset: number,
    length: number,
    port: number,
    cb: (err: Error) => void
  ): Promise<void>

  send(
    msg: string | Buffer,
    offset: number,
    length: number,
    address: string,
    cb: (err: Error) => void
  ): Promise<void>

  send(
    msg: string | Buffer,
    offset: number,
    address: string,
    cb: (err: Error) => void
  ): Promise<void>

  send(
    msg: string | Buffer,
    offset: number,
    length: number,
    cb: (err: Error) => void
  ): Promise<void>

  send(msg: string | Buffer, port: number, address: string): Promise<void>

  send(
    msg: string | Buffer,
    port: number,
    cb?: (err: Error) => void
  ): Promise<void>

  send(msg: string | Buffer, address: string): Promise<void>

  send(msg: string | Buffer, cb: (err: Error) => void): Promise<void>
}

export function createSocket(
  opts?: { ipv6Only?: boolean; reuseAddress?: boolean } | string,
  cb?: (message: Buffer, address: rinfo) => void
): Socket
