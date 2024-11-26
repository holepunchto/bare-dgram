const test = require('brittle')
const dgram = require('.')

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
      lc.is(msg.toString(), 'message', 'server recieved message')

      lc.ok(rinfo)
      lc.is(rinfo.address, '127.0.0.1')
      lc.is(rinfo.family, 'IPv4')
      lc.is(typeof rinfo.port, 'number')
      lc.is(rinfo.size, 7)
    })
    .bind(() => lc.pass('server binding completed'))

  await waitForServer(server)

  const client = dgram
    .createSocket('udp4')
    .on('close', () => t.pass('client closed'))
    .on('error', (err) => t.fail(err.message))
    .on('connect', () => {
      lc.pass('client connected')

      client.send('message', (err) => lc.absent(err))
    })

  client.connect(server.address().port, (err) => lc.absent(err))

  await lc

  client.close()
  server.close()
})

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    server.on('listening', done).on('error', done)

    function done(error) {
      server.off('listening', done).off('error', done)

      error ? reject(error) : resolve()
    }
  })
}
