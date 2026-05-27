/**
 * Instantiates a global abstraction wrapper around native WebSockets.
 * @param {string} room - Target game room ID string.
 * @param {string} name - Player username tag.
 * @param {Function} onMessage - Callback function triggered on incoming messages.
 */
export function createSocket(room, name, onMessage) {
  // Gracefully adapt protocol matching based on hosting environment
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  
  // If running locally, this resolves to something like ws://localhost:3000
  const url = `${protocol}://${location.hostname}:3000`
  const ws = new WebSocket(url)

  // Connection established event listener
  ws.addEventListener('open', () => {
    console.log(`[WebSocket] Connected successfully to matchmaking hub: ${url}`)
  })

  // Incoming messaging router channel
  ws.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data)
      if (onMessage) {
        onMessage(data)
      }
    } catch (e) {
      console.warn('[WebSocket] Received unparsable message payload:', ev.data, e)
    }
  })

  // Error boundary safety handler
  ws.addEventListener('error', (err) => {
    console.error('[WebSocket] Transport error encountered:', err)
  })

  // Connection dropped or terminated closure wrapper
  ws.addEventListener('close', () => {
    console.log('[WebSocket] Connection channel closed.')
  })

  /**
   * Universal message sending abstraction interface.
   * Implicitly wraps every outbound action packet with routing metadata.
   */
  function send(payload) {
    if (ws.readyState === WebSocket.OPEN) {
      const outgoingPacket = {
        ...payload,
        room: payload.room || room,
        name: payload.name || name,
        timestamp: Date.now()
      }
      ws.send(JSON.stringify(outgoingPacket))
    } else {
      console.warn('[WebSocket] Cannot send packet. Socket state is currently:', ws.readyState)
    }
  }

  // Expose predictable interface parameters
  return { 
    ws, 
    send, 
    close: () => ws.close() 
  }
}