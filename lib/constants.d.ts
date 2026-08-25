declare const constants: {
  state: {
    CONNECTING: number
    CONNECTED: number
    BINDING: number
    BOUND: number
    READING: number
    CLOSING: number
    CLOSED: number
    UNREFED: number
  }
  address: {
    MAX_LENGTH: number
  }
  bind: {
    IPV6ONLY: number
    REUSEADDR: number
    REUSEPORT: number
  }
}

export = constants
