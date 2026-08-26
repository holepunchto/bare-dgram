# bare-dgram

Native UDP sockets for JavaScript.

```
npm i bare-dgram
```

## Usage

```js
const dgram = require('bare-dgram')

const server = dgram.createSocket('udp4')
const client = dgram.createSocket('udp4')

server.on('message', (msg, rinfo) => {
  console.log(`message: ${msg} from: ${rinfo.address}:${rinfo.port}`)
})

server.bind(() => client.send('hello', server.address().port, '127.0.0.1'))
```

## API

#### `const socket = new dgram.Socket([options][, onmessage])`

Create a new UDP socket. `socket` extends <https://github.com/holepunchto/bare-events>.

Options include:

```js
options = {
  // The address family of the socket, either 'udp4' or 'udp6'. Pass `null` to
  // leave the family unspecified, which is required when the socket is to adopt
  // an existing file descriptor.
  type: 'udp4',
  // Bind the socket to IPv6 addresses only, rather than dual stack.
  ipv6Only: false,
  // Allow several sockets to bind to the same address and port.
  reuseAddr: false,
  // Allow several sockets to bind to the same address and port, distributing
  // incoming datagrams between them.
  reusePort: false,
  // The size of the buffer that datagrams are read into, at least 1. The
  // default is larger than the largest possible datagram, so it can never
  // truncate. A smaller buffer truncates larger datagrams, which surfaces as an
  // 'error' event carrying `EMSGSIZE` rather than silently losing data; the
  // socket keeps receiving, so handle 'error' if you lower this.
  readBufferSize: 65536,
  // The size of the operating system receive and send buffers, applied when the
  // socket is bound. `0` leaves them at their default size.
  recvBufferSize: 0,
  sendBufferSize: 0,
  // The function used to resolve hostnames, called as
  // `lookup(hostname, { family }, cb)` with `cb(err, address, family)`. A
  // result that is not an IP address string is reported as a lookup failure.
  lookup: require('bare-dns').lookup
}
```

As a shorthand, `options` may be given as the socket type, i.e. `new dgram.Socket('udp4')`. If `onmessage` is provided, it is added as a listener for the `message` event.

A custom `lookup` must resolve to IP addresses, as the address family is derived from the resolved address rather than from what the resolver reports for it. A result that is not an IP address is reported as a failed lookup rather than passed on.

#### `const socket = dgram.createSocket([options][, onmessage])`

Convenience function equivalent to `new dgram.Socket(options, onmessage)`.

#### `socket.type`

The address family the socket was created with, either `'udp4'`, `'udp6'`, or `null`.

#### `socket.bound`

Whether the socket is bound.

#### `socket.connected`

Whether the socket is connected to a peer.

#### `socket.closing`

Whether the socket is closing.

#### `socket.closed`

Whether the socket has closed.

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

Returns the address information for the peer, or `null` if the socket is not connected. The returned object has the same shape as `socket.address()`.

#### `socket.bind([port][, address][, onlistening])`

#### `socket.bind(options[, onlistening])`

Bind the socket to `port` and `address` and start receiving datagrams. If `port` is omitted or `0`, an available port is chosen automatically. If `address` is omitted, the socket binds to all interfaces. If `address` is not an IP address, it is resolved using the socket's `lookup` function.

Addresses may carry a zone identifier, such as `fe80::1%en0`, and an IP address may be at most `dgram.constants.address.MAX_LENGTH` bytes long.

Options include:

```js
options = {
  port: 0,
  address: null,
  // An existing file descriptor to adopt, rather than creating and binding a
  // new socket. Requires a socket created with `type: null`.
  fd: -1
}
```

If `onlistening` is provided, it is added as a one-time listener for the `listening` event. Binding errors are reported through the `error` event. Returns `this`.

#### `socket.connect(port[, address][, onconnect])`

#### `socket.connect(options[, onconnect])`

Connect the socket to a remote `port` and `address`, binding it first if it is not already bound. A connected socket sends to its peer by default and only receives datagrams from it. If `address` is omitted, the loopback address is used. Unlike `bind()`, `port` must be between `1` and `65535`.

If `onconnect` is provided, it is added as a one-time listener for the `connect` event. Returns `this`.

#### `socket.disconnect()`

Disconnect a connected socket, allowing it to send to and receive from any peer again. Throws if the socket is not connected. Returns `this`.

#### `socket.send(msg[, offset, length][, port][, address][, callback])`

Send `msg` to `port` and `address`, binding the socket first if it is not already bound. `msg` may be a string, a `Buffer`, any typed array or `DataView`, or an array of these, in which case they are sent as a single datagram. `offset` and `length` restrict the send to a subrange of `msg` and may only be given when `msg` is not an array.

If the socket is connected, `port` and `address` must be omitted and the datagram is sent to the peer. Otherwise `port` must be between `1` and `65535`. If `address` is not an IP address, it is resolved using the socket's `lookup` function.

`callback` is called as `callback(err, bytes)` once the datagram has been handed off to the operating system. If no `callback` is given, send errors are emitted as `error` events.

The methods that follow all read or write socket options. Apart from `socket.getSendQueueSize()` and `socket.getSendQueueCount()`, which are tracked by the socket itself, they reach the underlying socket, which is created lazily, and so require a bound socket that has not been closed, throwing otherwise.

#### `socket.setBroadcast(flag)`

Enable or disable sending to the broadcast address.

#### `socket.setTTL(ttl)`

Set the IP time to live of outgoing datagrams. Returns `ttl`.

#### `socket.setMulticastTTL(ttl)`

Set the IP time to live of outgoing multicast datagrams. Returns `ttl`.

#### `socket.setMulticastLoopback(flag)`

Enable or disable delivery of outgoing multicast datagrams back to the local interface. Returns `flag`.

#### `socket.setMulticastInterface(iface)`

Set the interface used for outgoing multicast datagrams.

#### `socket.addMembership(group[, iface])`

Join the multicast `group` on `iface`, or on all applicable interfaces if `iface` is omitted.

#### `socket.dropMembership(group[, iface])`

Leave the multicast `group` on `iface`, or on all applicable interfaces if `iface` is omitted.

#### `socket.addSourceSpecificMembership(source, group[, iface])`

Join the source specific multicast `group`, receiving only datagrams sent from `source`.

#### `socket.dropSourceSpecificMembership(source, group[, iface])`

Leave the source specific multicast `group`.

#### `socket.getSendBufferSize()`

#### `socket.setSendBufferSize(size)`

Get or set the size of the operating system send buffer in bytes.

#### `socket.getRecvBufferSize()`

#### `socket.setRecvBufferSize(size)`

Get or set the size of the operating system receive buffer in bytes.

#### `socket.getSendQueueSize()`

The number of bytes queued for sending.

#### `socket.getSendQueueCount()`

The number of send requests queued for sending.

`pause()`, `resume()`, `close()`, `ref()` and `unref()` are no-ops on a closed socket rather than throwing, so that a redundant call during teardown is never an error.

#### `socket.pause()`

Stop receiving datagrams. Datagrams that the operating system has already buffered are delivered once the socket is resumed, so pausing applies backpressure rather than discarding them. Returns `this`.

#### `socket.resume()`

Start receiving datagrams again. Returns `this`.

#### `socket.close([onclose])`

Close the socket, releasing its underlying resources. Pending sends are settled before the socket closes. If `onclose` is provided, it is added as a one-time listener for the `close` event. Returns `this`.

#### `socket.ref()`

Ref the socket, preventing the process from exiting.

#### `socket.unref()`

Unref the socket, allowing the process to exit.

#### `event: 'listening'`

Emitted once the socket has been bound and is ready to receive datagrams.

#### `event: 'connect'`

Emitted once the socket has been connected to its peer.

#### `event: 'message'`

Emitted when a datagram is received. The listener receives `(message, rinfo)`, where `message` is a `Buffer` and `rinfo` describes the sender:

```js
{
  address: '127.0.0.1',
  family: 'IPv4',
  port: 41234,
  size: 13
}
```

#### `event: 'close'`

Emitted after the socket has been closed.

#### `event: 'error'`

Emitted when the socket errors, including when binding or receiving fails, and when a send fails with no `callback` to report to. The listener receives the `Error`. As with any `EventEmitter`, an `error` emitted with no listener attached is unhandled and surfaces as an uncaught exception.

#### `dgram.isIP(host)`

Returns `4` if `host` is an IPv4 address, `6` if it is an IPv6 address, or `0` otherwise.

#### `dgram.isIPv4(host)`

Returns `true` if `host` is an IPv4 address.

#### `dgram.isIPv6(host)`

Returns `true` if `host` is an IPv6 address.

#### `dgram.constants`

Object containing internal state constants and bind flags, as well as `address.MAX_LENGTH`, the maximum length in bytes of an IP address accepted by `socket.bind()`, `socket.connect()` and `socket.send()`:

```js
dgram.constants.address.MAX_LENGTH

dgram.constants.bind.IPV6ONLY
dgram.constants.bind.REUSEADDR
dgram.constants.bind.REUSEPORT
```

#### `dgram.errors`

Class for datagram specific errors, with a static factory per error code.

## IPC handle passing

`dgram.Socket` implements the `IPCAcceptable` protocol, so a bound socket can be passed to a peer over a `bare-pipe` created with `ipc: true`, and a received socket can be adopted with `pipe.accept(socket)`. See <https://github.com/holepunchto/bare-pipe#ipc-handle-passing>.

## License

Apache-2.0
