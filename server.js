import { WebSocketServer } from 'ws'
import { createBag, drawTiles, getLetterPoints, scoreWordSequence } from './gameLogic.js'

const wss = new WebSocketServer({ port: 3000 })

// Map tracking active rooms: RoomCode -> { clients: Set, state: { board, bag, players, currentPlayer } }
const rooms = new Map()

/**
 * Broadcast utility to send a message packet to every socket client connected to a specific room code.
 */
function broadcast(room, data) {
  const info = rooms.get(room)
  if (!info) return
  const raw = JSON.stringify(data)
  for (const ws of info.clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(raw)
    }
  }
}

/**
 * Creates a blank, clean template state context for a newborn match room.
 */
function createRoomState() {
  return {
    clients: new Set(),
    state: {
      board: Array.from({ length: 15 }, () => Array(15).fill('')), // Matches clean empty strings format
      bag: createBag(), // 👈 Instantly stocks and shuffles a fresh 100-tile bag on creation
      players: [],
      currentPlayer: 0
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch (e) {
      return
    }

    const { type, room, name, payload } = msg
    if (!room) return

    // Auto-instantiate the room container if it doesn't exist yet
    if (!rooms.has(room)) {
      rooms.set(room, createRoomState())
    }
    const info = rooms.get(room)

    // ==========================================
    // ACTION 1: PLAYER JOINED ROOM
    // ==========================================
    if (type === 'join') {
      ws._room = room
      ws._name = name
      info.clients.add(ws)

      // Add the player to the list if they aren't already registered in this specific room
      let existingPlayer = info.state.players.find(p => p.name === name)
      
      if (!existingPlayer) {
        // Draw an initial hand of 7 starting tiles straight from the authoritative server bag
        const startingRack = drawTiles(info.state.bag, 7)
        
        existingPlayer = {
          name,
          rack: startingRack,
          score: 0
        }
        info.state.players.push(existingPlayer)
      }

      // 1. Reply to the newly connected user with the complete authoritative room state
      ws.send(JSON.stringify({ type: 'state', state: info.state }))
      
      // 2. Alert everybody else in the channel that an opponent has connected
      broadcast(room, { type: 'peer-join', name })
    }

    // Find our current player active reference instance
    const playerIndex = info.state.players.findIndex(p => p.name === name)
    const activePlayer = info.state.players[playerIndex]

    // Security Gate: block inputs from unregistered players or out-of-turn moves
    const isPlayerTurn = playerIndex !== -1 && playerIndex === info.state.currentPlayer
    
    // ==========================================
    // ACTION 2: TILE PLACEMENT SIGNAL
    // ==========================================
    if (type === 'play-tile' && isPlayerTurn && activePlayer) {
      const { r, c, letter } = payload

      // Prevent overwriting an already occupied space
      if (info.state.board[r][c] !== '') return

      // Commit the change to the authoritative board state
      info.state.board[r][c] = letter

      // Remove the played tile from the player's hand
      const targetIndex = activePlayer.rack.findIndex(t => t.letter === letter)
      let pointsAwarded = 0
      
      if (targetIndex >= 0) {
        const pulledTile = activePlayer.rack.splice(targetIndex, 1)[0]
        pointsAwarded = pulledTile.pts || getLetterPoints(letter)
      } else {
        pointsAwarded = getLetterPoints(letter)
      }

      // Compute word points. We pass a clean mock sequence setup representing this singular move execution loop.
      // For deeper calculations, expand this to trace connected adjacent string neighbors across the board.
      const moveSequence = [{ r, c, letter, isNew: true }]
      const calculatedPoints = scoreWordSequence(moveSequence)
      activePlayer.score += calculatedPoints

      // Refill the rack back to 7 tiles from the server's master bag
      if (activePlayer.rack.length < 7 && info.state.bag.length > 0) {
        const replacement = drawTiles(info.state.bag, 1)
        if (replacement.length) {
          activePlayer.rack.push(replacement[0])
        }
      }

      // Advance the turn to the next player in sequence
      info.state.currentPlayer = (info.state.currentPlayer + 1) % info.state.players.length
      
      // Broadcast the synchronized state back out to both players
      broadcast(room, { type: 'state', state: info.state })
    }

    // ==========================================
    // ACTION 3: EXCHANGE COMPLETE RACK
    // ==========================================
    if (type === 'exchange-rack' && isPlayerTurn && activePlayer) {
      const returningTiles = activePlayer.rack.splice(0, activePlayer.rack.length)
      
      // Dump the old letters back into the bottom of the pile
      info.state.bag.unshift(...returningTiles)
      
      // Reshuffle the bag to keep distributions unpredictable
      for (let i = info.state.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[info.state.bag[i], info.state.bag[j]] = [info.state.bag[j], info.state.bag[i]]
      }

      // Pull a completely clean set of 7 fresh tiles
      activePlayer.rack = drawTiles(info.state.bag, 7)

      // Advance the game clock forward
      info.state.currentPlayer = (info.state.currentPlayer + 1) % info.state.players.length
      broadcast(room, { type: 'state', state: info.state })
    }

    // ==========================================
    // ACTION 4: PASS ACTIVE TURN
    // ==========================================
    if (type === 'pass-turn' && isPlayerTurn && activePlayer) {
      info.state.currentPlayer = (info.state.currentPlayer + 1) % info.state.players.length
      broadcast(room, { type: 'state', state: info.state })
    }
  })

  // ==========================================
  // DISCONNECT / CLEANUP ROUTINE
  // ==========================================
  ws.on('close', () => {
    const room = ws._room
    const name = ws._name
    if (!room) return
    
    const info = rooms.get(room)
    if (!info) return

    info.clients.delete(ws)
    broadcast(room, { type: 'peer-leave', name })

    // If the room is completely empty, tear it down to save server memory
    if (info.clients.size === 0) {
      rooms.delete(room)
    }
  })
})

console.log('🚀 Authoritative Scrabble Socket Server listening on ws://localhost:3000')