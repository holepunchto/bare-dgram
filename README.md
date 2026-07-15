# bare-dgram

Native UDP for JavaScript. Based on [UDX](https://github.com/holepunchto/udx-native).

```
npm i bare-dgram
```

## Usage

```js
const dgram = require('bare-dgram')

const client = dgram.createSocket('udp4')
const server = dgram.createSocket('udp4')

client.on('connect', () => client.send('hello'))

server.on('message', (msg, rinfo) => {
  console.log(`message: ${msg} from: ${rinfo.address}:${rinfo.port}`)
})

server.bind(() => client.connect(server.address().port))
```

## API

#### `const socket = new dgram.Socket([options])`

Create a new UDP socket. `options` are passed through to `udx-native`'s socket and may include:

```js
options = {
  ipv6Only: false,
  reuseAddress: false
}
```

#### `const socket = dgram.createSocket([options][, callback])`

Convenience function that creates a `Socket` and, if `callback` is provided, adds it as a listener for the `message` event.

#### `socket.address()`

Returns the address information for the local end of the socket, or `null` if the socket is not bound. The returned object has the shape:

```js
{
  address: '127.0.0.1',
  family: 'IPv4',
  port: 41234
}
```

#### `socket.remoteAddress()`

Returns the address information for the remote end of the socket, or `null` if `connect()` has not been called. The returned object has the same shape as `socket.address()`.

#### `socket.bind([port][, address][, callback])`

Binds the socket to `port` and `address`. If `port` is omitted or `0`, an available port is chosen automatically. If `address` is omitted, the socket binds to all interfaces. `port` and `address` may also be passed together as an options object, `{ port, address }`. If `callback` is provided, it's added as a one-time listener for the `listening` event. Returns `this`.

#### `socket.connect(port[, address][, callback])`

"Connects" the socket to a remote `port` and `address`, so that subsequent calls to `send()` can omit the destination. This does not perform a network handshake; it only sets the default destination and emits `connect` on the next microtask. If `callback` is provided, it's added as a one-time listener for the `connect` event.

#### `await socket.close([callback])`

Closes the socket, releasing its underlying resources. If `callback` is provided, any error is passed to it instead of rejecting the returned promise.

#### `await socket.send(msg[, offset, length][, port][, address][, callback])`

Sends `msg`, which may be a `string` or a `Buffer`, to `port` and `address`. `offset` and `length` restrict the send to a subrange of `msg` and default to the full buffer. If `port` and `address` are omitted, the destination set by `connect()` is used. If `callback` is provided, any error is passed to it instead of rejecting the returned promise.

### Events

#### `event: 'close'`

Emitted after the socket has been closed.

#### `event: 'connect'`

Emitted once `connect()` has taken effect.

#### `event: 'error'`

Emitted when the underlying socket errors. The listener receives the `Error`.

#### `event: 'listening'`

Emitted once the socket has been bound and is ready to receive messages.

#### `event: 'message'`

Emitted when a message is received. The listener receives `(message, rinfo)`, where `message` is the received data and `rinfo` describes the sender:

```js
{
  address: '127.0.0.1',
  family: 'IPv4',
  port: 41234,
  size: 13
}
```

## License

Apache-2.0
