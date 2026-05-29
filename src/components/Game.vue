<script setup>
import { ref, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Board from './Board.vue'
import Tile from './Tile.vue'

// Core Firebase Firestore imports
import { doc, onSnapshot, setDoc, updateDoc, getDoc, arrayUnion, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase.js' 

const route = useRoute()
const router = useRouter()

// Reactive UI states
const playerName = ref('')
const inputRoomCode = ref('')
const isJoined = ref(false)
const errorMessage = ref('')
const isMenuOpen = ref(false) 
const showBingoNotification = ref(false) 
const isProcessing = ref(false) 
const loadingMessage = ref('')   
const showForfeitModal = ref(false)
const isReconnecting = ref(false)
const reconnectAttempts = ref(0)
const maxReconnectAttempts = ref(5)
const showInvalidWordNotification = ref(false)
const invalidWordMessage = ref('')

// Core active game states
const boardFlat = ref(Array(225).fill(''))
const latestPlayMessage = ref('') 
const joinMessage = ref('')       
const players = ref([])
const currentPlayerIndex = ref(0)
const selectedLetter = ref(null)
const selectedRackIdx = ref(null) 
const bag = ref([])
const gameHistory = ref([]) 
const matchResults = ref({ matchesPlayed: 0, wins: {} })

// Safe global variables to track drag states within Vue logic
const activeDraggedTile = ref(null)
const boardDragSourceIdx = ref(null) 

const pendingMoves = ref([])

let unsubscribeSnapshot = null
let pingInterval = null
let reconnectTimeout = null
const room = ref('')
const name = ref('')

// Word validation API (using Free Dictionary API)
async function validateWord(word) {
  try {
    // Use a free dictionary API
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`)
    return response.ok
  } catch (error) {
    console.error("Word validation error:", error)
    // Fallback: accept the word if API fails
    return true
  }
}

// Computed property combining database board with local uncommitted pending tiles
const board2D = computed(() => {
  const grid = []
  const currentBoard = [...boardFlat.value]
  
  pendingMoves.value.forEach(move => {
    const idx = move.r * 15 + move.c
    currentBoard[idx] = move.letter
  })

  for (let i = 0; i < 15; i++) {
    grid.push(currentBoard.slice(i * 15, (i + 1) * 15))
  }
  return grid
})

// Official Scrabble Letter Distributions and Scores
const LETTER_SCORES = {
  A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:4, I:1, J:8, K:5, L:1, M:3,
  N:1, O:1, P:3, Q:10, R:1, S:1, T:1, U:1, V:4, W:4, X:8, Y:4, Z:10
}

const LETTER_COUNTS = {
  A:9, B:2, C:2, D:4, E:12, F:2, G:3, H:2, I:9, J:1, K:1, L:4, M:2,
  N:6, O:8, P:2, Q:1, R:6, S:4, T:6, U:4, V:2, W:2, X:1, Y:2, Z:1
}

function createOfficialBag() {
  const fullBag = []
  for (const [letter, count] of Object.entries(LETTER_COUNTS)) {
    for (let i = 0; i < count; i++) {
      fullBag.push({ letter, pts: LETTER_SCORES[letter] })
    }
  }
  for (let i = fullBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[fullBag[i], fullBag[j]] = [fullBag[j], fullBag[i]]
  }
  return fullBag
}

function hasTwoLetterWord(tiles) {
  const letters = tiles.map(t => t.letter)
  for (let i = 0; i < letters.length; i++) {
    for (let j = 0; j < letters.length; j++) {
      if (i === j) continue
      if (VALID_2_LETTER_WORDS.has(letters[i] + letters[j])) return true
    }
  }
  return false
}

const VALID_2_LETTER_WORDS = new Set([
  'AA', 'AB', 'AD', 'AE', 'AG', 'AH', 'AI', 'AL', 'AM', 'AN', 'AR', 'AS', 'AT', 'AW', 'AX', 'AY',
  'BA', 'BE', 'BI', 'BO', 'BY', 'DA', 'DE', 'DO', 'ED', 'EF', 'EH', 'EL', 'EM', 'EN', 'ER', 'ES',
  'ET', 'EX', 'FA', 'FE', 'GI', 'GO', 'HA', 'HE', 'HI', 'HM', 'HO', 'ID', 'IF', 'IN', 'IS', 'IT',
  'JO', 'KA', 'KI', 'LA', 'LI', 'LO', 'MA', 'ME', 'MI', 'MM', 'MO', 'MU', 'MY', 'NA', 'NE', 'NO',
  'NU', 'OD', 'OE', 'OF', 'OH', 'OI', 'OK', 'OM', 'ON', 'OP', 'OR', 'OS', 'OU', 'OW', 'OX', 'OY',
  'PA', 'PE', 'PI', 'PO', 'QI', 'RE', 'SH', 'SI', 'SO', 'TA', 'TE', 'TI', 'TO', 'UH', 'UM', 'UN',
  'UP', 'US', 'UT', 'WE', 'WO', 'XI', 'XU', 'YA', 'YE', 'YO', 'ZA'
])

function drawSmartTiles(targetBag, count) {
  let drawn = []
  for (let i = 0; i < Math.min(count, targetBag.length); i++) {
    drawn.push(targetBag.pop())
  }
  if (count === 7 && Math.random() < 0.80) {
    let attempts = 0
    while (!hasTwoLetterWord(drawn) && targetBag.length > 3 && attempts < 15) {
      attempts++
      const returnTile = drawn.pop()
      targetBag.unshift(returnTile)
      drawn.push(targetBag.pop())
    }
  }
  return drawn
}

const TILE_MULTIPLIERS = (() => {
  const matrix = Array.from({ length: 15 }, () => Array(15).fill(null))
  const triples = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]]
  const doubles = [[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],[13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10],[7,7]]
  const tripleLetters = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]]
  const doubleLetters = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]]
  triples.forEach(([r,c]) => matrix[r][c] = 'TW')
  doubles.forEach(([r,c]) => matrix[r][c] = 'DW')
  tripleLetters.forEach(([r,c]) => matrix[r][c] = 'TL')
  doubleLetters.forEach(([r,c]) => matrix[r][c] = 'DL')
  return matrix
})()

function tileMultiplierAt(r, c) {
  const type = TILE_MULTIPLIERS[r]?.[c]
  if (type === 'TW') return { letter: 1, word: 3 }
  if (type === 'DW') return { letter: 1, word: 2 }
  if (type === 'TL') return { letter: 3, word: 1 }
  if (type === 'DL') return { letter: 2, word: 1 }
  return { letter: 1, word: 1 }
}

function getBoardLetter(r, c, pendingMap = {}) {
  const flatIndex = r * 15 + c
  if (pendingMap[flatIndex]) return pendingMap[flatIndex].letter
  return boardFlat.value[flatIndex] || ''
}

function collectWordPositions(r, c, dr, dc, pendingMap) {
  let startR = r
  let startC = c
  while (true) {
    const prevR = startR - dr
    const prevC = startC - dc
    if (prevR < 0 || prevR > 14 || prevC < 0 || prevC > 14) break
    if (!getBoardLetter(prevR, prevC, pendingMap)) break
    startR = prevR
    startC = prevC
  }
  const positions = []
  let currR = startR
  let currC = startC
  while (currR >= 0 && currR < 15 && currC >= 0 && currC < 15) {
    const letter = getBoardLetter(currR, currC, pendingMap)
    if (!letter) break
    positions.push({ r: currR, c: currC, letter })
    currR += dr
    currC += dc
  }
  return positions
}

function computeTurnWords(moves) {
  const pendingMap = {}
  moves.forEach(m => { pendingMap[m.r * 15 + m.c] = m })
  const rowMatch = moves.every(m => m.r === moves[0].r)
  const direction = rowMatch ? { dr: 0, dc: 1 } : { dr: 1, dc: 0 }
  const sortedMain = [...moves].sort((a, b) => rowMatch ? a.c - b.c : a.r - b.r)
  const mainWordPositions = collectWordPositions(sortedMain[0].r, sortedMain[0].c, direction.dr, direction.dc, pendingMap)
  const crossWords = moves.map(move => {
    const perp = rowMatch ? { dr: 1, dc: 0 } : { dr: 0, dc: 1 }
    const positions = collectWordPositions(move.r, move.c, perp.dr, perp.dc, pendingMap)
    return positions.length > 1 ? positions : null
  }).filter(Boolean)
  return [mainWordPositions, ...crossWords].filter(Boolean)
}

function scoreWordPositions(positions, moves) {
  let total = 0
  let wordMult = 1
  const pendingSet = new Set(moves.map(m => m.r * 15 + m.c))

  positions.forEach(pos => {
    const baseValue = LETTER_SCORES[pos.letter] || 1
    const isNew = pendingSet.has(pos.r * 15 + pos.c)
    if (isNew) {
      const mult = tileMultiplierAt(pos.r, pos.c)
      total += baseValue * mult.letter
      wordMult *= mult.word
    } else {
      total += baseValue
    }
  })
  return total * wordMult
}

function calculateScrabbleTurnScore(moves) {
  const words = computeTurnWords(moves)
  let score = 0
  words.forEach(positions => {
    score += scoreWordPositions(positions, moves)
  })
  if (moves.length === 7) score += 50
  return score
}

function getTurnWordsList(moves) {
  const words = computeTurnWords(moves).map(positions => positions.map(p => p.letter).join(''))
  return words
}

function getTurnWordDescription(moves) {
  const words = getTurnWordsList(moves)
  if (!words.length) return ''
  if (words.length === 1) return words[0]
  return words.join(', ')
}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

async function updateLastActive(roomRef) {
  try {
    await updateDoc(roomRef, {
      lastActive: Date.now()
    })
  } catch (err) {
    // Silently fail - not critical
  }
}

function startPingInterval() {
  if (pingInterval) clearInterval(pingInterval)
  pingInterval = setInterval(async () => {
    if (room.value && isJoined.value) {
      const roomRef = doc(db, 'rooms', room.value)
      await updateLastActive(roomRef)
    }
  }, 30000) // Every 30 seconds
}

async function handleReconnection(roomCode) {
  if (reconnectAttempts.value >= maxReconnectAttempts.value) {
    alert("Unable to reconnect to game room. The room may have expired.")
    resetLocalState()
    localStorage.removeItem('scrabble_roomCode')
    localStorage.removeItem('scrabble_playerName')
    localStorage.removeItem('scrabble_reconnecting')
    isReconnecting.value = false
    isProcessing.value = false
    return
  }
  
  isReconnecting.value = true
  reconnectAttempts.value++
  localStorage.setItem('scrabble_reconnecting', 'true')
  loadingMessage.value = `Reconnecting to game... (Attempt ${reconnectAttempts.value}/${maxReconnectAttempts.value})`
  
  // Wait before retry
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  const roomRef = doc(db, 'rooms', roomCode)
  try {
    const docSnap = await getDoc(roomRef)
    if (docSnap.exists()) {
      // Room still exists, restart listener
      startFirebaseListener(roomCode, true)
    } else {
      // Room doesn't exist, try again
      handleReconnection(roomCode)
    }
  } catch (err) {
    handleReconnection(roomCode)
  }
}

function startFirebaseListener(roomCode, isReconnect = false) {
  if (unsubscribeSnapshot) unsubscribeSnapshot()
  const roomRef = doc(db, 'rooms', roomCode)
  
  // Store in localStorage for refresh recovery
  localStorage.setItem('scrabble_roomCode', roomCode)
  localStorage.setItem('scrabble_playerName', name.value)
  
  // Show loader while connecting/reconnecting
  if (isReconnect) {
    isReconnecting.value = true
    loadingMessage.value = "Connected! Loading game state..."
  } else {
    isProcessing.value = true
    loadingMessage.value = "Loading game..."
  }
  
  unsubscribeSnapshot = onSnapshot(roomRef, (docSnap) => {
    if (!docSnap.exists()) {
      if (isJoined.value) {
        // Try to reconnect if room exists but we lost connection
        handleReconnection(roomCode)
      }
      return
    }
    
    // Successfully connected - hide loaders
    setTimeout(() => {
      isReconnecting.value = false
      isProcessing.value = false
      reconnectAttempts.value = 0
    }, 500)
    
    localStorage.removeItem('scrabble_reconnecting')
    
    const data = docSnap.data()
    boardFlat.value = data.boardFlat || Array(225).fill('')
    bag.value = data.bag || []
    players.value = data.players || []
    currentPlayerIndex.value = data.currentPlayer ?? 0
    joinMessage.value = data.joinNotification || ''
    latestPlayMessage.value = data.latestPlay || ''
    gameHistory.value = data.gameHistory || []
    matchResults.value = data.matchResults || { matchesPlayed: 0, wins: {} }
    
    // Clear any pending moves when reconnecting
    if (isReconnect) {
      pendingMoves.value = []
      selectedLetter.value = null
      selectedRackIdx.value = null
    }
    
    // Update last active time
    updateLastActive(roomRef)
  }, (error) => {
    console.error("Snapshot error:", error)
    if (!isReconnecting.value && isJoined.value) {
      handleReconnection(roomCode)
    } else {
      isProcessing.value = false
      isReconnecting.value = false
    }
  })
  
  startPingInterval()
}

function checkForExistingGame() {
  const savedRoomCode = localStorage.getItem('scrabble_roomCode')
  const savedPlayerName = localStorage.getItem('scrabble_playerName')
  
  if (savedRoomCode && savedPlayerName) {
    playerName.value = savedPlayerName
    inputRoomCode.value = savedRoomCode
    isReconnecting.value = true
    loadingMessage.value = "Reconnecting to your game..."
    isProcessing.value = true
    
    // Attempt to rejoin after a short delay
    setTimeout(() => {
      handleJoinRoom(true)
    }, 500)
  }
}

async function handleCreateRoom() {
  if (!playerName.value.trim()) {
    errorMessage.value = "Please enter your name first!"
    return
  }
  
  errorMessage.value = ""
  isProcessing.value = true
  loadingMessage.value = "Creating room..."
  
  // Clear any existing reconnect data
  localStorage.removeItem('scrabble_roomCode')
  localStorage.removeItem('scrabble_playerName')
  localStorage.removeItem('scrabble_reconnecting')
  isReconnecting.value = false
  reconnectAttempts.value = 0
  
  const newRoomCode = generateRoomCode()
  const roomRef = doc(db, 'rooms', newRoomCode)
  const freshBag = createOfficialBag()
  const initialRack = drawSmartTiles(freshBag, 7)
  const expiryTimestamp = Date.now() + (24 * 60 * 60 * 1000)
  
  const initialData = {
    boardFlat: Array(225).fill(''),
    bag: freshBag,
    players: [{ name: playerName.value.trim(), rack: initialRack, score: 0 }],
    currentPlayer: 0,
    joinNotification: `Room ${newRoomCode} created by ${playerName.value.trim()}`,
    latestPlay: '',
    gameHistory: [],
    matchResults: { matchesPlayed: 0, wins: {} },
    expiresAt: expiryTimestamp,
    lastActive: Date.now()
  }
  
  try {
    await setDoc(roomRef, initialData)
    room.value = newRoomCode
    name.value = playerName.value.trim()
    isJoined.value = true
    startFirebaseListener(newRoomCode)
  } catch (err) {
    errorMessage.value = "Failed to create room."
    console.error(err)
    isProcessing.value = false
  }
}

async function handleJoinRoom(isAutoReconnect = false) {
  const code = isAutoReconnect ? inputRoomCode.value : inputRoomCode.value.trim().toUpperCase()
  const enteredName = isAutoReconnect ? playerName.value : playerName.value.trim()
  
  if (!enteredName) {
    errorMessage.value = "Please enter your name!"
    return
  }
  if (!code) {
    errorMessage.value = "Please enter a room code!"
    return
  }
  
  if (!isAutoReconnect) {
    errorMessage.value = ""
    isProcessing.value = true
    loadingMessage.value = "Joining room..."
  }
  
  // Clear any existing reconnect data if not auto reconnect
  if (!isAutoReconnect) {
    localStorage.removeItem('scrabble_reconnecting')
    isReconnecting.value = false
    reconnectAttempts.value = 0
  }
  
  const roomRef = doc(db, 'rooms', code)
  
  try {
    const docSnap = await getDoc(roomRef)
    if (!docSnap.exists()) {
      errorMessage.value = "Room code not found!"
      isProcessing.value = false
      isReconnecting.value = false
      return
    }
    
    const data = docSnap.data()
    const existingPlayerIndex = data.players.findIndex(p => p.name.toLowerCase() === enteredName.toLowerCase())
    
    if (existingPlayerIndex !== -1) {
      room.value = code
      name.value = data.players[existingPlayerIndex].name 
      isJoined.value = true
      startFirebaseListener(code, isAutoReconnect)
      return
    }
    
    if (data.players.length >= 2) {
      errorMessage.value = "This room is full."
      isProcessing.value = false
      isReconnecting.value = false
      return
    }
    
    const currentBag = [...data.bag]
    const startingRack = drawSmartTiles(currentBag, 7)
    const updatedPlayers = [...data.players, { name: enteredName, rack: startingRack, score: 0 }]
    const updatedJoinLog = `${enteredName} joined the room.`
    
    await updateDoc(roomRef, {
      players: updatedPlayers,
      bag: currentBag,
      joinNotification: updatedJoinLog,
      lastActive: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000)
    })

    room.value = code
    name.value = enteredName
    isJoined.value = true
    startFirebaseListener(code, isAutoReconnect)
  } catch (err) {
    errorMessage.value = "Error connecting to room."
    console.error(err)
    isProcessing.value = false
    isReconnecting.value = false
  }
}

function resetLocalState() {
  if (unsubscribeSnapshot) unsubscribeSnapshot()
  if (pingInterval) clearInterval(pingInterval)
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
  isJoined.value = false
  room.value = ''
  name.value = ''
  pendingMoves.value = []
  boardFlat.value = Array(225).fill('')
  bag.value = []
  players.value = []
  isReconnecting.value = false
  reconnectAttempts.value = 0
  isProcessing.value = false
  localStorage.removeItem('scrabble_roomCode')
  localStorage.removeItem('scrabble_playerName')
  localStorage.removeItem('scrabble_reconnecting')
}

function triggerForfeitConfirmation() {
  isMenuOpen.value = false
  showForfeitModal.value = true
}

function cancelForfeit() {
  showForfeitModal.value = false
}

async function confirmForfeit() {
  showForfeitModal.value = false
  if (!room.value) return

  isProcessing.value = true
  loadingMessage.value = "Processing forfeit..."

  const roomRef = doc(db, 'rooms', room.value)
  
  try {
    const opp = players.value.find(p => p.name.toLowerCase() !== name.value.toLowerCase())
    
    if (opp) {
      const summaryLog = `Match ended: ${name.value} forfeited. ${opp.name} is awarded the victory!`
      await updateDoc(roomRef, {
        currentPlayer: -1,
        latestPlay: summaryLog,
        gameHistory: arrayUnion(summaryLog)
      })
      await new Promise(r => setTimeout(r, 1000))
    }

    await deleteDoc(roomRef)
  } catch (err) {
    console.error("Forfeit submission error: ", err)
  } finally {
    isProcessing.value = false
    resetLocalState()
  }
}

function showInvalidWordNotificationMsg(words) {
  invalidWordMessage.value = `Invalid word(s): ${words.join(', ')}. Please try again!`
  showInvalidWordNotification.value = true
  setTimeout(() => {
    showInvalidWordNotification.value = false
  }, 3000)
}

watch(latestPlayMessage, (newMsg) => {
  if (newMsg && newMsg.includes("BINGO!")) {
    showBingoNotification.value = true
    setTimeout(() => {
      showBingoNotification.value = false
    }, 2000)
  }
})

onBeforeUnmount(() => {
  if (unsubscribeSnapshot) unsubscribeSnapshot()
  if (pingInterval) clearInterval(pingInterval)
  if (reconnectTimeout) clearTimeout(reconnectTimeout)
})

// Check for existing game on mount
checkForExistingGame()

const localPlayerIndex = computed(() => {
  return players.value.findIndex(p => p.name.toLowerCase() === name.value.toLowerCase())
})

const isMyTurn = computed(() => {
  return players.value.length === 2 && localPlayerIndex.value !== -1 && localPlayerIndex.value === currentPlayerIndex.value
})

const myRack = computed(() => {
  const me = players.value[localPlayerIndex.value]
  if (!me) return []
  
  let workingRack = me.rack.map((t, index) => ({ ...t, rackId: index }))
  
  pendingMoves.value.forEach(move => {
    const idx = workingRack.findIndex(t => t.rackId === move.rackId)
    if (idx >= 0) workingRack.splice(idx, 1)
  })
  return workingRack
})

function handleDrop({ r, c }) {
  const sourceTile = activeDraggedTile.value || { letter: selectedLetter.value, rackId: selectedRackIdx.value }
  const flatIndex = r * 15 + c
  if (!sourceTile.letter || !isMyTurn.value || boardFlat.value[flatIndex] !== '') return

  if (boardDragSourceIdx.value !== null) {
    pendingMoves.value.splice(boardDragSourceIdx.value, 1)
    boardDragSourceIdx.value = null
  }

  const destOverlap = pendingMoves.value.findIndex(m => m.r === r && m.c === c)
  if (destOverlap !== -1) {
    pendingMoves.value.splice(destOverlap, 1)
  }

  const sourceIdx = pendingMoves.value.findIndex(m => m.rackId === sourceTile.rackId)
  if (sourceIdx !== -1) {
    pendingMoves.value.splice(sourceIdx, 1)
  }

  pendingMoves.value.push({ r, c, letter: sourceTile.letter, rackId: sourceTile.rackId })
}

function onBoardTileDragStart(e, moveItem) {
  if (!isMyTurn.value) return
  
  const foundMoveIdx = pendingMoves.value.findIndex(m => m.r === moveItem.r && m.c === moveItem.c)
  let assignedRackId = moveItem.rackId

  if (foundMoveIdx !== -1) {
    assignedRackId = pendingMoves.value[foundMoveIdx].rackId
    boardDragSourceIdx.value = foundMoveIdx
  }

  activeDraggedTile.value = { letter: moveItem.letter, rackId: assignedRackId }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', 'board_tile')
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('dragover', (e) => { e.preventDefault() }, { passive: false })
  window.addEventListener('drop', (e) => { e.preventDefault() }, { passive: false })
}

function validatePlacement() {
  if (pendingMoves.value.length === 0) return false
  const firstMove = pendingMoves.value[0]
  const allSameRow = pendingMoves.value.every(m => m.r === firstMove.r)
  const allSameCol = pendingMoves.value.every(m => m.c === firstMove.c)
  
  if (!allSameRow && !allSameCol) {
    alert("Invalid placement! Tiles must be arranged in a straight line.")
    return false
  }

  const isFirstMoveOfGame = boardFlat.value.every(cell => cell === '')
  if (isFirstMoveOfGame) {
    const hitsCenter = pendingMoves.value.some(m => m.r === 7 && m.c === 7)
    if (!hitsCenter) {
      alert("The first word must pass through the center tile (Row 8, Column 8)!")
      return false
    }
    return true
  }

  let touchesExistingTile = false
  for (const move of pendingMoves.value) {
    const adjacents = [
      { r: move.r - 1, c: move.c }, { r: move.r + 1, c: move.c },
      { r: move.r, c: move.c - 1 }, { r: move.r, c: move.c + 1 }
    ]
    for (const adj of adjacents) {
      if (adj.r >= 0 && adj.r < 15 && adj.c >= 0 && adj.c < 15) {
        if (boardFlat.value[adj.r * 15 + adj.c] !== '') {
          touchesExistingTile = true
          break
        }
      }
    }
    if (touchesExistingTile) break
  }

  if (!touchesExistingTile) {
    alert("Your word must touch an existing letter already on the board.")
    return false
  }
  return true
}

async function confirmTurn() {
  if (!isMyTurn.value || pendingMoves.value.length === 0) return
  if (!validatePlacement()) return

  // Validate words before submitting
  const wordsToValidate = getTurnWordsList(pendingMoves.value)
  const validationResults = await Promise.all(wordsToValidate.map(word => validateWord(word)))
  
  const invalidWords = wordsToValidate.filter((word, index) => !validationResults[index])
  
  if (invalidWords.length > 0) {
    showInvalidWordNotificationMsg(invalidWords)
    return
  }

  const roomRef = doc(db, 'rooms', room.value)
  const updatedBoardFlat = [...boardFlat.value]
  const updatedPlayers = JSON.parse(JSON.stringify(players.value))
  const updatedBag = [...bag.value]
  const activePlayer = updatedPlayers[localPlayerIndex.value]

  const turnScore = calculateScrabbleTurnScore(pendingMoves.value)
  const sorted = [...pendingMoves.value].sort((a, b) => a.r !== b.r ? a.r - b.r : a.c - b.c)
  
  const rackIndicesToRemove = sorted.map(m => m.rackId).filter(id => id !== undefined)
  
  sorted.forEach(move => {
    const idx = move.r * 15 + move.c
    updatedBoardFlat[idx] = move.letter
  });
  
  activePlayer.rack = activePlayer.rack.filter((_, idx) => !rackIndicesToRemove.includes(idx))
  activePlayer.score += turnScore

  const needed = 7 - activePlayer.rack.length
  if (needed > 0 && updatedBag.length > 0) {
    const replacements = drawSmartTiles(updatedBag, needed)
    activePlayer.rack.push(...replacements)
  }

  const wordDescription = getTurnWordDescription(pendingMoves.value)
  const isBingo = pendingMoves.value.length === 7
  
  const plainWordScore = isBingo ? (turnScore - 50) : turnScore
  const newPlayLog = `${name.value} played "${wordDescription}" (+${plainWordScore} pts)${isBingo ? " (BINGO! +50 pts)" : ""}`
  
  const nextPlayerIndex = (currentPlayerIndex.value + 1) % updatedPlayers.length
  const shouldEndMatch = updatedBag.length === 0 && updatedPlayers.some(p => p.rack.length === 0)

  pendingMoves.value = []

  await updateDoc(roomRef, {
    boardFlat: updatedBoardFlat,
    bag: updatedBag,
    players: updatedPlayers,
    currentPlayer: shouldEndMatch ? -1 : nextPlayerIndex,
    latestPlay: shouldEndMatch ? '' : newPlayLog,
    lastActive: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
  })
}

let lastClickTime = 0
let lastClickedCell = { r: -1, c: -1 }

function onCellClick({ r, c }) {
  const currentTime = Date.now()
  const pendingIdx = pendingMoves.value.findIndex(m => m.r === r && m.c === c)

  if (pendingIdx !== -1 && (currentTime - lastClickTime < 300) && lastClickedCell.r === r && lastClickedCell.c === c) {
    pendingMoves.value.splice(pendingIdx, 1)
    return
  }

  lastClickTime = currentTime
  lastClickedCell = { r, c }

  if (!selectedLetter.value || !isMyTurn.value) return
  handleDrop({ r, c })
  selectedLetter.value = null
  selectedRackIdx.value = null
}

function recallTiles() {
  pendingMoves.value = []
}

function onDragStart(e, item) {
  if (!isMyTurn.value) { e.preventDefault(); return }
  boardDragSourceIdx.value = null
  activeDraggedTile.value = { letter: item.letter, rackId: item.rackId }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', 'rack_tile')
  }
}

function onDragEnd() {
  activeDraggedTile.value = null
  boardDragSourceIdx.value = null
}

function selectTile(letter, rackId) {
  if (!isMyTurn.value) return
  selectedLetter.value = letter
  selectedRackIdx.value = rackId
}

async function exchange() {
  if (!isMyTurn.value || pendingMoves.value.length > 0) return
  const roomRef = doc(db, 'rooms', room.value)

  const updatedPlayers = JSON.parse(JSON.stringify(players.value))
  const updatedBag = [...bag.value]
  const activePlayer = updatedPlayers[localPlayerIndex.value]

  const returningTiles = activePlayer.rack.splice(0, activePlayer.rack.length)
  updatedBag.unshift(...returningTiles)

  for (let i = updatedBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[updatedBag[i], updatedBag[j]] = [updatedBag[j], updatedBag[i]]
  }

  activePlayer.rack = drawSmartTiles(updatedBag, 7)
  const nextPlayerIndex = (currentPlayerIndex.value + 1) % updatedPlayers.length
  
  await updateDoc(roomRef, {
    bag: updatedBag,
    players: updatedPlayers,
    currentPlayer: nextPlayerIndex,
    latestPlay: `${name.value} exchanged their tiles.`,
    lastActive: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
  })
}

async function pass() {
  if (!isMyTurn.value || pendingMoves.value.length > 0) return
  const roomRef = doc(db, 'rooms', room.value)
  const nextPlayerIndex = (currentPlayerIndex.value + 1) % players.value.length

  await updateDoc(roomRef, {
    currentPlayer: nextPlayerIndex,
    latestPlay: `${name.value} passed their turn.`,
    lastActive: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
  })
}

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
}
</script>

<template>
  <!-- Invalid Word Notification -->
  <Transition name="slide-down">
    <div v-if="showInvalidWordNotification" class="invalid-word-notification">
      <div class="invalid-word-content">
        <span class="error-icon">❌</span>
        <p>{{ invalidWordMessage }}</p>
      </div>
    </div>
  </Transition>

  <!-- Reconnection Loader -->
  <div v-if="isReconnecting" class="reconnect-overlay">
    <div class="spinner-box">
      <div class="spinner"></div>
      <p class="loading-text">{{ loadingMessage || 'Reconnecting to game...' }}</p>
      <div class="reconnect-dots">
        <span></span><span></span><span></span>
      </div>
      <div class="reconnect-progress">
        Attempt {{ reconnectAttempts }} of {{ maxReconnectAttempts }}
      </div>
      <button v-if="reconnectAttempts >= 3" class="btn-retry-manual" @click="() => handleReconnection(room)">
        Manual Retry
      </button>
    </div>
  </div>

  <!-- Processing Loader -->
  <div v-if="isProcessing && !isReconnecting" class="loading-overlay">
    <div class="spinner-box">
      <div class="spinner"></div>
      <p class="loading-text">{{ loadingMessage }}</p>
    </div>
  </div>

  <!-- Forfeit Modal -->
  <div v-if="showForfeitModal" class="confirm-modal-backdrop">
    <div class="confirm-modal-box">
      <div class="warn-icon">⚠️</div>
      <h3>Forfeit Match?</h3>
      <p>Are you sure you want to forfeit? Doing so ends the session immediately and awards your opponent the match win.</p>
      <div class="modal-button-row">
        <button class="modal-btn btn-cancel" @click="cancelForfeit">No, Continue Game</button>
        <button class="modal-btn btn-confirm-forfeit" @click="confirmForfeit">Yes, Forfeit Match</button>
      </div>
    </div>
  </div>

  <!-- Bingo Notification -->
  <Transition name="fade">
    <div v-if="showBingoNotification" class="bingo-popup-overlay">
      <div class="bingo-popup-content">
        <span class="bingo-stars">✨🏆✨</span>
        <h2>BINGO!</h2>
        <p>All 7 tiles played! Bonus +50 Points Added.</p>
      </div>
    </div>
  </Transition>

  <!-- Sidebar -->
  <div :class="['sandwich-sidebar', { 'drawer-open': isMenuOpen }]">
    <div class="drawer-header">
      <h3>Match Dashboard</h3>
      <button class="close-btn" @click="toggleMenu">✕</button>
    </div>
    
    <div class="drawer-body">
      <div class="bag-counter-card">
        <div class="bag-stat">
          <span class="bag-qty">{{ bag.length }}</span>
          <span class="bag-lbl">Remaining Tiles in Bag</span>
        </div>
      </div>

      <div class="history-section">
        <h4>Game History</h4>
        <div class="history-timeline">
          <div v-for="(log, lIdx) in gameHistory.slice().reverse()" :key="lIdx" class="timeline-log-row">
            📌 {{ log }}
          </div>
          <div v-if="!gameHistory.length" class="empty-history">No events logged yet.</div>
        </div>
      </div>
      
      <div class="sidebar-footer-actions">
        <button class="btn btn-sidebar-forfeit" @click="triggerForfeitConfirmation">🏳️ Forfeit Match</button>
      </div>
    </div>
  </div>
  <div v-if="isMenuOpen" class="drawer-backdrop" @click="toggleMenu"></div>

  <!-- Lobby -->
  <div v-if="!isJoined" class="lobby-container">
    <div class="lobby-card">
      <h1 class="brand-title">Scrabble.</h1>
      <p class="subtitle">Enter details to create or join a match room</p>
      <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>
      <div class="input-group">
        <label>Your Name</label>
        <input v-model="playerName" type="text" placeholder="e.g., Davies" maxlength="12" />
      </div>
      <hr class="divider"/>
      <div class="lobby-actions">
        <button class="btn btn-primary btn-block" @click="handleCreateRoom">Create New Room</button>
        <div class="join-zone">
          <input v-model="inputRoomCode" type="text" placeholder="Enter 6-Char Code" maxlength="6" class="code-input" />
          <button class="btn btn-alt" @click="() => handleJoinRoom(false)">Join Room</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Game -->
  <div v-else class="game container">
    <header class="game-header">
      <div class="header-left-group">
        <button class="sandwich-trigger" @click="toggleMenu" aria-label="Open Game Menu">
          <div class="bar"></div>
          <div class="bar"></div>
          <div class="bar"></div>
        </button>
        <h2>Room Code: <span class="room-highlight">{{ room }}</span></h2>
      </div>

      <div class="header-right-group">
        <div :class="['turn-indicator', { 'your-turn': isMyTurn }]">
          {{ isMyTurn ? "Your Turn!" : "Waiting for opponent..." }}
        </div>
      </div>
    </header>

    <section class="notification-center">
      <div v-if="joinMessage" class="join-alert">ℹ️ {{ joinMessage }}</div>
      <div v-if="latestPlayMessage" class="play-alert">🎯 Last Move: <span class="bold-log">{{ latestPlayMessage }}</span></div>
    </section>

    <main class="game-arena">
      <div class="board-wrapper">
        <Board :board="board2D" @drop="handleDrop" @cell-click="onCellClick" />
        
        <div class="tile-point-indicators">
          <div v-for="(row, rIndex) in board2D" :key="rIndex" class="indicator-row">
            <div v-for="(cell, cIndex) in row" :key="cIndex" class="indicator-cell">
              <div 
                v-if="cell" 
                class="draggable-board-surface-node"
                :draggable="isMyTurn"
                @dragstart="onBoardTileDragStart($event, { r: rIndex, c: cIndex, letter: cell })"
                @dragend="onDragEnd"
              >
                <span class="board-pts-badge">{{ LETTER_SCORES[cell] || 1 }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="rack-wrapper">
        <h3 class="rack-label">Your Rack:</h3>
        <div class="rack" :class="{ 'disabled-rack': !isMyTurn }" role="list">
          <component :is="Tile" 
            v-for="t in myRack" 
            :key="t.rackId" 
            :letter="t.letter" 
            :score="t.pts" 
            :selected="selectedRackIdx === t.rackId" 
            @dragstart="onDragStart($event, t)" 
            @dragend="onDragEnd"
            @click="selectTile(t.letter, t.rackId)"
          />
          <div v-if="!myRack.length && !pendingMoves.length" class="rack-empty">Waiting for opponent to connect...</div>
        </div>
      </div>

      <div v-if="isMyTurn && pendingMoves.length > 0" class="turn-confirmation-bar">
         <button class="btn btn-danger" @click="recallTiles">Clear All Staged</button>
         <button class="btn btn-success" @click="confirmTurn">Confirm & Submit Word</button>
      </div>

      <div class="controls">
        <div class="scores">
          <h3>Scoreboard</h3>
          <div v-for="(p, idx) in players" :key="idx" :class="['player-row', { 'active-player': idx === currentPlayerIndex }]">
            <span class="dot">●</span> 
            <span class="p-name">{{ p.name }} <span v-if="p.name.toLowerCase() === name.toLowerCase()">(You)</span></span>
            <span class="p-score">{{ p.score }} pts</span>
          </div>
        </div>
        <div class="actions">
          <button :disabled="!isMyTurn || pendingMoves.length > 0" class="btn btn-alt" @click="exchange">Exchange All</button>
          <button :disabled="!isMyTurn || pendingMoves.length > 0" class="btn btn-primary" @click="pass">Pass Turn</button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.game-arena, .board-wrapper, .rack, .indicator-cell, .draggable-board-surface-node {
  touch-action: none !important;
  -webkit-text-size-adjust: 100%;
  -webkit-user-select: none;
  user-select: none;
}

/* Invalid Word Notification */
.invalid-word-notification {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100000;
  animation: slideDown 0.3s ease-out;
}

.invalid-word-content {
  background: #ff5252;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  font-weight: bold;
}

.error-icon {
  font-size: 20px;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-100%);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.slide-down-enter-active, .slide-down-leave-active {
  transition: all 0.3s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-100%);
}

/* Reconnect Overlay */
.reconnect-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999999;
  backdrop-filter: blur(4px);
}

.reconnect-dots {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.reconnect-dots span {
  width: 8px;
  height: 8px;
  background: #b71c1c;
  border-radius: 50%;
  animation: dotPulse 1.4s infinite ease-in-out both;
}

.reconnect-dots span:nth-child(1) { animation-delay: -0.32s; }
.reconnect-dots span:nth-child(2) { animation-delay: -0.16s; }

.reconnect-progress {
  margin-top: 12px;
  color: #ccc;
  font-size: 12px;
  font-family: monospace;
}

@keyframes dotPulse {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

.btn-retry-manual {
  margin-top: 20px;
  padding: 8px 16px;
  background: #fff;
  color: #b71c1c;
  border: none;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-retry-manual:hover {
  background: #b71c1c;
  color: white;
  transform: scale(1.05);
}

/* Modal Styles */
.confirm-modal-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.6); display: flex; justify-content: center; align-items: center; z-index: 99999; font-family: system-ui, sans-serif; }
.confirm-modal-box { background: white; padding: 28px; border-radius: 12px; width: 90%; max-width: 420px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.25); animation: zoomPop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.warn-icon { font-size: 40px; margin-bottom: 12px; }
.confirm-modal-box h3 { margin: 0 0 10px 0; font-size: 22px; color: #111; font-weight: bold; }
.confirm-modal-box p { font-size: 14px; color: #555; line-height: 1.5; margin: 0 0 24px 0; }
.modal-button-row { display: flex; gap: 12px; }
.modal-btn { flex: 1; padding: 12px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px; transition: background 0.2s; }
.btn-cancel { background: #e0e0e0; color: #333; }
.btn-cancel:hover { background: #d5d5d5; }
.btn-confirm-forfeit { background: #c62828; color: white; }
.btn-confirm-forfeit:hover { background: #b71c1c; }

/* Loading Overlay */
.loading-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(255, 255, 255, 0.85); display: flex; justify-content: center; align-items: center; z-index: 999999; }
.spinner-box { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.spinner { width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #b71c1c; border-radius: 50%; animation: spin 1s linear infinite; }
.loading-text { font-size: 16px; font-weight: bold; color: #333; font-family: system-ui, sans-serif; margin: 0; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

/* Header Styles */
.header-left-group, .header-right-group { display: flex; align-items: center; gap: 12px; }

/* Bingo Popup */
.bingo-popup-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 99999; pointer-events: none; }
.bingo-popup-content { background: linear-gradient(135deg, #ffca28, #ff8f00); padding: 32px 48px; border-radius: 16px; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,0.3); animation: zoomPop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275); color: #fff; }
.bingo-popup-content h2 { font-size: 42px; margin: 8px 0; font-family: 'Georgia', serif; font-weight: 900; letter-spacing: 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
.bingo-popup-content p { margin: 0; font-weight: bold; font-size: 16px; }
.bingo-stars { font-size: 36px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@keyframes zoomPop { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* Sidebar Styles */
.sandwich-trigger { background: transparent; border: none; cursor: pointer; display: flex; flex-direction: column; gap: 5px; padding: 8px; justify-content: center; z-index: 10; }
.sandwich-trigger .bar { width: 24px; height: 3px; background-color: #333; border-radius: 2px; transition: 0.3s; }
.sandwich-trigger:hover .bar { background-color: #b71c1c; }

.sandwich-sidebar { position: fixed; top: 0; left: -320px; width: 320px; height: 100%; background: #ffffff; box-shadow: 4px 0 24px rgba(0,0,0,0.15); transition: transform 0.3s cubic-bezier(0.77,0.2,0.05,1.0); z-index: 1000; display: flex; flex-direction: column; text-align: left; }
.sandwich-sidebar.drawer-open { transform: translateX(320px); }
.drawer-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); z-index: 999; }

.drawer-header { padding: 20px; background: #b71c1c; color: white; display: flex; justify-content: space-between; align-items: center; }
.drawer-header h3 { margin: 0; font-size: 18px; font-weight: bold; }
.close-btn { background: transparent; border: none; color: white; font-size: 20px; cursor: pointer; }
.drawer-body { padding: 20px; flex: 1; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; }

.bag-counter-card { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; display: flex; justify-content: center; text-align: center; }
.bag-stat { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bag-qty { font-size: 36px; font-weight: 900; color: #b71c1c; }
.bag-lbl { font-size: 13px; color: #666; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

.history-section h4 { border-bottom: 2px solid #f5f5f5; padding-bottom: 8px; margin: 0 0 10px 0; font-size: 14px; color: #444; text-transform: uppercase; letter-spacing: 0.5px; }
.history-timeline { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; }
.timeline-log-row { font-size: 13px; color: #555; background: #fafafa; border-left: 3px solid #b71c1c; padding: 6px 10px; border-radius: 0 4px 4px 0; line-height: 1.4; }
.empty-history { font-size: 13px; color: #999; text-align: center; padding: 20px 0; }

.sidebar-footer-actions { border-top: 2px solid #f5f5f5; padding-top: 16px; margin-top: auto; }
.btn-sidebar-forfeit { background: #fff5f5; color: #c62828; border: 1px solid #ffcdd2; width: 100%; padding: 12px; font-size: 14px; font-weight: bold; border-radius: 6px; cursor: pointer; text-align: center; transition: background 0.2s; }
.btn-sidebar-forfeit:hover { background: #ffebee; }

/* Game Styles */
.brand-title { color: #b71c1c; font-family: 'Georgia', serif; font-weight: 900; font-size: 42px; margin: 0 0 4px 0; letter-spacing: -1px; }

.board-wrapper { position: relative; max-width: 100%; display: inline-block; margin: 0 auto; }
.tile-point-indicators { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; display: flex; flex-direction: column; }
.indicator-row { display: flex; flex: 1; }
.indicator-cell { flex: 1; position: relative; }
.draggable-board-surface-node { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; cursor: grab; }
.draggable-board-surface-node:active { cursor: grabbing; }
.board-pts-badge { position: absolute; bottom: 2px; right: 3px; font-size: 8px; font-weight: bold; color: #444; font-family: sans-serif; background: rgba(255,255,255,0.85); padding: 0px 2px; border-radius: 2px; line-height: 1; }

.notification-center { max-width: 600px; margin: 0 auto 16px auto; display: flex; flex-direction: column; gap: 8px; }
.join-alert { background: #e3f2fd; color: #0d47a1; padding: 8px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; text-align: center; }
.play-alert { background: #fff8e1; color: #b7791f; padding: 10px 14px; border-radius: 6px; font-size: 14px; text-align: center; border: 1px dashed #ffe082; }
.bold-log { font-weight: bold; color: #333; text-transform: capitalize; }

.turn-confirmation-bar { display: flex; gap: 12px; justify-content: center; max-width: 600px; margin: 12px auto; }
.btn-success { background: #2e7d32; color: white; flex: 1; padding: 12px; font-size: 15px; }
.btn-success:hover { background: #1b5e20; }
.btn-danger { background: #c62828; color: white; padding: 12px 20px; font-size: 15px; }

.lobby-container { display: flex; justify-content: center; align-items: center; min-height: 80vh; font-family: system-ui, sans-serif; }
.lobby-card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); width: 100%; max-width: 400px; text-align: center; }
.subtitle { color: #666; font-size: 14px; margin-bottom: 24px; }
.error-banner { background: #ffebee; color: #c62828; padding: 10px; border-radius: 6px; margin-bottom: 16px; }
.input-group { text-align: left; margin-bottom: 20px; }
.input-group label { display: block; font-size: 13px; font-weight: bold; margin-bottom: 6px; }
.input-group input, .code-input { width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 6px; font-size: 16px; box-sizing: border-box; }
.divider { border: 0; border-top: 1px solid #eee; margin: 24px 0; }
.lobby-actions { display: flex; flex-direction: column; gap: 16px; }
.btn-block { width: 100%; padding: 14px; }
.join-zone { display: flex; gap: 8px; }
.code-input { flex: 1; text-transform: uppercase; text-align: center; }

.container { max-width: 900px; margin: 0 auto; padding: 16px; text-align: center; }
.game-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #eee; padding-bottom: 12px; gap: 12px; }
.room-highlight { color: #1f8ceb; font-weight: 800; background: #e3f2fd; padding: 2px 8px; border-radius: 4px; }
.turn-indicator { padding: 6px 16px; border-radius: 20px; background: #e0e0e0; font-weight: bold; color: #666; font-size: 14px; }
.turn-indicator.your-turn { background: #4caf50; color: white; animation: pulse 2s infinite; }
.rack-wrapper { max-width: 600px; margin: 16px auto; }
.rack-label { font-size: 14px; color: #555; text-align: left; }
.rack { display: flex; gap: 8px; justify-content: center; background: #eae2d2; padding: 12px; border-radius: 8px; min-height: 56px; }
.disabled-rack { opacity: 0.6; pointer-events: none; }
.controls { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 600px; margin: 20px auto; background: #f9f9f9; padding: 16px; border-radius: 8px; border: 1px solid #eee; text-align: left; }
.player-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; color: #555; }
.active-player { font-weight: bold; color: #000; }
.active-player .dot { color: #4caf50; }
.p-score { margin-left: auto; }
.actions { display: flex; flex-direction: column; gap: 10px; }
.btn { padding: 10px 16px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; }
.btn:disabled { background: #dcdcdc !important; color: #999 !important; }
.btn-primary { background: #1f8ceb; color: white; }
.btn-alt { background: #e0e0e0; color: #333; }
@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.03); } 100% { transform: scale(1); } }
</style>