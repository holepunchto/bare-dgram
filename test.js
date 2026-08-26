const test = require('brittle')
const os = require('bare-os')
const dgram = require('.')

// Windows hands a UDP send to the kernel immediately and reports its real
// status once the loop picks up the completion, so a send is never cancelled by
// a close there.
const isWindows = Bare.platform === 'win32'

test('server + client', async (t) => {
  t.plan(3)

  const lc = t.test('lifecycle')
  lc.plan(12)

  const createSocketCb = (msg) => lc.ok(msg, 'createSocket callback')
  const server = dgram
    .createSocket('udp4', createSocketCb)
    .on('close', () => t.pass('server closed'))
    .on('error', (err) => t.fail(err.message))
    .on('listening', () => lc.pass('server listening'))
    .on('message', (msg, rinfo) => {
      lc.is(msg.toString(), 'message', 'server received message')

      lc.ok(rinfo)
      lc.is(rinfo.address, '127.0.0.1')
      lc.is(rinfo.family, 'IPv4')
      lc.is(typeof rinfo.port, 'number')
      lc.is(rinfo.size, 7)
    })
    .bind(() => lc.pass('server binding completed'))

  await waitForListening(server)

  const client = dgram
    .createSocket('udp4')
    .on('close', () => t.pass('client closed'))
    .on('error', (err) => t.fail(err.message))
    .on('connect', () => {
      lc.pass('client connected')

      client.send('message', (err) => lc.absent(err))
    })

  client.connect(server.address().port, () => lc.pass('client connect callback'))

  await lc

  client.close()
  server.close()
})

test('server + client, over IPv6', async (t) => {
  t.plan(3)

  const server = dgram.createSocket('udp6')

  server.on('message', (msg, rinfo) => {
    t.is(msg.toString(), 'hello')
    t.is(rinfo.family, 'IPv6')

    server.close()
    client.close()
  })

  server.bind(0, '::1')

  await waitForListening(server)

  t.is(server.address().family, 'IPv6')

  const client = dgram.createSocket('udp6')

  client.send('hello', server.address().port, '::1')
})

test('socket, invalid options', (t) => {
  t.exception(() => dgram.createSocket({ recvBufferSize: 'big' }), /INVALID_ARGUMENT/)
  t.exception(() => dgram.createSocket({ sendBufferSize: -1 }), /INVALID_ARGUMENT/)
  t.exception(() => dgram.createSocket({ readBufferSize: 0 }), /INVALID_ARGUMENT/)
  t.exception(() => dgram.createSocket({ readBufferSize: 1.5 }), /INVALID_ARGUMENT/)
})

test('socket, invalid type', (t) => {
  t.exception(() => dgram.createSocket('udp5'), /INVALID_SOCKET_TYPE/)
})

test('socket, type', (t) => {
  t.is(dgram.createSocket().type, 'udp4')
  t.is(dgram.createSocket('udp4').type, 'udp4')
  t.is(dgram.createSocket('udp6').type, 'udp6')
  t.is(dgram.createSocket({ type: 'udp6' }).type, 'udp6')
})

test('socket, unspecified type defers socket creation', async (t) => {
  const socket = dgram.createSocket({ type: null })

  t.is(socket.type, null)

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  t.is(socket.address().family, 'IPv4', 'family resolved from the bound socket')

  socket.close()
})

test('socket, buffer sizes from options', async (t) => {
  const socket = dgram.createSocket({ sendBufferSize: 1024 * 128, recvBufferSize: 1024 * 128 })

  socket.bind()

  await waitForListening(socket)

  t.ok(socket.getSendBufferSize() > 0)
  t.ok(socket.getRecvBufferSize() > 0)

  socket.close()
})

test('socket, address while not bound', (t) => {
  const socket = dgram.createSocket()

  t.is(socket.address(), null)
  t.is(socket.remoteAddress(), null)

  socket.close()
})

test('socket, address after close', async (t) => {
  const socket = dgram.createSocket()

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  t.ok(socket.address())

  socket.close()

  t.is(socket.address(), null)
  t.is(socket.remoteAddress(), null)
  t.absent(socket.bound)
})

test('socket, link local addresses keep their zone', async (t) => {
  const iface = linkLocalInterface()

  if (iface === null) {
    t.comment('no link local interface available')

    return
  }

  const host = `${iface.address}%${iface.name}`

  const socket = dgram.createSocket('udp6')

  socket.bind(0, host)

  await waitForListening(socket)

  // A link local address without its zone is ambiguous between interfaces, so
  // it has to survive the round trip through the binding.
  const { address } = socket.address()

  t.not(address.indexOf('%'), -1, 'the reported address carries a zone: ' + address)
  t.is(address.split('%')[0], iface.address, 'and is otherwise unchanged')

  const peer = dgram.createSocket('udp6')

  t.execution(() => peer.connect(socket.address().port, address), 'and is accepted back')

  peer.close()
  socket.close()
})

test('socket, connecting narrows the local address', async (t) => {
  const { server, client, port } = await pair(t)

  client.bind(0, '0.0.0.0')

  await waitForListening(client)

  t.is(client.address().address, '0.0.0.0')

  client.connect(port, '127.0.0.1')

  await waitForConnect(client)

  t.is(client.address().address, '127.0.0.1', 'local address narrowed to the route')

  server.close()
  client.close()
})

test('socket, bind to an ephemeral port', async (t) => {
  t.plan(4)

  const socket = dgram.createSocket()

  t.is(socket.address(), null, 'no address before binding')
  t.absent(socket.bound)

  socket.bind()

  await waitForListening(socket)

  t.ok(socket.bound)
  t.comment(JSON.stringify(socket.address()))
  t.ok(socket.address().port > 0, 'bound to an ephemeral port')

  socket.close()
})

test('socket, bind to a specific port', async (t) => {
  const a = dgram.createSocket()

  a.bind()

  await waitForListening(a)

  const port = a.address().port

  a.close()

  await waitForClose(a)

  const b = dgram.createSocket()

  b.bind(port, '127.0.0.1')

  await waitForListening(b)

  t.alike(b.address(), { address: '127.0.0.1', family: 'IPv4', port })

  b.close()
})

test('socket, bind with options', async (t) => {
  const socket = dgram.createSocket()

  socket.bind({ port: 0, address: '127.0.0.1' })

  await waitForListening(socket)

  t.is(socket.address().address, '127.0.0.1')

  socket.close()
})

test('socket, bind overloads', async (t) => {
  t.plan(3)

  // `new Socket(onmessage)` and `bind(port, onlistening)`.
  const server = new dgram.Socket((msg) => {
    t.is(msg.toString(), 'hello', 'constructor message listener')

    server.close()
    client.close()
  })

  server.bind(0, () => t.pass('bind(port, onlistening)'))

  await waitForListening(server)

  t.is(server.address().address, '0.0.0.0')

  const client = dgram.createSocket()

  client.send('hello', server.address().port, '127.0.0.1')
})

test('socket, bind to a hostname', async (t) => {
  const socket = dgram.createSocket()

  socket.bind(0, 'localhost')

  await waitForListening(socket)

  t.is(socket.address().family, 'IPv4')

  socket.close()
})

test('socket, bind while already bound', async (t) => {
  const socket = dgram.createSocket()

  socket.bind()

  await waitForListening(socket)

  t.exception(() => socket.bind(), /SOCKET_ALREADY_BOUND/)

  socket.close()
})

test('socket, bind after close', (t) => {
  const socket = dgram.createSocket()

  socket.close()

  t.exception(() => socket.bind(), /SOCKET_IS_CLOSED/)
})

test('socket, bind to a port already in use', async (t) => {
  t.plan(2)

  const a = dgram.createSocket()

  a.bind()

  await waitForListening(a)

  const b = dgram.createSocket()

  b.on('error', (err) => {
    t.is(err.code, 'EADDRINUSE')
    t.absent(b.bound)

    a.close()
    b.close()
  })

  b.bind(a.address().port, '0.0.0.0')
})

test('socket, bind with reuseAddr', async (t) => {
  const a = dgram.createSocket({ reuseAddr: true })

  a.bind(0, '127.0.0.1')

  await waitForListening(a)

  t.ok(a.address().port > 0)

  a.close()
})

test('socket, bind with a long hostname', async (t) => {
  t.plan(2)

  // Four 60 character labels: a legal DNS name, but far longer than the
  // binding's address buffer, which only has to hold the resolved address.
  const host = [1, 2, 3, 4].map(() => 'a'.repeat(60)).join('.')

  t.ok(Buffer.byteLength(host) > dgram.constants.address.MAX_LENGTH)

  const socket = dgram.createSocket({
    lookup(hostname, opts, cb) {
      t.is(hostname, host, 'the resolver receives the whole hostname')

      cb(null, '127.0.0.1', 4)
    }
  })

  socket.bind(0, host)

  await waitForListening(socket)

  socket.close()
})

test('socket, bind with a long IP literal', (t) => {
  const socket = dgram.createSocket()

  // `isIP` accepts an unbounded zone, so a literal can exceed the buffer.
  const literal = 'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255%' + 'e'.repeat(40)

  t.is(dgram.isIP(literal), 6, 'classified as a literal, so it is not resolved')
  t.exception(() => socket.bind(0, literal), /INVALID_HOST/)
  t.exception(() => socket.connect(1234, literal), /INVALID_HOST/)
  t.exception(() => socket.send('x', 1234, literal), /INVALID_HOST/)

  socket.close()
})

test('socket, bind at the IP literal length boundary', (t) => {
  const max = dgram.constants.address.MAX_LENGTH

  // Pinned to the binding's buffer rather than to a literal, so the test
  // follows the buffer if it ever changes.
  const at = 'fe80::1%' + 'e'.repeat(max - 8)
  const over = 'fe80::1%' + 'e'.repeat(max - 7)

  t.is(Buffer.byteLength(at), max)
  t.is(Buffer.byteLength(over), max + 1)

  const a = dgram.createSocket('udp6')
  a.on('error', () => {})

  t.execution(() => a.bind(0, at), 'exactly at the limit reaches the binding')

  a.close()

  const b = dgram.createSocket('udp6')

  t.exception(() => b.bind(0, over), /INVALID_HOST/)

  b.close()
})

test('socket, address is measured in bytes', async (t) => {
  const max = dgram.constants.address.MAX_LENGTH

  // Three bytes per character, so this passes a character count but not a byte
  // count. These paths are handed to the binding verbatim, with no resolution
  // step to shorten them.
  const wide = '€'.repeat(40)

  t.ok(wide.length <= max, 'would pass a character count')
  t.ok(Buffer.byteLength(wide) > max, 'but not a byte count')

  const socket = dgram.createSocket()

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  t.exception(() => socket.setMulticastInterface(wide), /INVALID_HOST/)
  t.exception(() => socket.addMembership(wide), /INVALID_HOST/)
  t.exception(() => socket.addSourceSpecificMembership(wide, '224.0.0.114'), /INVALID_HOST/)

  socket.close()
})

test('socket, over-long address on the unresolved paths', async (t) => {
  const max = dgram.constants.address.MAX_LENGTH

  t.ok(max > 45, 'long enough for an IPv6 address with a zone')

  const socket = dgram.createSocket()

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  // These are handed to the binding verbatim, so the cap is unconditional and
  // applies even to something that isn't an IP address.
  const over = 'e'.repeat(max + 1)

  t.exception(() => socket.setMulticastInterface(over), /INVALID_HOST/)
  t.exception(() => socket.addMembership(over), /INVALID_HOST/)
  t.exception(() => socket.dropMembership(over), /INVALID_HOST/)
  t.exception(() => socket.addSourceSpecificMembership(over, '224.0.0.114'), /INVALID_HOST/)

  socket.close()
})

test('socket, bind with malformed lookup results', async (t) => {
  const cases = [
    ['non-string address', (h, o, cb) => cb(null, 42, 4)],
    ['null result', (h, o, cb) => cb(null, null, null)],
    ['not an IP address', (h, o, cb) => cb(null, 'not-an-ip', 4)],
    ['over-long address', (h, o, cb) => cb(null, 'e'.repeat(500), 4)],
    [
      'over-long IP address',
      (h, o, cb) => cb(null, 'fe80::1%' + 'e'.repeat(dgram.constants.address.MAX_LENGTH), 6)
    ]
  ]

  t.plan(cases.length)

  for (const [name, lookup] of cases) {
    const socket = dgram.createSocket({ lookup })

    await new Promise((resolve) => {
      socket.on('error', (err) => {
        t.is(err.code, 'INVALID_HOST', name)

        socket.close(resolve)
      })

      socket.bind(0, 'example.invalid')
    })
  }
})

test('socket, bind tolerates an unusable family from the lookup', async (t) => {
  t.plan(1)

  // The family is derived locally from the address, so whatever the resolver
  // reports for it never reaches the binding.
  const socket = dgram.createSocket({
    lookup(hostname, opts, cb) {
      cb(null, '127.0.0.1', 'four')
    }
  })

  socket.bind(0, 'example.invalid')

  await waitForListening(socket)

  t.is(socket.address().address, '127.0.0.1', 'bound despite the reported family')

  socket.close()
})

test('socket, invalid address', (t) => {
  const socket = dgram.createSocket()

  t.exception(() => socket.bind(0, 42), /INVALID_HOST/)
  t.exception(() => socket.bind({ fd: 'x' }), /INVALID_FD/)
  t.exception(() => socket.bind({ fd: -1 }), /INVALID_FD/)
  t.exception(() => socket.bind({ fd: 1.5 }), /INVALID_FD/)
  t.exception(() => socket.connect(1234, 42), /INVALID_HOST/)
  t.exception(() => socket.send('hello', 1234, 42), /INVALID_HOST/)

  socket.close()
})

test('socket, invalid port', (t) => {
  const socket = dgram.createSocket()

  t.exception(() => socket.bind(-1), /INVALID_PORT/)
  t.exception(() => socket.bind(65536), /INVALID_PORT/)
  t.exception(() => socket.bind('1234'), /INVALID_PORT/)

  socket.close()
})

test('socket, port zero', async (t) => {
  const socket = dgram.createSocket()

  // Only bind may pick an ephemeral port.
  t.exception(() => socket.connect(0, '127.0.0.1'), /INVALID_PORT/)
  t.exception(() => socket.send('x', 0, '127.0.0.1'), /INVALID_PORT/)

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  t.ok(socket.address().port > 0)

  socket.close()
})

test('socket, close during a failing bind', async (t) => {
  t.plan(2)

  const held = dgram.createSocket()

  held.bind(0, '127.0.0.1')

  await waitForListening(held)

  const socket = dgram.createSocket()

  socket.on('error', (err) => t.is(err.code, 'EADDRINUSE'))

  // The bind fails while the error is still queued for delivery, so the close
  // lands before it is reported. Awaited through the callback rather than
  // `waitForClose`, which rejects on the 'error' this test expects.
  await new Promise((resolve) => {
    socket.bind(held.address().port, '127.0.0.1')
    socket.close(() => {
      t.pass('close callback is not stranded')

      resolve()
    })
  })

  held.close()
})

test('socket, work queued around a failing bind fails with it', async (t) => {
  t.plan(4)

  const held = dgram.createSocket()

  held.bind(0, '127.0.0.1')

  await waitForListening(held)

  const socket = dgram.createSocket()

  socket.on('error', (err) => t.is(err.code, 'EADDRINUSE', 'the bind error is reported'))

  // The bind fails before it returns, but the socket must not quietly bind
  // itself somewhere else to carry the send. Node reports the bind failure and
  // leaves the socket unbound, so the send has to fail with it.
  socket.bind(held.address().port, '127.0.0.1')

  socket.send('x', 9999, '127.0.0.1', (err) => t.is(err.code, 'EADDRINUSE', 'so does the send'))

  await new Promise((resolve) => setTimeout(resolve, 50))

  t.absent(socket.bound, 'the socket is not bound')
  t.is(socket.address(), null, 'and has no address of its own')

  socket.close()
  held.close()
})

test('socket, rejected arguments leave the socket usable', async (t) => {
  const cases = [
    ['invalid port', (s) => s.bind(-1)],
    ['invalid bind address', (s) => s.bind(0, 42)],
    ['invalid connect port', (s) => s.connect(0, '127.0.0.1')],
    ['invalid send address', (s) => s.send('x', 1234, 42)],
    ['invalid send message', (s) => s.send(42, 1234, '127.0.0.1')],
    ['invalid ttl', (s) => s.setTTL('x')],
    ['invalid group', (s) => s.addMembership(42)]
  ]

  for (const [name, bad] of cases) {
    const socket = dgram.createSocket()

    t.exception(bad.bind(null, socket), name + ' throws')

    socket.bind(0, '127.0.0.1')

    await waitForListening(socket)

    t.ok(socket.bound, 'still usable after ' + name)

    socket.close()

    await waitForClose(socket)
  }
})

test('socket, no listening or connect event after close', (t) => {
  t.plan(2)

  const a = dgram.createSocket()

  a.on('error', () => {})
  a.on('listening', () => t.fail('listening after close'))

  a.bind(0, '127.0.0.1', () => t.fail('onlistening after close'))
  a.close(() => t.pass('a closed without listening'))

  const b = dgram.createSocket()

  b.on('error', () => {})
  b.on('connect', () => t.fail('connect after close'))

  b.connect(1234, '127.0.0.1', () => t.fail('onconnect after close'))
  b.close(() => t.pass('b closed without connecting'))
})

test('socket, connect and disconnect', async (t) => {
  t.plan(6)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.is(msg.toString(), 'hello')

    t.ok(client.connected)
    t.alike(client.remoteAddress(), { address: '127.0.0.1', family: 'IPv4', port })

    client.disconnect()

    t.absent(client.connected)
    t.is(client.remoteAddress(), null)

    server.close()
    client.close()
  })

  client.connect(port, '127.0.0.1', () => {
    t.pass('connected')

    client.send('hello')
  })
})

test('socket, connect with options and after close', async (t) => {
  const server = dgram.createSocket()

  server.bind(0, '127.0.0.1')

  await waitForListening(server)

  const client = dgram.createSocket()

  client.connect({ port: server.address().port, address: '127.0.0.1' })

  await waitForConnect(client)

  t.is(client.remoteAddress().port, server.address().port, 'connect(options)')

  client.close()

  await waitForClose(client)

  t.exception(() => client.connect(1234, '127.0.0.1'), /SOCKET_IS_CLOSED/)

  server.close()
})

test('socket, connect while already connected', async (t) => {
  t.plan(1)

  const { server, client, port } = await pair(t)

  client.connect(port, '127.0.0.1', () => {
    t.exception(() => client.connect(port, '127.0.0.1'), /SOCKET_ALREADY_CONNECTED/)

    server.close()
    client.close()
  })
})

test('socket, connect twice in the same tick', async (t) => {
  const { server, client, port } = await pair(t)

  client.connect(port, '127.0.0.1')

  t.exception(() => client.connect(port, '127.0.0.1'), /SOCKET_ALREADY_CONNECTED/)

  await waitForConnect(client)

  server.close()
  client.close()
})

test('socket, disconnect while not connected', (t) => {
  const socket = dgram.createSocket()

  t.exception(() => socket.disconnect(), /SOCKET_NOT_CONNECTED/)

  socket.close()
})

test('socket, only receives from its peer while connected', async (t) => {
  t.plan(1)

  const a = dgram.createSocket()
  const b = dgram.createSocket()
  const c = dgram.createSocket()

  a.bind()
  b.bind()

  await waitForListening(a)
  await waitForListening(b)

  // `a` only accepts datagrams from `b`.
  a.connect(b.address().port, '127.0.0.1')

  await waitForConnect(a)

  a.on('message', (msg) => {
    t.is(msg.toString(), 'from b')

    a.close()
    b.close()
    c.close()
  })

  c.send('from c', a.address().port, '127.0.0.1')
  b.send('from b', a.address().port, '127.0.0.1')
})

test('socket, connect to the wrong family', (t) => {
  t.plan(1)

  const socket = dgram.createSocket('udp4')

  socket.on('error', (err) => {
    t.ok(err.code, 'reported ' + err.code)

    socket.close()
  })

  // A udp4 socket cannot connect to an IPv6 peer.
  socket.connect(1234, '::1')
})

test('socket, connect while a failing bind is in flight', async (t) => {
  t.plan(1)

  const held = dgram.createSocket()

  held.bind(0, '127.0.0.1')

  await waitForListening(held)

  const socket = dgram.createSocket()

  socket.on('error', (err) => t.is(err.code, 'EADDRINUSE'))

  // The connect queues behind a bind that is going to fail.
  socket.bind(held.address().port, '127.0.0.1')
  socket.connect(1234, '127.0.0.1')

  await new Promise((resolve) => setTimeout(resolve, 100))

  socket.close()
  held.close()
})

test('socket, connect queued behind an async bind failure', async (t) => {
  t.plan(2)

  // Deferred so that the connect queues while the bind is still in flight,
  // rather than triggering an implicit bind of its own.
  const socket = dgram.createSocket({
    lookup: (host, opts, cb) => setTimeout(() => cb(new Error('unresolvable')), 10)
  })

  socket.on('error', (err) => t.is(err.message, 'unresolvable'))
  socket.on('connect', () => t.fail('connected despite the bind failing'))

  socket.bind(0, 'unresolvable.invalid')
  socket.connect(1234, '127.0.0.1')

  await new Promise((resolve) => setTimeout(resolve, 100))

  t.absent(socket.connected, 'connect was abandoned with no state left behind')

  socket.close()
})

test('socket, connect fires its callback once when it binds implicitly', async (t) => {
  t.plan(3)

  const server = dgram.createSocket()

  server.bind(0, '127.0.0.1')

  await waitForListening(server)

  const client = dgram.createSocket()

  let listening = 0
  let connected = 0

  client.on('listening', () => listening++)
  client.on('connect', () => connected++)

  // Connecting an unbound socket re-enters bind() through _bindMaybe.
  client.connect(server.address().port, '127.0.0.1', () => t.pass('connect callback'))

  await waitForConnect(client)

  t.is(listening, 1, 'listening emitted once')
  t.is(connected, 1, 'connect emitted once')

  client.close()
  server.close()
})

test('socket, send binds implicitly', async (t) => {
  t.plan(3)

  const server = dgram.createSocket()

  server.on('message', (msg) => {
    t.is(msg.toString(), 'hello')

    server.close()
    client.close()
  })

  server.bind()

  await waitForListening(server)

  const client = dgram.createSocket()

  client.on('listening', () => t.pass('client bound implicitly'))

  client.send('hello', server.address().port, '127.0.0.1', (err, bytes) => {
    t.absent(err)
  })
})

test('socket, send with offset and length', async (t) => {
  t.plan(2)

  const { server, client, port } = await pair(t)

  server.on('message', (msg, rinfo) => {
    t.is(msg.toString(), 'ell')
    t.is(rinfo.size, 3)

    server.close()
    client.close()
  })

  client.send(Buffer.from('hello'), 1, 3, port, '127.0.0.1')
})

test('socket, send offset and length bounds', (t) => {
  const socket = dgram.createSocket()

  t.exception(() => socket.send(Buffer.alloc(4), 5, 1, 1234, '127.0.0.1'), /INVALID_ARGUMENT/)
  t.exception(() => socket.send(Buffer.alloc(4), 0, 8, 1234, '127.0.0.1'), /INVALID_ARGUMENT/)

  // A string is encoded before the range is applied.
  t.execution(() => socket.send('hello', 1, 3, 1234, '127.0.0.1'))

  socket.close()
})

test('socket, send a list of buffers', async (t) => {
  t.plan(1)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.is(msg.toString(), 'hello world')

    server.close()
    client.close()
  })

  client.send([Buffer.from('hello'), ' ', Buffer.from('world')], port, '127.0.0.1')
})

test('socket, send an empty buffer list', async (t) => {
  t.plan(2)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.is(msg.byteLength, 0)

    server.close()
    client.close()
  })

  client.send([], port, '127.0.0.1', (err) => t.absent(err))
})

test('socket, send a typed array', async (t) => {
  t.plan(1)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.alike([...msg], [1, 2, 3])

    server.close()
    client.close()
  })

  client.send(new Uint8Array([1, 2, 3]), port, '127.0.0.1')
})

test('socket, send a multi-byte typed array', async (t) => {
  t.plan(2)

  const { server, client, port } = await pair(t)

  // The view is measured in bytes, not elements, both on the wire and in the
  // byte count handed to the callback.
  const view = new Uint16Array([1, 2, 3, 4])

  server.on('message', (msg) => {
    t.alike([...msg], [1, 0, 2, 0, 3, 0, 4, 0])

    server.close()
    client.close()
  })

  client.send(view, port, '127.0.0.1', (err, bytes) => t.is(bytes, view.byteLength))
})

test('socket, send a data view', async (t) => {
  t.plan(1)

  const { server, client, port } = await pair(t)

  const view = new DataView(Uint8Array.from([1, 2, 3, 4]).buffer, 1, 2)

  server.on('message', (msg) => {
    t.alike([...msg], [2, 3])

    server.close()
    client.close()
  })

  client.send(view, port, '127.0.0.1')
})

test('socket, send a list of multi-byte views', async (t) => {
  t.plan(1)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.alike([...msg], [1, 0, 2, 3])

    server.close()
    client.close()
  })

  client.send(
    [new Uint16Array([1]), new DataView(Uint8Array.from([2, 3]).buffer)],
    port,
    '127.0.0.1'
  )
})

test('socket, send an empty message', async (t) => {
  t.plan(2)

  const { server, client, port } = await pair(t)

  server.on('message', (msg, rinfo) => {
    t.is(msg.byteLength, 0)
    t.is(rinfo.size, 0)

    server.close()
    client.close()
  })

  client.send(Buffer.alloc(0), port, '127.0.0.1')
})

test('socket, send to a hostname', async (t) => {
  t.plan(1)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.is(msg.toString(), 'hello')

    server.close()
    client.close()
  })

  client.send('hello', port, 'localhost')
})

test('socket, send overloads while connected', async (t) => {
  t.plan(2)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.is(msg.toString(), 'ell', 'offset and length while connected')

    server.close()
    client.close()
  })

  client.connect(port, '127.0.0.1', () => {
    t.pass('connected')

    // The connected branch with numeric offset and length, and a callback in
    // the port position.
    client.send(Buffer.from('hello'), 1, 3, () => {})
  })
})

test('socket, send with the callback in the address position', async (t) => {
  t.plan(2)

  const { server, client, port } = await pair(t)

  server.on('message', (msg) => {
    t.is(msg.toString(), 'hi')

    server.close()
    client.close()
  })

  client.send(Buffer.from('hi'), 0, 2, port, (err) => t.absent(err))
})

test('socket, send with a destination while connected', async (t) => {
  t.plan(1)

  const { server, client, port } = await pair(t)

  client.connect(port, '127.0.0.1', () => {
    t.exception(() => client.send('hello', port, '127.0.0.1'), /SOCKET_ALREADY_CONNECTED/)

    server.close()
    client.close()
  })
})

test('socket, send without a destination', (t) => {
  const socket = dgram.createSocket()

  t.exception(() => socket.send('hello'), /INVALID_PORT/)

  socket.close()
})

test('socket, send a message that is neither a string nor a view', (t) => {
  const socket = dgram.createSocket()

  // The offset and length form, which slices before the list is built.
  t.exception(() => socket.send(42, 0, 1, 1234, '127.0.0.1'), /INVALID_ARGUMENT/)
  t.exception(() => socket.send({}, 0, 1, 1234, '127.0.0.1'), /INVALID_ARGUMENT/)

  socket.close()
})

test('socket, send an invalid message', (t) => {
  const socket = dgram.createSocket()

  t.exception(() => socket.send(42, 1234, '127.0.0.1'), /INVALID_ARGUMENT/)
  t.exception(() => socket.send([42], 1234, '127.0.0.1'), /INVALID_ARGUMENT/)

  socket.close()
})

test('socket, concurrent sends', async (t) => {
  t.plan(11)

  const { server, client, port } = await pair(t)

  const seen = new Set()

  server.on('message', (msg) => {
    seen.add(msg.toString())

    t.pass('received ' + msg.toString())

    if (seen.size === 5) {
      t.is(seen.size, 5)

      server.close()
      client.close()
    }
  })

  for (let i = 0; i < 5; i++) {
    client.send(`message ${i}`, port, '127.0.0.1', (err) => t.absent(err))
  }
})

test('socket, send queue', async (t) => {
  const socket = dgram.createSocket()

  socket.bind()

  await waitForListening(socket)

  t.is(socket.getSendQueueSize(), 0)
  t.is(socket.getSendQueueCount(), 0)

  socket.close()
})

test('socket, truncated message', async (t) => {
  t.plan(1)

  const server = dgram.createSocket({ readBufferSize: 4 })
  const client = dgram.createSocket()

  server.on('error', (err) => {
    t.is(err.code, 'EMSGSIZE')

    server.close()
    client.close()
  })

  server.bind(0, '127.0.0.1')

  await waitForListening(server)

  client.send('too long for the read buffer', server.address().port, '127.0.0.1')
})

test('socket, send error without a callback', async (t) => {
  t.plan(1)

  const socket = dgram.createSocket()

  socket.on('error', (err) => {
    t.ok(err.code, 'emitted ' + err.code)

    socket.close()
  })

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  // Larger than the largest datagram, so it fails, and with no callback the
  // 'error' event is the only place it can surface. The socket is not closing,
  // which is the other half of the branch that suppresses this during teardown.
  socket.send(Buffer.alloc(70000), 1234, '127.0.0.1')
})

test('socket, send error with neither a callback nor a listener', async (t) => {
  t.plan(1)

  // A resolved address that isn't an IP address fails the send before it
  // reaches the binding. With no callback to report to and no 'error' listener
  // to emit to, the failure has to surface as an unhandled error rather than
  // being dropped.
  const lookup = (host, opts, cb) => cb(null, 'not-an-ip', 4)

  const socket = dgram.createSocket({ lookup })

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  await new Promise((resolve) => {
    Bare.once('uncaughtException', (err) => {
      t.is(err.code, 'INVALID_HOST', 'the failure was not swallowed')

      socket.close()

      resolve()
    })

    socket.send('x', 1234, 'host.invalid')
  })
})

test('socket, send failing synchronously in the binding', async (t) => {
  t.plan(2)

  // A udp4 socket cannot reach an IPv6 peer, and libuv rejects it before
  // queueing, so the binding throws rather than calling back.
  const withCallback = dgram.createSocket('udp4')

  withCallback.bind(0, '127.0.0.1')

  await waitForListening(withCallback)

  withCallback.send('x', 1234, '::1', (err) => {
    t.ok(err.code, 'reported to the callback: ' + err.code)

    withCallback.close()
  })

  const withEvent = dgram.createSocket('udp4')

  withEvent.on('error', (err) => {
    t.ok(err.code, 'reported to the event: ' + err.code)

    withEvent.close()
  })

  withEvent.bind(0, '127.0.0.1')

  await waitForListening(withEvent)

  withEvent.send('x', 1234, '::1')
})

test('socket, send with a failed lookup', async (t) => {
  t.plan(2)

  // A resolved address that isn't an IP address would be resolved again, and
  // again, so it fails the send rather than reaching the binding.
  const lookup = (host, opts, cb) => cb(null, 'not-an-ip', 4)

  const withCallback = dgram.createSocket({ lookup })

  withCallback.bind(0, '127.0.0.1')

  await waitForListening(withCallback)

  withCallback.send('x', 1234, 'host.invalid', (err) => {
    t.is(err.code, 'INVALID_HOST', 'reported to the callback')

    withCallback.close()
  })

  const withEvent = dgram.createSocket({ lookup })

  withEvent.on('error', (err) => {
    t.is(err.code, 'INVALID_HOST', 'reported to the event')

    withEvent.close()
  })

  withEvent.bind(0, '127.0.0.1')

  await waitForListening(withEvent)

  withEvent.send('x', 1234, 'host.invalid')
})

test('socket, send after close', (t) => {
  const socket = dgram.createSocket()

  socket.close()

  t.exception(() => socket.send('hello', 1234, '127.0.0.1'), /SOCKET_IS_CLOSED/)
})

test('socket, send cancelled by close', async (t) => {
  // Large enough that the sends are still queued when the socket closes, so the
  // cancellation path is exercised. The exact failure differs by platform, so
  // the control below asserts that the sends really do fail rather than
  // assuming a particular code.
  const payload = Buffer.alloc(60000)

  const reported = []

  const control = dgram.createSocket()

  control.bind(0, '127.0.0.1')

  await waitForListening(control)

  await new Promise((resolve) => {
    for (let i = 0; i < 4; i++) {
      control.send(payload, 1234, '127.0.0.1', (err) => reported.push(err && err.code))
    }

    control.close(resolve)
  })

  t.is(reported.length, 4, 'the close settled every send')

  if (!isWindows) {
    t.ok(
      reported.some((code) => code),
      'the sends really are failing, so the case below is not vacuous: ' + reported.join()
    )
  }

  const emitted = []

  const socket = dgram.createSocket()

  socket.on('error', (err) => emitted.push(err.code))

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  await new Promise((resolve) => {
    // No callback, so the 'error' event is the only place a failure could show.
    for (let i = 0; i < 4; i++) socket.send(payload, 1234, '127.0.0.1')

    socket.close(resolve)
  })

  t.alike(emitted, [], 'closing the socket reported nothing')
})

test('socket, close while resolving settles the send', (t) => {
  t.plan(1)

  const socket = dgram.createSocket()

  socket.send('hello', 9999, 'localhost', (err) => {
    t.is(err.code, 'SOCKET_IS_CLOSED')
  })

  socket.close()
})

test('socket, ttl and broadcast', async (t) => {
  const socket = dgram.createSocket()

  socket.bind()

  await waitForListening(socket)

  t.is(socket.setTTL(64), 64)
  t.is(socket.setMulticastTTL(1), 1)
  t.is(socket.setMulticastLoopback(true), true)
  t.execution(() => socket.setBroadcast(true))
  t.execution(() => socket.setBroadcast(false))

  socket.close()
})

test('socket, multicast membership', async (t) => {
  const socket = dgram.createSocket({ reuseAddr: true })

  socket.bind()

  await waitForListening(socket)

  t.execution(() => socket.addMembership('224.0.0.114', '127.0.0.1'))
  t.execution(() => socket.dropMembership('224.0.0.114', '127.0.0.1'))
  t.execution(() => socket.setMulticastInterface('127.0.0.1'))

  // Source specific membership is not supported on every platform, so accept a
  // reported failure and assert only that both directions behave alike.
  let added = null
  let dropped = null

  try {
    socket.addSourceSpecificMembership('127.0.0.1', '232.0.0.114', '127.0.0.1')
  } catch (err) {
    added = err.code
  }

  try {
    socket.dropSourceSpecificMembership('127.0.0.1', '232.0.0.114', '127.0.0.1')
  } catch (err) {
    dropped = err.code
  }

  t.is(added, dropped, `join and leave agree (${added})`)

  socket.close()
})

test('socket, buffer sizes', async (t) => {
  const socket = dgram.createSocket()

  socket.bind()

  await waitForListening(socket)

  socket.setSendBufferSize(1024 * 128)
  socket.setRecvBufferSize(1024 * 128)

  t.ok(socket.getSendBufferSize() > 0)
  t.ok(socket.getRecvBufferSize() > 0)

  socket.close()
})

test('socket, options before bind', (t) => {
  const socket = dgram.createSocket()

  // The underlying socket does not exist yet, so everything that reaches it is
  // rejected rather than failing differently per socket type.
  t.exception(() => socket.setBroadcast(true), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.setTTL(64), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.setMulticastTTL(1), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.setMulticastLoopback(true), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.setMulticastInterface('127.0.0.1'), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.addMembership('224.0.0.114'), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.dropMembership('224.0.0.114'), /SOCKET_NOT_BOUND/)
  t.exception(
    () => socket.addSourceSpecificMembership('127.0.0.1', '224.0.0.114'),
    /SOCKET_NOT_BOUND/
  )
  t.exception(
    () => socket.dropSourceSpecificMembership('127.0.0.1', '224.0.0.114'),
    /SOCKET_NOT_BOUND/
  )
  t.exception(() => socket.getSendBufferSize(), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.setSendBufferSize(1024), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.getRecvBufferSize(), /SOCKET_NOT_BOUND/)
  t.exception(() => socket.setRecvBufferSize(1024), /SOCKET_NOT_BOUND/)

  // The send queue is tracked by the handle rather than the socket, so it reads
  // back before the socket is bound.
  t.is(socket.getSendQueueSize(), 0)
  t.is(socket.getSendQueueCount(), 0)

  socket.close()
})

test('socket, options are validated before the socket is bound', async (t) => {
  const socket = dgram.createSocket()

  t.exception(() => socket.setTTL('64'), /INVALID_ARGUMENT/)
  t.exception(() => socket.addMembership(42), /INVALID_HOST/)

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  socket.close()
})

test('socket, invalid option arguments', async (t) => {
  const socket = dgram.createSocket()

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  t.exception(() => socket.setTTL('64'), /INVALID_ARGUMENT/)
  t.exception(() => socket.setTTL(256), /INVALID_ARGUMENT/)
  t.exception(() => socket.setMulticastTTL(null), /INVALID_ARGUMENT/)
  t.exception(() => socket.setSendBufferSize('big'), /INVALID_ARGUMENT/)
  t.exception(() => socket.setRecvBufferSize(0), /INVALID_ARGUMENT/)
  t.exception(() => socket.setMulticastInterface(42), /INVALID_HOST/)
  t.exception(() => socket.addMembership(42), /INVALID_HOST/)
  t.exception(() => socket.addMembership('224.0.0.114', 42), /INVALID_HOST/)
  t.exception(() => socket.addSourceSpecificMembership(42, 42), /INVALID_HOST/)

  socket.close()
})

test('socket, options after close', async (t) => {
  const socket = dgram.createSocket()

  socket.bind(0, '0.0.0.0')

  await waitForListening(socket)

  socket.close()

  // libuv silently recreates the socket if asked to set an option on a closing
  // handle, which then aborts once the handle finishes closing.
  t.exception(() => socket.addMembership('224.0.0.114'), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.dropMembership('224.0.0.114'), /SOCKET_IS_CLOSED/)
  t.exception(
    () => socket.addSourceSpecificMembership('127.0.0.1', '224.0.0.114'),
    /SOCKET_IS_CLOSED/
  )
  t.exception(() => socket.setTTL(64), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.setMulticastTTL(1), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.setMulticastLoopback(true), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.setBroadcast(true), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.setMulticastInterface('127.0.0.1'), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.getSendBufferSize(), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.setSendBufferSize(1024), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.getRecvBufferSize(), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.setRecvBufferSize(1024), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.getSendQueueSize(), /SOCKET_IS_CLOSED/)
  t.exception(() => socket.getSendQueueCount(), /SOCKET_IS_CLOSED/)
})

test('socket, pause and resume', async (t) => {
  t.plan(3)

  const { server, client, port } = await pair(t)

  server.pause()

  const received = []

  server.on('message', (msg) => {
    received.push(msg.toString())

    t.pass('received ' + msg.toString())

    if (received.length === 2) {
      t.alike(received, ['first', 'second'])

      server.close()
      client.close()
    }
  })

  client.send('first', port, '127.0.0.1', () => {
    setTimeout(() => {
      server.resume()

      client.send('second', port, '127.0.0.1')
    }, 100)
  })
})

test('socket, pause while a bind is in flight', async (t) => {
  t.plan(2)

  // The resume is queued behind the bind, so it must not undo the pause that
  // lands before the bind completes.
  const server = dgram.createSocket()

  let paused = true

  server.on('message', (msg) => {
    if (paused) return t.fail('received while paused')

    t.is(msg.toString(), 'first', 'the buffered datagram arrives on resume')

    server.close()
    client.close()
  })

  server.bind(0, 'localhost')
  server.resume()
  server.pause()

  await waitForListening(server)

  const client = dgram.createSocket()
  const port = server.address().port

  await new Promise((resolve) => client.send('first', port, '127.0.0.1', resolve))

  await new Promise((resolve) => setTimeout(resolve, 100))

  t.pass('nothing was delivered while paused')

  paused = false

  server.resume()
})

test('socket, ref and unref', (t) => {
  const socket = dgram.createSocket()

  t.is(socket.unref(), socket)
  t.is(socket.ref(), socket)

  socket.close()
})

test('socket, close is idempotent', (t) => {
  t.plan(1)

  const socket = dgram.createSocket()

  socket.on('close', () => t.pass('closed once'))

  socket.close()
  socket.close()
})

test('socket, close after close still calls back', async (t) => {
  t.plan(3)

  const socket = dgram.createSocket()

  socket.close(() => t.pass('first callback'))

  await waitForClose(socket)

  socket.close(() => t.pass('second callback'))
  socket.close(() => t.pass('third callback'))
})

test('socket, close callback after a completed close', async (t) => {
  t.plan(2)

  const socket = dgram.createSocket()

  socket.close()

  await waitForClose(socket)

  socket.close(() => {
    t.pass('callback still fires')
    t.is(socket.listenerCount('close'), 0, 'without leaking a listener')
  })
})

test('socket, repeated closes give one close event and every callback', async (t) => {
  t.plan(4)

  const socket = dgram.createSocket()

  socket.on('close', () => t.pass('closed exactly once'))

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  socket.close(() => t.pass('first callback'))
  socket.close(() => t.pass('second callback'))
  socket.close(() => t.pass('third callback'))
})

test('socket, close settles sends in flight', async (t) => {
  // Large enough that some sends are still queued when close() runs, so the
  // cancellation path is exercised rather than only the completed-send path.
  // This is what pins the ordering `_onclose`'s `_sends.clear()` relies on:
  // libuv flushes queued send requests before the close callback.
  const payload = Buffer.alloc(60000)

  const socket = dgram.createSocket()

  const order = []
  const settled = []

  socket.on('close', () => order.push('close'))

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  await new Promise((resolve) => {
    for (let i = 0; i < 4; i++) {
      socket.send(payload, 1234, '127.0.0.1', (err) => {
        settled.push(err ? err.code : null)
        order.push('send')
      })
    }

    socket.close(() => {
      order.push('callback')

      resolve()
    })
  })

  t.is(settled.length, 4, 'every send callback fired despite _sends.clear()')

  if (!isWindows) {
    t.ok(
      settled.some((code) => code !== null),
      'at least one send really was cancelled, so this is not vacuous: ' + settled.join()
    )
  }

  t.ok(order.indexOf('send') < order.indexOf('close'), 'sends settle before close is emitted')
})

test('socket, lifecycle methods are no-ops after close', async (t) => {
  const socket = dgram.createSocket()

  socket.bind(0, '127.0.0.1')

  await waitForListening(socket)

  socket.close()

  await waitForClose(socket)

  // Unlike the socket options, these must not throw during teardown.
  t.is(socket.pause(), socket)
  t.is(socket.resume(), socket)
  t.is(socket.ref(), socket)
  t.is(socket.unref(), socket)
})

test('isIP', (t) => {
  t.is(dgram.isIP('127.0.0.1'), 4)
  t.is(dgram.isIP('::1'), 6)
  t.is(dgram.isIP('localhost'), 0)
  t.ok(dgram.isIPv4('127.0.0.1'))
  t.ok(dgram.isIPv6('::1'))
})

function waitForListening(socket) {
  if (socket.bound) return Promise.resolve()

  return waitFor(socket, 'listening')
}

function waitForConnect(socket) {
  if (socket.connected) return Promise.resolve()

  return waitFor(socket, 'connect')
}

function waitForClose(socket) {
  if (socket.closed) return Promise.resolve()

  return waitFor(socket, 'close')
}

function waitFor(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.on(event, done).on('error', done)

    function done(err) {
      emitter.off(event, done).off('error', done)

      err ? reject(err) : resolve()
    }
  })
}

function linkLocalInterface() {
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses) {
      if (address.family === 'IPv6' && address.address.startsWith('fe80:')) {
        return { name, address: address.address }
      }
    }
  }

  return null
}

async function pair(t) {
  const server = dgram.createSocket()
  const client = dgram.createSocket()

  server.on('error', (err) => t.fail(err.message))
  client.on('error', (err) => t.fail(err.message))

  server.bind(0, '127.0.0.1')

  await waitForListening(server)

  return { server, client, port: server.address().port }
}
