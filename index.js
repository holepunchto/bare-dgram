const UDX = require('udx-native')
const UDXSocket = require('udx-native/lib/socket')

const _udx = new UDX()

exports.createSocket = function createSocket (opts, cb) {
  if (typeof opts === 'string') opts = {} // ignore type signature ('udp4' or 'udp6')

  const socket = new Socket(opts)
  if (cb) socket.on('message', cb)

  return socket
}

const Socket = exports.Socket = class Socket extends UDXSocket {
  constructor (opts) {
    super(_udx, opts)
    this._connectedWith = { port: 0, address: '::' }
  }

  bind (port, address, cb) {
    if (typeof port === 'function') {
      cb = port
      port = null // don't set default values, udx will figure those out
      address = null
    } else if (typeof address === 'function') {
      cb = address
      address = null
    }

    if (typeof port === 'object' && port !== null) {
      const opts = port || {}
      port = opts.port || null
      address = opts.address || null
    }

    if (cb) this.once('listening', cb)

    super.bind(port, address)

    return this
  }

  connect (port, address, cb) {
    if (typeof port === 'function') {
      cb = port
      port = 0
      address = '127.0.0.1'
    } else if (typeof address === 'function') {
      cb = address
      address = '127.0.0.1'
    }

    // there's no connection operation here, actually
    this._connectedWith = { port, address }

    this.emit('connect')
    if (cb) cb()
  }

  send (msg, offset, length, port, address, cb) {
    // use info from the last simulated connection
    const defaultPort = this._connectedWith.port
    const defaultAddress = this._connectedWith.address

    if (typeof offset === 'function') {
      port = defaultPort
      address = defaultAddress
      cb = offset
    } else if (typeof length === 'function') {
      port = defaultPort
      address = defaultAddress
      cb = length
    } else if (typeof port === 'function') {
      port = defaultPort
      address = defaultAddress
      cb = port
    } else if (typeof address === 'function') {
      address = defaultAddress
      cb = address
    }

    if (!Buffer.isBuffer(msg)) msg = Buffer.from(msg)

    super.send(msg, port, address).then(() => {
      if (cb) cb()
    })
  }
}
