import EventEmitter from 'bare-events'

export class Socket extends EventEmitter {
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
    msg: unknown,
    offset: number,
    length: number,
    port?: number,
    address?: string,
    cb?: (err: Error) => void
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    length: number,
    port: number,
    cb: (err: Error) => void
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    length: number,
    address: string,
    cb: (err: Error) => void
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    address: string,
    cb: (err: Error) => void
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    length: number,
    cb: (err: Error) => void
  ): Promise<void>

  send(msg: unknown, port: number, address: string): Promise<void>

  send(msg: unknown, port: number, cb?: (err: Error) => void): Promise<void>

  send(msg: unknown, address: string): Promise<void>

  send(msg: unknown, cb: (err: Error) => void): Promise<void>
}

export function createSocket(
  opts?: { ipv6Only?: boolean; reuseAddress?: boolean } | string,
  cb?: (message: unknown) => void
): Socket
