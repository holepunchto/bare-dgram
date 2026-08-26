const EventEmitter = require('bare-events')
const dns = require('bare-dns')
const binding = require('./binding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')
const ip = require('./lib/ip')

const defaultReadBufferSize = 65536
const empty = Buffer.alloc(0)

const ipcHandle = Symbol.for('bare.ipc.handle')
const ipcAccept = Symbol.for('bare.ipc.accept')

exports.Socket = class DgramSocket extends EventEmitter {
  constructor(opts = {}, onmessage) {
    if (typeof opts === 'string' || opts === null) {
      opts = { type: opts }
    } else if (typeof opts === 'function') {
      onmessage = opts
      opts = {}
    }

    super()

    const {
      type = 'udp4',
      readBufferSize = defaultReadBufferSize,
      reuseAddr = false,
      reusePort = false,
      ipv6Only = false,
      recvBufferSize = 0,
      sendBufferSize = 0,
      lookup = dns.lookup
    } = opts

    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)
    validateInteger(recvBufferSize, 'Receive buffer size', 0, 0x7fffffff)
    validateInteger(sendBufferSize, 'Send buffer size', 0, 0x7fffffff)

    this._type = type
    this._family = familyOf(type)

    this._state = 0
    this._flags = 0

    if (ipv6Only) this._flags |= constants.bind.IPV6ONLY
    if (reuseAddr) this._flags |= constants.bind.REUSEADDR
    if (reusePort) this._flags |= constants.bind.REUSEPORT

    this._lookup = lookup
    this._paused = false

    this._recvBufferSize = recvBufferSize
    this._sendBufferSize = sendBufferSize

    this._localAddress = null

    this._sends = new Map()
    this._sendId = 0

    this._pending = []

    this._buffer = Buffer.alloc(readBufferSize)

    this._handle = binding.init(
      this._buffer,
      this._family,
      this,
      this._onmessage,
      this._onsend,
      this._onclose
    )

    if (onmessage) this.on('message', onmessage)
  }

  get type() {
    return this._type
  }

  get bound() {
    return (this._state & constants.state.BOUND) !== 0
  }

  get connected() {
    return (this._state & constants.state.CONNECTED) !== 0
  }

  get closing() {
    return (this._state & constants.state.CLOSING) !== 0
  }

  get closed() {
    return (this._state & constants.state.CLOSED) !== 0
  }

  get [ipcHandle]() {
    return this._handle
  }

  address() {
    if ((this._state & constants.state.BOUND) === 0) return null

    const { address, family, port } = binding.address(this._handle, true)

    return { address, family: `IPv${family}`, port }
  }

  remoteAddress() {
    if ((this._state & constants.state.CONNECTED) === 0) return null

    const { address, family, port } = binding.address(this._handle, false)

    return { address, family: `IPv${family}`, port }
  }

  bind(port = 0, address = null, onlistening) {
    if (this._state & (constants.state.BINDING | constants.state.BOUND)) {
      throw errors.SOCKET_ALREADY_BOUND('Socket is already bound')
    }

    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) {
      throw errors.SOCKET_IS_CLOSED('Socket is closed')
    }

    if (typeof port === 'function') {
      onlistening = port
      port = 0
      address = null
    } else if (typeof address === 'function') {
      onlistening = address
      address = null
    }

    let fd = -1

    if (typeof port === 'object' && port !== null) {
      const opts = port

      port = opts.port || 0
      address = opts.address || null

      if (opts.fd !== undefined) {
        validateFd(opts.fd)

        fd = opts.fd
      }
    }

    if (fd === -1) {
      validatePort(port, true)

      if (address === null) address = this._wildcard()
      else validateHost(address, 'Address')
    }

    if (onlistening) this.once('listening', onlistening)

    this._state |= constants.state.BINDING

    if (fd !== -1) {
      try {
        binding.open(this._handle, fd)
      } catch (err) {
        return this._onbinderror(err)
      }

      this._onbind()

      return this
    }

    this._resolve(address, (err, address, family) => {
      if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return
      if (err) return this._onbinderror(err)

      try {
        binding.bind(this._handle, port, address, family, this._flags)
      } catch (err) {
        return this._onbinderror(err)
      }

      this._onbind()
    })

    return this
  }

  connect(port, address = null, onconnect) {
    if (this._state & (constants.state.CONNECTING | constants.state.CONNECTED)) {
      throw errors.SOCKET_ALREADY_CONNECTED('Socket is already connected')
    }

    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) {
      throw errors.SOCKET_IS_CLOSED('Socket is closed')
    }

    if (typeof address === 'function') {
      onconnect = address
      address = null
    }

    if (typeof port === 'object' && port !== null) {
      const opts = port

      port = opts.port || 0
      address = opts.address || null
    }

    validatePort(port)

    if (address === null) address = this._loopback()
    else validateHost(address, 'Address')

    if (onconnect) this.once('connect', onconnect)

    this._state |= constants.state.CONNECTING

    this._bindMaybe((err) => {
      if (err) {
        this._state &= ~constants.state.CONNECTING
        return
      }

      this._resolve(address, (err, address, family) => {
        this._state &= ~constants.state.CONNECTING

        if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return

        if (err === null) {
          try {
            binding.connect(this._handle, port, address, family)
          } catch (e) {
            err = e
          }
        }

        if (err) return queueMicrotask(() => this.emit('error', err))

        this._state |= constants.state.CONNECTED

        queueMicrotask(() => {
          if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return

          this.emit('connect')
        })
      })
    })

    return this
  }

  disconnect() {
    if ((this._state & constants.state.CONNECTED) === 0) {
      throw errors.SOCKET_NOT_CONNECTED('Socket is not connected')
    }

    binding.disconnect(this._handle)

    this._state &= ~constants.state.CONNECTED

    return this
  }

  send(buffer, offset, length, port, address, cb) {
    const connected = (this._state & constants.state.CONNECTED) !== 0

    if (connected) {
      if (typeof length === 'number') {
        buffer = sliceBuffer(buffer, offset, length)

        if (typeof port === 'function') {
          cb = port
          port = null
        }
      } else if (offset === undefined || typeof offset === 'function') {
        cb = offset
      } else {
        port = offset
      }

      if (port || address) {
        throw errors.SOCKET_ALREADY_CONNECTED(
          'Socket is connected, so port and address must be omitted'
        )
      }
    } else {
      if (address || (port && typeof port !== 'function')) {
        buffer = sliceBuffer(buffer, offset, length)
      } else {
        cb = port
        port = offset
        address = length
      }
    }

    let list

    if (Array.isArray(buffer)) {
      list = coerceBufferList(buffer)

      if (list === null) {
        throw errors.INVALID_ARGUMENT('Buffer list must contain strings or views')
      }

      if (list.length === 0) list = [empty]
    } else if (typeof buffer === 'string') {
      list = [Buffer.from(buffer)]
    } else if (ArrayBuffer.isView(buffer)) {
      list = [Buffer.coerce(buffer)]
    } else {
      throw errors.INVALID_ARGUMENT(`Buffer must be a string or a view, got ${typeof buffer}`)
    }

    if (connected) port = 0
    else validatePort(port)

    if (typeof cb !== 'function') cb = null

    if (typeof address === 'function') {
      cb = address
      address = null
    } else if (address) {
      validateHost(address, 'Address')
    }

    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) {
      throw errors.SOCKET_IS_CLOSED('Socket is closed')
    }

    let size = 0
    for (const buffer of list) size += buffer.byteLength

    this._bindMaybe((err) => {
      if (err) return cb && cb(err, 0)

      if (connected) return this._send(list, size, 0, null, 0, cb)

      this._resolve(address || this._loopback(), (err, address, family) => {
        if (err) return this._onsenderror(err, cb)

        if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) {
          return cb && cb(errors.SOCKET_IS_CLOSED('Socket is closed'), 0)
        }

        this._send(list, size, port, address, family, cb)
      })
    })
  }

  setBroadcast(flag) {
    flag = !!flag

    this._bound()

    binding.setBroadcast(this._handle, flag)
  }

  setTTL(ttl) {
    validateInteger(ttl, 'TTL', 0, 0xff)

    this._bound()

    binding.setTTL(this._handle, ttl)

    return ttl
  }

  setMulticastTTL(ttl) {
    validateInteger(ttl, 'TTL', 0, 0xff)

    this._bound()

    binding.setMulticastTTL(this._handle, ttl)

    return ttl
  }

  setMulticastLoopback(flag) {
    flag = !!flag

    this._bound()

    binding.setMulticastLoopback(this._handle, flag)

    return flag
  }

  setMulticastInterface(iface) {
    validateAddress(iface, 'Interface')

    this._bound()

    binding.setMulticastInterface(this._handle, iface)
  }

  addMembership(group, iface = null) {
    this._setMembership(group, iface, true)
  }

  dropMembership(group, iface = null) {
    this._setMembership(group, iface, false)
  }

  addSourceSpecificMembership(source, group, iface = null) {
    this._setSourceMembership(source, group, iface, true)
  }

  dropSourceSpecificMembership(source, group, iface = null) {
    this._setSourceMembership(source, group, iface, false)
  }

  getSendBufferSize() {
    this._bound()

    return binding.sendBufferSize(this._handle, 0)
  }

  setSendBufferSize(size) {
    validateInteger(size, 'Size', 1, 0x7fffffff)

    this._bound()

    binding.sendBufferSize(this._handle, size)
  }

  getRecvBufferSize() {
    this._bound()

    return binding.recvBufferSize(this._handle, 0)
  }

  setRecvBufferSize(size) {
    validateInteger(size, 'Size', 1, 0x7fffffff)

    this._bound()

    binding.recvBufferSize(this._handle, size)
  }

  getSendQueueSize() {
    this._alive()

    return binding.sendQueueSize(this._handle)
  }

  getSendQueueCount() {
    this._alive()

    return binding.sendQueueCount(this._handle)
  }

  pause() {
    this._paused = true

    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return this

    if (this._state & constants.state.READING) {
      this._state &= ~constants.state.READING

      binding.pause(this._handle)
    }

    return this
  }

  resume() {
    this._paused = false

    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return this

    this._bindMaybe((err) => {
      if (err === null) this._resume()
    })

    return this
  }

  close(onclose) {
    if (this._state & constants.state.CLOSED) {
      if (onclose) queueMicrotask(onclose)

      return this
    }

    if (onclose) this.once('close', onclose)

    if (this._state & constants.state.CLOSING) return this
    this._state |= constants.state.CLOSING
    this._state &= ~(
      constants.state.BINDING |
      constants.state.BOUND |
      constants.state.CONNECTING |
      constants.state.CONNECTED |
      constants.state.READING
    )

    binding.close(this._handle)

    return this
  }

  ref() {
    this._state &= ~constants.state.UNREFED

    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return this

    binding.ref(this._handle)

    return this
  }

  unref() {
    this._state |= constants.state.UNREFED

    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return this

    binding.unref(this._handle)

    return this
  }

  [ipcAccept]() {
    this._onbind()
  }

  _alive() {
    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) {
      throw errors.SOCKET_IS_CLOSED('Socket is closed')
    }
  }

  _bound() {
    this._alive()

    if ((this._state & constants.state.BOUND) === 0) {
      throw errors.SOCKET_NOT_BOUND('Socket is not bound')
    }
  }

  _setMembership(group, iface, join) {
    validateAddress(group, 'Group')
    if (iface !== null) validateAddress(iface, 'Interface')

    this._bound()

    binding.setMembership(this._handle, group, iface, join)
  }

  _setSourceMembership(source, group, iface, join) {
    validateAddress(source, 'Source')
    validateAddress(group, 'Group')
    if (iface !== null) validateAddress(iface, 'Interface')

    this._bound()

    binding.setSourceMembership(this._handle, group, source, iface, join)
  }

  _wildcard() {
    return this._family === 6 ? '::' : '0.0.0.0'
  }

  _loopback() {
    return this._family === 6 ? '::1' : '127.0.0.1'
  }

  _resolve(host, cb) {
    const family = ip.isIP(host)

    if (family !== 0) return cb(null, host, family)

    this._lookup(host, { family: this._family }, (err, address) => {
      if (!err) err = resolvedHostError(address)

      if (err) return cb(err, null, 0)

      cb(null, address, ip.isIP(address))
    })
  }

  _bindMaybe(fn) {
    if (this._state & constants.state.BOUND) return fn(null)

    this._pending.push(fn)

    if ((this._state & constants.state.BINDING) === 0) this.bind()
  }

  _flush(err) {
    const pending = this._pending
    this._pending = []

    for (const fn of pending) fn(err)
  }

  _resume() {
    if (this._paused) return
    if (this._state & constants.state.READING) return
    this._state |= constants.state.READING

    binding.resume(this._handle)
  }

  _send(list, size, port, address, family, cb) {
    const id = this._sendId
    this._sendId = (id + 1) % 0x100000000

    this._sends.set(id, { list, size, cb })

    try {
      binding.send(this._handle, id, list, port, address, family)
    } catch (err) {
      this._sends.delete(id)

      this._onsenderror(err, cb)
    }
  }

  _onsenderror(err, cb) {
    if (cb) return cb(err, 0)

    this.emit('error', err)
  }

  _onbind() {
    this._state |= constants.state.BOUND
    this._state &= ~constants.state.BINDING

    this._localAddress = binding.address(this._handle, true)

    if (this._family === 0) this._family = this._localAddress.family

    if (this._recvBufferSize) this.setRecvBufferSize(this._recvBufferSize)
    if (this._sendBufferSize) this.setSendBufferSize(this._sendBufferSize)

    this._resume()

    this._flush(null)

    queueMicrotask(() => {
      if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return

      this.emit('listening')
    })
  }

  _onbinderror(err) {
    queueMicrotask(() => {
      this._state &= ~constants.state.BINDING

      this._flush(err)

      if (this._state & constants.state.CLOSED) return

      this.emit('error', err)
    })

    return this
  }

  _onmessage(err, len, port, address, family) {
    if (err) {
      this.emit('error', err)
      return
    }

    const message = Buffer.allocUnsafe(len)
    message.set(this._buffer.subarray(0, len))

    this.emit('message', message, {
      address,
      family: `IPv${family}`,
      port,
      size: len
    })
  }

  _onsend(err, id) {
    const req = this._sends.get(id)

    if (req === undefined) return

    this._sends.delete(id)

    if (req.cb) return req.cb(err, err ? 0 : req.size)

    if (err === null) return
    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return

    this._onsenderror(err, null)
  }

  _onclose() {
    this._state |= constants.state.CLOSED
    this._state &= ~constants.state.CLOSING

    this._localAddress = null

    this._sends.clear()

    this._flush(errors.SOCKET_IS_CLOSED('Socket is closed'))

    this.emit('close')
  }
}

exports.constants = constants
exports.errors = errors

exports.isIP = ip.isIP
exports.isIPv4 = ip.isIPv4
exports.isIPv6 = ip.isIPv6

exports.createSocket = function createSocket(opts, onmessage) {
  return new exports.Socket(opts, onmessage)
}

function familyOf(type) {
  if (type === null) return 0
  if (type === 'udp4') return 4
  if (type === 'udp6') return 6

  throw errors.INVALID_SOCKET_TYPE(`Socket type must be 'udp4' or 'udp6', got ${type}`)
}

function sliceBuffer(buffer, offset, length) {
  if (typeof buffer === 'string') {
    buffer = Buffer.from(buffer)
  } else if (!ArrayBuffer.isView(buffer)) {
    throw errors.INVALID_ARGUMENT(`Buffer must be a string or a view, got ${typeof buffer}`)
  }

  offset = offset >>> 0
  length = length >>> 0

  if (offset > buffer.byteLength) {
    throw errors.INVALID_ARGUMENT('Offset is out of bounds')
  }

  if (offset + length > buffer.byteLength) {
    throw errors.INVALID_ARGUMENT('Length is out of bounds')
  }

  return Buffer.from(buffer.buffer, buffer.byteOffset + offset, length)
}

function coerceBufferList(list) {
  const result = new Array(list.length)

  for (let i = 0; i < list.length; i++) {
    const buffer = list[i]

    if (typeof buffer === 'string') {
      result[i] = Buffer.from(buffer)
    } else if (ArrayBuffer.isView(buffer)) {
      result[i] = Buffer.coerce(buffer)
    } else {
      return null
    }
  }

  return result
}

function resolvedHostError(address) {
  if (typeof address !== 'string') {
    return errors.INVALID_HOST(`Resolved address must be a string, got ${typeof address}`)
  }

  if (ip.isIP(address) === 0) {
    return errors.INVALID_HOST(`Resolved address must be an IP address, got "${address}"`)
  }

  const length = Buffer.byteLength(address)

  if (length > constants.address.MAX_LENGTH) {
    return errors.INVALID_HOST(
      `Resolved address must be at most ${constants.address.MAX_LENGTH} bytes, got ${length}`
    )
  }

  return null
}

function validateHost(host, name) {
  if (typeof host !== 'string') {
    throw errors.INVALID_HOST(`${name} must be a string, got ${typeof host}`)
  }

  if (ip.isIP(host) === 0) return

  validateAddressLength(host, name)
}

function validateAddress(address, name) {
  if (typeof address !== 'string') {
    throw errors.INVALID_HOST(`${name} must be a string, got ${typeof address}`)
  }

  validateAddressLength(address, name)
}

function validateAddressLength(address, name) {
  const length = Buffer.byteLength(address)

  if (length > constants.address.MAX_LENGTH) {
    throw errors.INVALID_HOST(
      `${name} must be at most ${constants.address.MAX_LENGTH} bytes, got ${length}`
    )
  }
}

function validatePort(port, allowZero = false) {
  if (typeof port !== 'number') {
    throw errors.INVALID_PORT(`Port must be a number, got ${typeof port}`)
  }

  const min = allowZero ? 0 : 1

  if (!Number.isInteger(port) || port < min || port > 0xffff) {
    throw errors.INVALID_PORT(`Port must be an integer between ${min} and 65535, got ${port}`)
  }
}

function validateFd(fd) {
  if (typeof fd !== 'number') {
    throw errors.INVALID_FD(`File descriptor must be a number, got ${typeof fd}`)
  }

  if (!Number.isInteger(fd) || fd < 0 || fd > 0x7fffffff) {
    throw errors.INVALID_FD(
      `File descriptor must be an integer between 0 and ${0x7fffffff}, got ${fd}`
    )
  }
}

function validateInteger(value, name, min, max) {
  if (typeof value !== 'number') {
    throw errors.INVALID_ARGUMENT(`${name} must be a number, got ${typeof value}`)
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    throw errors.INVALID_ARGUMENT(
      `${name} must be an integer between ${min} and ${max}, got ${value}`
    )
  }
}
