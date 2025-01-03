import EventEmitter from 'bare-events'

export class Socket extends EventEmitter {
  constructor(opts?: { ipv6Only?: boolean; reuseAddress?: boolean })

  address(): { address: string; family: string; port: number } | null

  remoteAddress(): { address: string; family: string; port: number } | null

  bind(port: number, address: string, cb?: Function): this
  bind(opts: { port?: number; address?: string }, cb?: Function): this
  bind(port: number, cb?: Function): this
  bind(cb?: Function): this

  connect(port: number, address: string, cb?: Function): void
  connect(port: number, cb?: Function): void

  close(cb?: Function): Promise<void>

  send(
    msg: unknown,
    offset: number,
    length: number,
    port?: number,
    address?: string,
    cb?: Function
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    length: number,
    port: number,
    cb: Function
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    length: number,
    address: string,
    cb: Function
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    address: string,
    cb: Function
  ): Promise<void>

  send(
    msg: unknown,
    offset: number,
    length: number,
    cb: Function
  ): Promise<void>

  send(msg: unknown, port: number, address: string): Promise<void>

  send(msg: unknown, port: number, cb?: Function): Promise<void>

  send(msg: unknown, address: string): Promise<void>

  send(msg: unknown, cb: Function): Promise<void>
}

export function createSocket(
  opts?: { ipv6Only?: boolean; reuseAddress?: boolean } | string,
  cb?: Function
): Socket
