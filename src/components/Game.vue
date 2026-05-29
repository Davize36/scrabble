<script setup>
import { ref, onBeforeUnmount, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Board from './Board.vue'
import Tile from './Tile.vue'
import { supabase, supabaseUrl, supabaseKey } from '../supabase.js' 

const route = useRoute()
const router = useRouter()

// Authentication & Profile States
const currentUser = ref(null)
const profileData = ref({ username: '', wins: 0, losses: 0 })
const authEmail = ref('')
const authPassword = ref('')
const authUsername = ref('')
const isSignUpMode = ref(false)
const showProfileMenu = ref(false)
const isLoadingProfile = ref(true) 
const profileLoadError = ref(false)
const isGuestMode = ref(false)
const isSigningOut = ref(false)

// UI Toggle States
const inputRoomCode = ref('')
const isJoined = ref(false)
const errorMessage = ref('')
const isProcessing = ref(false) 
const isRoomLoading = ref(false)
const loadingMessage = ref('')   
const showForfeitModal = ref(false) 
const showBingoNotification = ref(false)
const isMenuOpen = ref(false)
const playerName = ref('')

// Core game structural matrices
const boardFlat = ref(Array(225).fill(''))
const latestPlayMessage = ref('') 
const joinMessage = ref('')       
const players = ref([])
const currentPlayerIndex = ref(0)
const selectedLetter = ref(null)
const selectedRackIdx = ref(null) 
const bag = ref([])
const gameHistory = ref([])

const room = ref('')
let gameChannel = null
let gamePollInterval = null
let gameDataLoaded = false
const sessionGuestId = ref('guest-' + Math.random().toString(36).substring(2, 10))

// --- BACKEND DICTIONARY VALIDATION ENGINE ---
async function validateWords(moves) {
  const words = computeTurnWords(moves).map(positions => 
    positions.map(p => p.letter).join('').toUpperCase()
  )
  
  if (words.length === 0) return true

  try {
    const { data: invalidWords, error } = await supabase
      .rpc('validate_words_list', { input_words: words })

    if (error) throw error

    if (invalidWords && invalidWords.length > 0) {
      const badWord = invalidWords[0].invalid_word
      errorMessage.value = `"${badWord}" is not a valid word!`
      return false
    }
    
    return true
  } catch (err) {
    console.error('Dictionary backend verification failed:', err)
    errorMessage.value = "Unable to verify words against server dictionary."
    return false
  }
}

// --- BROWSER REFRESH PERSISTENCE LOGIC ---
async function checkAndReconnect() {
  const savedRoomCode = localStorage.getItem('activeScrabbleRoom')
  if (savedRoomCode) {
    inputRoomCode.value = savedRoomCode
    playerName.value = profileData.value.username || 'Player'
    if (playerName.value) {
      await handleJoinRoom()
    }
  }
}

// Check active session on load with timeout
onMounted(async () => {
  document.addEventListener('click', handleOutsideClick)
  
  const loadTimeout = setTimeout(async () => {
    if (isLoadingProfile.value || isProcessing.value || isRoomLoading.value) {
      console.warn('Profile loading timeout - proceeding with fallback')
      isLoadingProfile.value = false
      profileLoadError.value = false
      isProcessing.value = false 
      isRoomLoading.value = false
      loadingMessage.value = ''
      if (!currentUser.value) {
        currentUser.value = null
        isGuestMode.value = true
        profileData.value = { username: 'Guest', wins: 0, losses: 0 }
        playerName.value = 'Guest'
      }
      await checkAndReconnect()
    }
  }, 5000)
  
  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    clearTimeout(loadTimeout)
    
    if (session) {
      await handleUserSessionFetch(session.user)
    } else {
      isLoadingProfile.value = false
      isProcessing.value = false
    }
    
    await checkAndReconnect()

  } catch (err) {
    clearTimeout(loadTimeout)
    console.error('Session check error:', err)
    isLoadingProfile.value = false
    isProcessing.value = false
    profileData.value = { username: 'Guest', wins: 0, losses: 0 }
    await checkAndReconnect()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  stopGamePolling()
})

function handleOutsideClick(event) {
  const profileMenu = document.querySelector('.profile-dropdown')
  const userInfo = document.querySelector('.user-info')
  if (profileMenu && userInfo && !profileMenu.contains(event.target) && !userInfo.contains(event.target)) {
    showProfileMenu.value = false
  }
}

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    await handleUserSessionFetch(session.user)
  } else if (event === 'SIGNED_OUT' && !session) {
    currentUser.value = null
    isGuestMode.value = false
    profileData.value = { username: '', wins: 0, losses: 0 }
    authUsername.value = ''
    isLoadingProfile.value = false
    showProfileMenu.value = false
    resetLocalState()
  }
})

async function handleUserSessionFetch(user) {
  if (!user) {
    isLoadingProfile.value = false
    profileLoadError.value = false
    isProcessing.value = false
    return
  }
  
  currentUser.value = user
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    
    if (!error && data) {
      profileData.value = data
      authUsername.value = ''
    } else if (error && error.code === 'PGRST116') {
      const username = authUsername.value || user.id.slice(0, 8)
      
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          username: username,
          wins: 0,
          losses: 0
        })
        .select()
        .single()
      
      if (newProfile && !insertError) {
        profileData.value = newProfile
        authUsername.value = ''
      } else {
        throw insertError || new Error('Failed to create profile')
      }
    } else {
      throw error
    }
  } catch (err) {
    console.error('Profile error:', err)
    profileData.value = {
      id: user.id,
      username: authUsername.value || user.id.slice(0, 8) || 'Player',
      wins: 0,
      losses: 0
    }
    authUsername.value = ''
  } finally {
    isLoadingProfile.value = false
    profileLoadError.value = false
    isProcessing.value = false 
  }
}

async function handleAuthAction() {
  if (!authEmail.value || !authPassword.value) {
    errorMessage.value = "Please fill in email and password lines."
    return
  }
  errorMessage.value = ""
  isProcessing.value = true
  
  try {
    if (isSignUpMode.value) {
      if (!authUsername.value.trim()) {
        errorMessage.value = "Username is required!"
        isProcessing.value = false
        return
      }
      
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: authEmail.value,
        password: authPassword.value,
        options: {
          data: { username: authUsername.value.trim() }
        }
      })
      if (signUpError) throw signUpError
      
      if (signUpData.user) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        await handleUserSessionFetch(signUpData.user)
      }
    } else {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail.value,
        password: authPassword.value
      })
      if (signInError) throw signInError
      if (signInData.user) {
        await handleUserSessionFetch(signInData.user)
      }
    }
  } catch (err) {
    console.error("Authentication process caught error:", err)
    errorMessage.value = err.message || "An unexpected auth execution drop occurred."
    isLoadingProfile.value = false 
    isRoomLoading.value = false
    loadingMessage.value = ''
  } finally {
    isProcessing.value = false
    isLoadingProfile.value = false
    isRoomLoading.value = false
    loadingMessage.value = ''
  }
}

function signInAsGuest() {
  isGuestMode.value = true
  currentUser.value = null
  profileData.value = { username: 'Guest', wins: 0, losses: 0 }
  isLoadingProfile.value = false
  errorMessage.value = ''
}

async function handleLogout() {
  isSigningOut.value = true
  showProfileMenu.value = false
  try {
    await new Promise(resolve => setTimeout(resolve, 800))
    if (currentUser.value) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
  } catch (err) {
    console.error('Logout error:', err)
  } finally {
    isSigningOut.value = false
  }
  currentUser.value = null
  isGuestMode.value = false
  profileData.value = { username: '', wins: 0, losses: 0 }
  authUsername.value = ''
  resetLocalState()
  showProfileMenu.value = false
}

function toggleProfileMenu() {
  showProfileMenu.value = !showProfileMenu.value
}

function hasValidMove(rack, board) {
  return rack.length > 0 && board.some(cell => cell !== '')
}

async function isGameOver(playersList, currentBag, currentBoard) {
  if (currentBag.length === 0 && playersList.some(p => p.rack.length === 0)) return true
  
  for (const player of playersList) {
    if (hasValidMove(player.rack, currentBoard)) return false
  }
  return true
}

// --- SCRABBLE ENGINE ---
const board2D = computed(() => {
  const grid = []
  const currentBoard = [...boardFlat.value]
  pendingMoves.value.forEach(move => {
    const flatIndex = move.r * 15 + move.c
    if (flatIndex >= 0 && flatIndex < 225) {
      currentBoard[flatIndex] = move.letter
    }
  })
  for (let i = 0; i < 15; i++) {
    grid.push(currentBoard.slice(i * 15, (i + 1) * 15))
  }
  return grid
})

const LETTER_SCORES = {
  A:1, B:3, C:3, D:2, E:1, F:4, G:2, H:4, I:1, J:8, K:5, L:1, M:3,
  N:1, O:1, P:3, Q:10, R:1, S:1, T:1, U:1, V:4, W:4, X:8, Y:4, Z:10
}
const LETTER_COUNTS = {
  A:10, B:2, C:2, D:4, E:15, F:2, G:3, H:2, I:10, J:1, K:1, L:4, M:2,
  N:8, O:10, P:2, Q:1, R:8, S:6, T:8, U:5, V:2, W:2, X:1, Y:2, Z:1
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

function createOfficialBag() {
  const fullBag = []
  for (const [letter, count] of Object.entries(LETTER_COUNTS)) {
    for (let i = 0; i < count; i++) fullBag.push({ letter, pts: LETTER_SCORES[letter] })
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
      return true
    }
  }
  return false
}

function drawSmartTiles(targetBag, count) {
  let drawn = []
  for (let i = 0; i < Math.min(count, targetBag.length); i++) {
    drawn.push(targetBag.pop())
  }
  return drawn
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

function getTurnWordDescription(moves) {
  const words = computeTurnWords(moves).map(positions => positions.map(p => p.letter).join(''))
  if (!words.length) return ''
  if (words.length === 1) return words[0]
  return words.join(', ')
}

function addToHistory(playerName, action, details, scoreChange = null) {
  const historyEntry = {
    id: gameHistory.value.length,
    timestamp: new Date(),
    playerName,
    action,
    details,
    scoreChange: scoreChange,
    turnNumber: gameHistory.value.filter(h => h.action === 'played').length + 1
  }
  gameHistory.value.push(historyEntry)
  
  if (gameHistory.value.length > 50) {
    gameHistory.value.shift()
  }
}

// --- DRAG, DROP AND PLACEMENT HANDLERS ---
const activeDraggedTile = ref(null)
const boardDragSourceIdx = ref(null) 
const pendingMoves = ref([])

function validatePlacement() {
  if (pendingMoves.value.length === 0) return false
  const firstMove = pendingMoves.value[0]
  const allSameRow = pendingMoves.value.every(m => m.r === firstMove.r)
  const allSameCol = pendingMoves.value.every(m => m.c === firstMove.c)
  
  if (!allSameRow && !allSameCol) {
    errorMessage.value = "Invalid placement! Tiles must be arranged in a straight line."
    return false
  }

  const isFirstMoveOfGame = boardFlat.value.every(cell => cell === '')
  if (isFirstMoveOfGame) {
    const hitsCenter = pendingMoves.value.some(m => m.r === 7 && m.c === 7)
    if (!hitsCenter) {
      errorMessage.value = "The first word must pass through the center tile (Row 8, Column 8)!"
      return false
    }
    if (pendingMoves.value.length < 2) {
      errorMessage.value = "The first word must have at least 2 tiles."
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
    errorMessage.value = "Your word must touch an existing letter already on the board."
    return false
  }
  return true
}

function recallTiles() {
  pendingMoves.value = []
  errorMessage.value = ''
}

function promiseTimeout(ms, promise) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

async function rawInsertGame(gameData) {
  const url = `${supabaseUrl}/rest/v1/games`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify([gameData])
  })

  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch (err) {
    throw new Error(`Raw insert parse failed: ${text}`)
  }

  if (!response.ok) {
    throw new Error(`Raw insert failed (${response.status}): ${JSON.stringify(json)}`)
  }

  return Array.isArray(json) ? json[0] : json
}

async function findExistingRoom(roomCode) {
  const { data, error } = await promiseTimeout(8000, supabase
    .from('games')
    .select('*')
    .eq('room_code', roomCode)
    .maybeSingle())

  if (error && error.code !== 'PGRST116') {
    throw error
  }

  return data
}

// --- SUPABASE GAME EXECUTION ---
async function handleCreateRoom() {
  if (isLoadingProfile.value) {
    errorMessage.value = "Still loading your profile. Please wait a moment..."
    return
  }
  
  if (!playerName.value.trim()) {
    errorMessage.value = "Please enter your name first!"
    return
  }
  
  errorMessage.value = ""
  isRoomLoading.value = true
  loadingMessage.value = "Creating game room..."
  
  const newRoomCode = Array.from({ length: 6 }, () => 
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charAt(Math.floor(Math.random() * 36))
  ).join('');
  const freshBag = createOfficialBag()
  const initialRack = drawSmartTiles([...freshBag], 7)
  const username = playerName.value.trim()
  
  try {
    if (currentUser.value && (!profileData.value.username || profileData.value.username === 'Guest')) {
      await supabase
        .from('profiles')
        .update({ username })
        .eq('id', currentUser.value.id)
      profileData.value.username = username
    }

    const gameData = {
      room_code: newRoomCode,
      board_state: Array(225).fill(''),
      tile_bag: freshBag,
      players_json: [{ 
        id: currentUser.value?.id || sessionGuestId.value, 
        name: username, 
        rack: initialRack, 
        score: 0 
      }],
      status: 'pending',
      current_turn_name: username,
      latest_play: '',
      host_id: currentUser.value?.id || null,
      created_at: new Date().toISOString()
    }

    const fallbackRow = await rawInsertGame(gameData)
    room.value = newRoomCode
    isJoined.value = true
    gameDataLoaded = false
    
    // Drop the persistence anchor
    localStorage.setItem('activeScrabbleRoom', newRoomCode)
    
    addToHistory(username, 'game_started', 'Game created', null)

    await startSupabaseSubscription(newRoomCode, fallbackRow) 
    
  } catch (err) {
    console.error('Create room error:', err)
    errorMessage.value = "Failed to create game room. Please try again."
  } finally {
    isRoomLoading.value = false
    loadingMessage.value = ''
  }
}

async function handleJoinRoom() {
  const code = inputRoomCode.value.trim().toUpperCase()
  
  if (!playerName.value.trim()) {
    errorMessage.value = "Please enter your name first!"
    return
  }
  
  if (!code) {
    errorMessage.value = "Please enter a room code!"
    return
  }
  
  errorMessage.value = ""
  isRoomLoading.value = true
  loadingMessage.value = "Joining game room..."
  
  try {
    const activeUrl = supabaseUrl
    const activeKey = supabaseKey

    if (!activeUrl || !activeKey) {
      throw new Error("Supabase environment configuration keys are missing or undefined.")
    }

    const getUrl = `${activeUrl}/rest/v1/games?room_code=eq.${code}`
    const getResponse = await fetch(getUrl, {
      method: 'GET',
      headers: {
        'apikey': activeKey,
        'Authorization': `Bearer ${activeKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!getResponse.ok) throw new Error(`Room lookup failed with status: ${getResponse.status}`)
    
    const rows = await getResponse.json()
    const gameData = (rows && rows.length > 0) ? rows[0] : null

    if (!gameData) {
      errorMessage.value = "Room code not found!"
      isRoomLoading.value = false
      return
    }
    
    let currentPlayers = []
    if (gameData.players_json) {
      currentPlayers = typeof gameData.players_json === 'string' 
        ? JSON.parse(gameData.players_json) 
        : [...gameData.players_json]
    }

    const username = playerName.value.trim()
    const currentUserId = currentUser.value?.id || sessionGuestId.value
    const alreadyIn = currentPlayers.some(p => p.id === currentUserId)
    
    if (alreadyIn) {
      room.value = code
      isJoined.value = true
      gameDataLoaded = false
      localStorage.setItem('activeScrabbleRoom', code)
      
      profileData.value.username = currentPlayers.find(p => p.id === currentUserId).name
      addToHistory(profileData.value.username, 'reconnected', `${profileData.value.username} reconnected`, null)
      await startSupabaseSubscription(code, gameData)
      return
    }
    
    if (currentPlayers.length >= 2) {
      errorMessage.value = "This match room is full."
      isRoomLoading.value = false
      return
    }
    
    let currentBag = []
    if (gameData.tile_bag) {
      currentBag = typeof gameData.tile_bag === 'string'
        ? JSON.parse(gameData.tile_bag)
        : [...gameData.tile_bag]
    }

    const startingRack = drawSmartTiles(currentBag, 7)

    const newPlayerNode = { 
      id: currentUserId, 
      name: username, 
      rack: JSON.parse(JSON.stringify(startingRack)), 
      score: 0 
    }

    currentPlayers.push(newPlayerNode)

    const patchUrl = `${activeUrl}/rest/v1/games?room_code=eq.${code}`
    const updatedPayload = {
      players_json: JSON.parse(JSON.stringify(currentPlayers)),
      tile_bag: currentBag,
      status: 'active'
    }

    const patchResponse = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'apikey': activeKey,
        'Authorization': `Bearer ${activeKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updatedPayload)
    })

    if (!patchResponse.ok) {
      const errDetails = await patchResponse.text()
      throw new Error(`Room update failed with status: ${patchResponse.status}. Details: ${errDetails}`)
    }
    
    const patchDataText = await patchResponse.text()
    let patchJson = patchDataText ? JSON.parse(patchDataText) : null
    const updatedRow = Array.isArray(patchJson) ? patchJson[0] : patchJson

    room.value = code
    isJoined.value = true
    gameDataLoaded = false
    localStorage.setItem('activeScrabbleRoom', code)
    
    addToHistory(username, 'joined', `${username} joined the game`, null)
    await startSupabaseSubscription(code, updatedRow || gameData)
    
  } catch (err) {
    console.error('Join room network execution error:', err)
    errorMessage.value = `Failed to join room cleanly: ${err.message}`
  } finally {
    isRoomLoading.value = false
    loadingMessage.value = ''
  }
}

async function startSupabaseSubscription(roomCode, initialData = null) {
  console.log('startSupabaseSubscription called for', roomCode)
  
  try {
    if (typeof pollingInterval !== 'undefined' && pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
  } catch (pollingErr) {
    console.log('Poller cleanup bypassed safely')
  }

  if (gameChannel) {
    try {
      await supabase.removeChannel(gameChannel)
    } catch (e) {
      console.warn('Error removing channel:', e)
    }
    gameChannel = null
  }
  
  try {
    let data = initialData
    
    if (!data) {
      const response = await promiseTimeout(5000, supabase
        .from('games')
        .select('*')
        .eq('room_code', roomCode)
        .single())
        
      data = response.data
      const error = response.error
      if (error && error.code !== 'PGRST116') throw error
    }
    
    if (!data) {
      errorMessage.value = "Game room not found."
      startGamePolling(roomCode)
      return
    }
    
    syncStateMap(data)

    gameChannel = supabase
      .channel(`room-${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `room_code=eq.${roomCode}`
        },
        (payload) => {
          console.log('⚡ Realtime Update Received!', payload.new)
          if (payload.new) {
            syncStateMap(payload.new)
          }
        }
      )
      .subscribe((status) => {
        console.log(`Subscription status for ${roomCode}:`, status)
      })

  } catch (err) {
    console.error('Fatal error setting up subscription:', err)
    errorMessage.value = "Error connecting to realtime server. Falling back to polling."
    startGamePolling(roomCode)
  }
}

function syncStateMap(data) {
  if (!data) return
  
  boardFlat.value = Array.isArray(data.board_state) 
    ? data.board_state 
    : (typeof data.board_state === 'string' ? JSON.parse(data.board_state) : Array(225).fill(''))
    
  bag.value = Array.isArray(data.tile_bag) 
    ? data.tile_bag 
    : (typeof data.tile_bag === 'string' ? JSON.parse(data.tile_bag) : [])
    
  const parsedPlayers = Array.isArray(data.players_json) 
    ? data.players_json 
    : (typeof data.players_json === 'string' ? JSON.parse(data.players_json) : [])
    
  players.value = parsedPlayers

  joinMessage.value = data.join_notification || ''
  latestPlayMessage.value = data.latest_play || ''
  
  if (players.value.length > 0 && data.current_turn_name) {
    const idx = players.value.findIndex(p => p.name === data.current_turn_name)
    currentPlayerIndex.value = idx !== -1 ? idx : 0
  }

  if (players.value.length >= 2 && data.status === 'active') {
    isJoined.value = true
    errorMessage.value = ""
  }

  if (data.status === 'finished' && currentUser.value) {
    supabase
      .from('profiles')
      .select('wins, losses')
      .eq('id', currentUser.value.id)
      .single()
      .then(({ data: updatedProfile }) => {
        if (updatedProfile) {
          profileData.value = { ...profileData.value, ...updatedProfile }
        }
      })
  }
  gameDataLoaded = true
}

function updateLocalGameState(record) {
  if (!record) return

  let parsedPlayers = []
  if (record.players_json) {
    parsedPlayers = typeof record.players_json === 'string'
      ? JSON.parse(record.players_json)
      : record.players_json
  }
  players.value = Array.isArray(parsedPlayers) ? parsedPlayers : []
  
  let parsedBag = []
  if (record.tile_bag) {
    parsedBag = typeof record.tile_bag === 'string'
      ? JSON.parse(record.tile_bag)
      : record.tile_bag
  }
  bag.value = Array.isArray(parsedBag) ? parsedBag : []

  if (record.join_notification) joinMessage.value = record.join_notification
  if (record.latest_play) latestPlayMessage.value = record.latest_play

  if (players.value.length > 0 && record.current_turn_name) {
    const idx = players.value.findIndex(p => p.name === record.current_turn_name)
    currentPlayerIndex.value = idx !== -1 ? idx : 0
  }
}

// --- CONFIRM AND COMMIT GAME TURN ENGINE ---
async function confirmTurn() {
  if (!isMyTurn.value) {
    errorMessage.value = "It's not your turn!"
    return
  }
  
  if (pendingMoves.value.length === 0) {
    errorMessage.value = "Place at least one tile!"
    return
  }
  
  if (!validatePlacement()) return
  
  isProcessing.value = true
  errorMessage.value = '' 
  
  try {
    const isValid = await validateWords(pendingMoves.value)
    if (!isValid) return

    const updatedBoardFlat = [...boardFlat.value]
    const updatedPlayers = JSON.parse(JSON.stringify(players.value))
    const updatedBag = [...bag.value]
    const activePlayer = updatedPlayers[localPlayerIndex.value]

    const turnScore = calculateScrabbleTurnScore(pendingMoves.value)
    const sorted = [...pendingMoves.value].sort((a, b) => a.r !== b.r ? a.r - b.r : a.c - b.c)
    const rackIndicesToRemove = sorted.map(m => m.rackId).filter(id => id !== undefined)
    
    sorted.forEach(move => {
      updatedBoardFlat[move.r * 15 + move.c] = move.letter
    })
    
    const keptTiles = activePlayer.rack.filter((_, idx) => !rackIndicesToRemove.includes(idx))
    activePlayer.rack = keptTiles
    activePlayer.score += turnScore

    const needed = 7 - activePlayer.rack.length
    if (needed > 0 && updatedBag.length > 0) {
      const replacements = drawSmartTiles(updatedBag, needed)
      activePlayer.rack.push(...replacements)
    }

    const wordDescription = getTurnWordDescription(pendingMoves.value)
    const isBingo = pendingMoves.value.length === 7
    const plainWordScore = isBingo ? (turnScore - 50) : turnScore
    const newPlayLog = `${profileData.value.username || 'Player'} played "${wordDescription}" (+${plainWordScore} pts)${isBingo ? " (BINGO! +50 pts)" : ""}`
    
    addToHistory(profileData.value.username || 'Player', 'played', wordDescription, turnScore)
    if (isBingo) addToHistory(profileData.value.username || 'Player', 'bingo', 'Played all 7 tiles!', 50)
    
    const nextPlayerIndex = (currentPlayerIndex.value + 1) % updatedPlayers.length
    const nextPlayerName = updatedPlayers[nextPlayerIndex].name
    
    const shouldEndMatch = await isGameOver(updatedPlayers, updatedBag, updatedBoardFlat)
    let winningPlayer = null
    let losingPlayer = null

    pendingMoves.value = []

    if (shouldEndMatch) {
      winningPlayer = updatedPlayers.reduce((max, p) => p.score > max.score ? p : max, updatedPlayers[0])
      losingPlayer = updatedPlayers.find(p => p.id !== winningPlayer.id)
      
      addToHistory(winningPlayer.name, 'game_ended', `${winningPlayer.name} wins with ${winningPlayer.score} points!`, null)
      
      if (winningPlayer && winningPlayer.id && !winningPlayer.id.startsWith('guest-')) await supabase.rpc('increment_wins', { user_id: winningPlayer.id })
      if (losingPlayer && losingPlayer.id && !losingPlayer.id.startsWith('guest-')) await supabase.rpc('increment_losses', { user_id: losingPlayer.id })
    }

    await supabase
      .from('games')
      .update({
        board_state: updatedBoardFlat,
        tile_bag: updatedBag,
        players_json: updatedPlayers,
        current_turn_name: shouldEndMatch ? 'game_over' : nextPlayerName,
        latest_play: shouldEndMatch ? `Game Over! ${winningPlayer?.name} wins!` : newPlayLog,
        status: shouldEndMatch ? 'finished' : 'active'
      })
      .eq('room_code', room.value)
    
    errorMessage.value = ''
  } catch (err) {
    console.error('Turn confirmation error:', err)
    errorMessage.value = "Failed to submit turn. Please try again."
  } finally { 
    isProcessing.value = false
  }
}

async function confirmForfeit() {
  showForfeitModal.value = false
  if (!room.value) return
  isProcessing.value = true
  loadingMessage.value = "Forfeiting match..."
  
  try {
    const currentUsername = profileData.value.username || 'Player'
    addToHistory(currentUsername, 'forfeited', `${currentUsername} forfeited the game`, null)
    
    if (gameChannel) {
      try {
        await supabase.removeChannel(gameChannel)
      } catch (chErr) {
        console.warn("Channel cleanup skipped:", chErr)
      }
      gameChannel = null
    }

    const url = `${supabaseUrl}/rest/v1/games?room_code=eq.${room.value}`
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Forfeit network request failed with status: ${response.status}`)
    }
    
    resetLocalState()
    
  } catch (err) {
    console.error('Forfeit execution error:', err)
    errorMessage.value = "Failed to forfeit game safely. Forcing exit..."
    resetLocalState()
  } finally {
    isProcessing.value = false
    loadingMessage.value = ''
  }
}

// --- INTERACTION FLOWS ---
let lastClickTime = 0
let lastClickedCell = { r: -1, c: -1 }

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
  pendingMoves.value.push({ r, c, letter: sourceTile.letter, rackId: sourceTile.rackId })
  errorMessage.value = ''
}

function onCellClick({ r, c }) {
  const currentTime = Date.now()
  const pendingIdx = pendingMoves.value.findIndex(m => m.r === r && m.c === c)
  if (pendingIdx !== -1 && (currentTime - lastClickTime < 300) && lastClickedCell.r === r && lastClickedCell.c === c) {
    pendingMoves.value.splice(pendingIdx, 1)
    lastClickTime = 0
    return
  }
  lastClickTime = currentTime
  lastClickedCell = { r, c }
  if (selectedLetter.value && isMyTurn.value) {
    handleDrop({ r, c })
    selectedLetter.value = null
    selectedRackIdx.value = null
  }
}

function selectTile(letter, rackId) {
  if (!isMyTurn.value) return
  selectedLetter.value = letter
  selectedRackIdx.value = rackId
}

function onDragStart(e, item) {
  if (!isMyTurn.value) { e.preventDefault(); return }
  boardDragSourceIdx.value = null
  activeDraggedTile.value = { letter: item.letter, rackId: item.rackId }
  e.dataTransfer.setData('text/plain', JSON.stringify(item))
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

function onDragEnd() {
  activeDraggedTile.value = null
  boardDragSourceIdx.value = null
}

async function exchange() {
  if (!isMyTurn.value || pendingMoves.value.length > 0) {
    errorMessage.value = "Cannot exchange tiles while tiles are placed on board!"
    return
  }
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
  addToHistory(profileData.value.username || 'Player', 'exchanged', 'Exchanged all tiles', null)
  await supabase
    .from('games')
    .update({ tile_bag: updatedBag, players_json: updatedPlayers, current_turn_name: updatedPlayers[nextPlayerIndex].name, latest_play: `${profileData.value.username || 'Player'} exchanged their tiles.` })
    .eq('room_code', room.value)
}

async function pass() {
  if (!isMyTurn.value || pendingMoves.value.length > 0) {
    errorMessage.value = "Cannot pass with tiles on board!"
    return
  }
  const nextPlayerIndex = (currentPlayerIndex.value + 1) % players.value.length
  addToHistory(profileData.value.username || 'Player', 'passed', 'Passed turn', null)
  await supabase
    .from('games')
    .update({ current_turn_name: players.value[nextPlayerIndex].name, latest_play: `${profileData.value.username || 'Player'} passed their turn.` })
    .eq('room_code', room.value)
}

function resetLocalState() {
  room.value = ''
  isJoined.value = false
  pendingMoves.value = []
  boardFlat.value = Array(225).fill('')
  gameHistory.value = []
  errorMessage.value = ''
  gameDataLoaded = false
  localStorage.removeItem('activeScrabbleRoom')
  if (gameChannel) {
    supabase.removeChannel(gameChannel)
    gameChannel = null
  }
}

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
}

function getActionIcon(action) {
  const icons = { 'played': '🎯', 'passed': '⏭️', 'exchanged': '🔄', 'joined': '👋', 'game_started': '🎮', 'game_ended': '🏆', 'forfeited': '⚠️', 'bingo': '✨' }
  return icons[action] || '📌'
}

watch(latestPlayMessage, (newMsg) => {
  if (newMsg && newMsg.includes("BINGO!")) {
    showBingoNotification.value = true
    setTimeout(() => { showBingoNotification.value = false }, 2000)
  }
})

const localPlayerIndex = computed(() => {
  const currentUserId = currentUser.value?.id || sessionGuestId.value
  return players.value.findIndex(p => p.id === currentUserId)
})
const isMyTurn = computed(() => {
  if (!players.value || players.value.length < 2 || localPlayerIndex.value === -1) return false
  return localPlayerIndex.value === currentPlayerIndex.value
})
const myRack = computed(() => {
  if (localPlayerIndex.value === -1) return []
  
  const me = players.value[localPlayerIndex.value]
  if (!me || !me.rack || !Array.isArray(me.rack)) return []
  
  let workingRack = me.rack.map((t, index) => {
    const letterStr = typeof t === 'object' ? (t.letter || '') : t;
    const pointsNum = typeof t === 'object' ? (t.pts || LETTER_SCORES[letterStr] || 0) : (LETTER_SCORES[t] || 0);
    return {
      letter: letterStr,
      pts: pointsNum,
      rackId: index
    }
  })

  const usedIndices = new Set(pendingMoves.value.map(m => m.rackId).filter(id => id !== undefined))
  return workingRack.filter((_, idx) => !usedIndices.has(idx))
})
</script>

<template>
  <div v-if="isProcessing" class="loading-overlay">
    <div class="spinner-box">
      <div class="spinner"></div>
      <p class="loading-text">{{ loadingMessage || 'Processing...' }}</p>
    </div>
  </div>

  <div v-if="isRoomLoading" class="loading-overlay">
    <div class="spinner-box">
      <div class="spinner"></div>
      <p class="loading-text">{{ loadingMessage || 'Connecting to match arena...' }}</p>
    </div>
  </div>

  <div v-if="isSigningOut" class="loading-overlay">
    <div class="spinner-box">
      <div class="spinner"></div>
      <p class="loading-text">Signing out...</p>
    </div>
  </div>
  
  <div v-if="showForfeitModal" class="confirm-modal-backdrop">
    <div class="confirm-modal-box">
      <h3>Forfeit Game?</h3>
      <p>This will award your opponent a permanent Win and register a Loss on your profile records.</p>
      <div class="modal-button-row">
        <button class="modal-btn btn-cancel" @click="showForfeitModal = false">Cancel</button>
        <button class="modal-btn btn-confirm-forfeit" @click="confirmForfeit">Confirm Forfeit</button>
      </div>
    </div>
  </div>

  <Transition name="fade">
    <div v-if="showBingoNotification" class="bingo-popup-overlay">
      <div class="bingo-popup-content">
        <span class="bingo-stars">✨🏆✨</span>
        <h2>BINGO!</h2>
        <p>All 7 tiles played! Bonus +50 Points Added.</p>
      </div>
    </div>
  </Transition>

  <div v-if="!isJoined" class="lobby-wrapper">
    <header class="lobby-brand-bar">
      <div class="brand-left">
        <span class="scrabble-logo-icon">🆂</span>
        <h1 class="main-logo-text">Scrabble<span class="dot-accent">.</span></h1>
      </div>
      
      <div class="user-profile-widget" v-if="currentUser || isGuestMode">
        <div class="user-info" @click="toggleProfileMenu">
          <div class="avatar-circle">
            {{ (profileData?.username || 'G').charAt(0).toUpperCase() }}
          </div>
          <span class="user-display-name">Profile</span>
          <span class="dropdown-chevron">▼</span>
        </div>
        
        <Transition name="dropdown-slide">
          <div v-if="showProfileMenu" class="profile-dropdown">
            <div class="dropdown-header-info">
              <p class="info-username">{{ profileData?.username || 'Guest' }}</p>
              <p class="info-email">{{ currentUser ? currentUser.email : 'Playing as guest' }}</p>
            </div>
            <div class="stats-grid-row">
              <div class="stat-box wins">
                <span class="stat-count">{{ profileData?.wins || 0 }}</span>
                <span class="stat-label">Wins</span>
              </div>
              <div class="stat-box losses">
                <span class="stat-count">{{ profileData?.losses || 0 }}</span>
                <span class="stat-label">Losses</span>
              </div>
            </div>
            <div class="dropdown-action-divider"></div>
            <button class="dropdown-logout-btn" @click="handleLogout" :disabled="isSigningOut">
              <span class="logout-icon">{{ isSigningOut ? '⏳' : '🚪' }}</span>
              {{ isSigningOut ? 'Signing out...' : (currentUser ? 'Sign Out Account' : 'Leave Guest Session') }}
            </button>
          </div>
        </Transition>
      </div>
    </header>

    <main class="lobby-content-container">
      <section v-if="!currentUser && !isLoadingProfile && !isGuestMode" class="auth-panel-card">
        <div class="card-header">
          <h2>{{ isSignUpMode ? 'Create Account' : 'Welcome Back' }}</h2>
          <p class="card-subtitle">
            {{ isSignUpMode ? 'Register an identity to track scores and match history' : 'Sign in to access your game profiles' }}
          </p>
        </div>
        
        <div v-if="errorMessage" class="error-banner-alert">
          <span class="alert-icon">⚠️</span> {{ errorMessage }}
        </div>

        <div class="form-body">
          <div v-if="isSignUpMode" class="input-field-group">
            <label class="field-label">Unique Handle</label>
            <input v-model="authUsername" type="text" placeholder="e.g., Davies" class="styled-text-input" />
          </div>
          
          <div class="input-field-group">
            <label class="field-label">Email Address</label>
            <input v-model="authEmail" type="email" placeholder="you@example.com" class="styled-text-input" />
          </div>
          
          <div class="input-field-group">
            <label class="field-label">Account Password</label>
            <input v-model="authPassword" type="password" placeholder="••••••••" class="styled-text-input" />
          </div>

          <button class="base-action-btn primary-solid" @click="handleAuthAction" :disabled="isProcessing">
            {{ isSignUpMode ? 'Register Account' : 'Sign In' }}
          </button>
          
          <p class="auth-toggle-switch" @click="isSignUpMode = !isSignUpMode">
            {{ isSignUpMode ? "Already have an account? Log In" : "Don't have an account? Sign Up Here" }}
          </p>

          <div class="guest-divider">
            <span class="guest-divider-line"></span>
            <span class="guest-divider-text">or</span>
            <span class="guest-divider-line"></span>
          </div>

          <button class="base-action-btn primary-outline" @click="signInAsGuest" :disabled="isProcessing">
            👤 Continue as Guest
          </button>
        </div>
      </section>

      <section v-else-if="isLoadingProfile" class="auth-panel-card central-spinner-layout">
        <div class="spinner-element"></div>
        <p class="loading-label-text">Fetching workspace profile...</p>
      </section>

      <section v-else class="auth-panel-card room-lobby-card">
        <div class="card-header">
          <h2>
            {{ profileData && profileData.username ? `Welcome back, ${profileData.username}` : 'Game Workspace' }}
          </h2>
          <p class="card-subtitle">Initialize a fresh arena or connect into a pending multiplayer game</p>
        </div>

        <div v-if="errorMessage" class="error-banner-alert">
          <span class="alert-icon">⚠️</span> {{ errorMessage }}
        </div>

        <div class="form-body">
          <div class="input-field-group">
            <label class="field-label">Display Player Name</label>
            <input v-model="playerName" type="text" placeholder="Enter matching nickname..." maxlength="12" class="styled-text-input text-center font-bold font-lg" />
          </div>

          <div class="workspace-action-split">
            <div class="action-block-left">
              <button class="base-action-btn primary-solid-green" @click="handleCreateRoom">
                ✨ Create New Arena
              </button>
            </div>

            <div class="split-vertical-divider">
              <span class="divider-text">OR</span>
            </div>

            <div class="action-block-right">
              <div class="join-code-input-wrapper">
                <input v-model="inputRoomCode" type="text" placeholder="6-CHAR CODE" maxlength="6" class="styled-text-input code-box-format uppercase" />
                <button class="base-action-btn primary-outline" @click="handleJoinRoom">
                  Join Room
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div v-else class="game-view-layout">
    <aside :class="['sandwich-sidebar', { 'drawer-open': isMenuOpen }]">
      <div class="drawer-header">
        <h3>Match Dashboard</h3>
        <button class="close-btn" @click="toggleMenu">✕</button>
      </div>
      
      <div class="drawer-body">
        <div class="bag-counter-card">
          <div class="bag-stat">
            <span class="bag-qty">{{ bag?.length || 0 }}</span>
            <span class="bag-lbl">Remaining Tiles</span>
          </div>
        </div>

        <div class="history-section">
          <h4>Game History</h4>
          <div class="history-timeline">
            <div v-for="log in gameHistory" :key="log.id" class="timeline-log-row">
              <span class="log-icon">{{ getActionIcon(log.action) }}</span>
              <div class="log-details-box">
                <p class="log-text-line">
                  <strong class="log-player">{{ log.playerName }}</strong> 
                  <span class="log-desc">{{ log.details }}</span>
                </p>
                <span class="log-timestamp">
                  {{ new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) }}
                </span>
              </div>
              <span v-if="log.scoreChange !== null" :class="['log-score-badge', log.scoreChange >= 50 ? 'high-score' : '']">
                +{{ log.scoreChange }}
              </span>
            </div>
            <div v-if="!gameHistory?.length" class="empty-history">
              No moves registered in this match session yet.
            </div>
          </div>
        </div>

        <div class="sidebar-footer-actions">
          <button class="btn-sidebar-forfeit" @click="showForfeitModal = true">
            🏳️ Forfeit Match
          </button>
        </div>
      </div>
    </aside>

    <div v-if="isMenuOpen" class="drawer-backdrop" @click="toggleMenu"></div>

    <div class="arena-main-content">
      <header class="arena-status-bar">
        <div class="bar-left-cluster">
          <button class="sandwich-trigger" @click="toggleMenu">
            <div class="bar"></div>
            <div class="bar"></div>
            <div class="bar"></div>
          </button>
          <div class="room-identity">
            <span class="label">ROOM</span>
            <span class="code-badge">{{ room }}</span>
          </div>
        </div>

        <div class="bar-right-actions">
          <div class="turn-status-ticker" :class="{ 'my-active-turn': isMyTurn, 'opponent-turn': !isMyTurn }">
            <span v-if="isMyTurn" class="turn-badge">Your Turn</span>
            <span v-else class="turn-badge">
              {{ players[currentPlayerIndex]?.name || 'Opponent' }}'s Turn
            </span>
          </div>
        </div>
      </header>

      <main class="arena-layout-plane">
        <div class="live-move-ticker-box">
          <div class="ticker-header-bar">
            <span class="ticker-dot">●</span> <span>Match Activity Log</span>
          </div>
          <div class="ticker-body">
            <p v-if="latestPlayMessage" class="ticker-text-line">
              ✨ {{ latestPlayMessage }}
            </p>
            <p v-else-if="joinMessage" class="ticker-text-line">
              👋 {{ joinMessage }}
            </p>
            <p v-else class="ticker-empty-line">
              🎮 Match started. Waiting for the opening tile placement move...
            </p>
          </div>
        </div>

        <div class="board-wrapper">
          <div class="board-wrapper-frame">
            <Board :board="board2D" :pending-moves="pendingMoves" @cell-click="onCellClick" @drop-tile="handleDrop" @dragstart-placed="onBoardTileDragStart" />
          </div>
        </div>

        <footer class="player-interaction-dock">
          <div class="interaction-dock-inner">
            <div class="rack-outer-frame">
              <div class="rack-wood-shelf">
                <div class="rack-tiles-container">
                  <Tile v-for="tile in myRack" :key="tile.rackId" :letter="tile.letter" :pts="tile.pts" :is-selected="selectedRackIdx === tile.rackId" @click="selectTile(tile.letter, tile.rackId)" @dragstart="onDragStart($event, tile)" @dragend="onDragEnd" />
                </div>
              </div>
              <div class="rack-base-shadow"></div>
            </div>

            <div class="controls">
              <div class="scores">
                <h3>Arena Scores</h3>
                <div v-for="(p, index) in players" :key="p.id || index" :class="['player-row', { 'active-player': index === currentPlayerIndex }]">
                  <span class="dot">●</span>
                  <span class="p-name">{{ p.name }} <template v-if="p.id === (currentUser?.id || sessionGuestId)">(You)</template></span>
                  <span class="p-score">{{ p.score }} pts</span>
                </div>
              </div>

              <div class="actions">
                <div class="action-button-matrix-row">
                  <button class="control-btn play-turn-btn" @click="confirmTurn" :disabled="!isMyTurn || pendingMoves?.length === 0">
                    🚀 Play Turn
                  </button>
                  <button class="control-btn utility-btn" @click="recallTiles" :disabled="pendingMoves?.length === 0">
                    ↩️ Recall
                  </button>
                </div>
                <div class="action-button-matrix-row">
                  <button class="control-btn utility-btn" @click="exchange" :disabled="!isMyTurn || pendingMoves?.length > 0">
                    🔄 Exchange
                  </button>
                  <button class="control-btn utility-btn" @click="pass" :disabled="!isMyTurn || pendingMoves?.length > 0">
                    ⏭️ Pass
                  </button>
                </div>
              </div>
            </div>

            <div class="error-console-wrapper">
              <Transition name="fade">
                <p v-if="errorMessage" class="console-error-message">
                  <span class="icon">❌</span> {{ errorMessage }}
                </p>
              </Transition>
            </div>
          </div>
        </footer>
      </main>
    </div>
  </div>
</template>

<style scoped>
/* --- BASE SYSTEM & INTERFACE STRUCTURAL FRAMEWORKS --- */
.lobby-wrapper {
  min-height: 100vh;
  background-color: #f4f6f8;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.lobby-brand-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 32px;
  background-color: #ffffff;
  border-bottom: 1px solid #e1e4e8;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.brand-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.scrabble-logo-icon {
  background-color: #e67e22;
  color: #ffffff;
  font-size: 24px;
  font-weight: 800;
  width: 36px;
  height: 36px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(230, 126, 34, 0.3);
}

.main-logo-text {
  font-size: 24px;
  font-weight: 800;
  color: #2c3e50;
  letter-spacing: -0.5px;
  margin: 0;
}

.dot-accent {
  color: #e67e22;
}

.user-profile-widget {
  position: relative;
  z-index: 1001;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background-color: #f8f9fa;
  border: 1px solid #e1e4e8;
  border-radius: 30px;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.user-info:hover {
  background-color: #f1f3f5;
  border-color: #d1d5db;
}

.avatar-circle {
  width: 26px;
  height: 26px;
  background-color: #34495e;
  color: #ffffff;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
}

.user-display-name {
  font-weight: 600;
  font-size: 14px;
  color: #34495e;
}

.dropdown-chevron {
  font-size: 10px;
  color: #7f8c8d;
}

.profile-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 240px;
  background-color: #ffffff;
  border: 1px solid #e1e4e8;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dropdown-header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-email {
  font-size: 12px;
  color: #7f8c8d;
  margin: 0;
  word-break: break-all;
}

.stats-grid-row {
  display: flex;
  gap: 10px;
}

.stat-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  border-radius: 8px;
  text-align: center;
}

.stat-box.wins {
  background-color: #e8f8f5;
  border: 1px solid #a3e4d7;
}

.stat-box.losses {
  background-color: #fdf2e9;
  border: 1px solid #fadbd8;
}

.stat-count {
  font-size: 18px;
  font-weight: 700;
}

.stat-box.wins .stat-count { color: #16a085; }
.stat-box.losses .stat-count { color: #e74c3c; }

.stat-label {
  font-size: 11px;
  font-weight: 600;
  color: #7f8c8d;
  text-transform: uppercase;
  margin-top: 2px;
}

.dropdown-action-divider {
  height: 1px;
  background-color: #e1e4e8;
}

.dropdown-logout-btn {
  background: none;
  border: 1px solid #fadbd8;
  padding: 8px 12px;
  border-radius: 6px;
  color: #c0392b;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.15s ease;
}

.dropdown-logout-btn:hover {
  background-color: #fdf2e9;
  border-color: #e74c3c;
}

.lobby-content-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px 20px;
}

.auth-panel-card {
  width: 100%;
  max-width: 520px;
  background-color: #ffffff;
  border: 1px solid #e1e4e8;
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
  padding: 40px;
  box-sizing: border-box;
}

.card-header {
  margin-bottom: 28px;
  text-align: center;
}

.card-header h2 {
  font-size: 26px;
  font-weight: 800;
  color: #2c3e50;
  margin: 0 0 8px 0;
}

.card-subtitle {
  font-size: 14px;
  color: #7f8c8d;
  margin: 0;
  line-height: 1.4;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.input-field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  font-weight: 700;
  color: #34495e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.styled-text-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 15px;
  color: #2c3e50;
  background-color: #ffffff;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.styled-text-input:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.15);
}

.text-center { text-align: center; }
.font-bold { font-weight: 700; }
.font-lg { font-size: 18px; }
.uppercase { text-transform: uppercase; }

.error-banner-alert {
  background-color: #fdf2e9;
  border-left: 4px solid #e67e22;
  padding: 12px 16px;
  border-radius: 0 8px 8px 0;
  color: #d35400;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
}

.base-action-btn {
  width: 100%;
  padding: 14px 24px;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}

.base-action-btn.primary-solid {
  background-color: #3498db;
  color: #ffffff;
}
.base-action-btn.primary-solid:hover { background-color: #2980b9; }

.base-action-btn.primary-solid-green {
  background-color: #2ecc71;
  color: #ffffff;
  box-shadow: 0 4px 6px rgba(46, 204, 113, 0.2);
}
.base-action-btn.primary-solid-green:hover { background-color: #27ae60; }

.base-action-btn.primary-outline {
  background: none;
  border: 2px solid #3498db;
  color: #3498db;
}
.base-action-btn.primary-outline:hover {
  background-color: #ebf5fb;
}

.auth-toggle-switch {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: #3498db;
  cursor: pointer;
  margin: 8px 0 0 0;
  user-select: none;
}
.auth-toggle-switch:hover { text-decoration: underline; }

.guest-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
}

.guest-divider-line {
  flex: 1;
  height: 1px;
  background-color: #e1e4e8;
}

.guest-divider-text {
  font-size: 12px;
  color: #7f8c8d;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.base-action-btn.guest-btn {
  display: none !important;
}

.info-username {
  font-size: 14px;
  font-weight: 700;
  color: #2c3e50;
  margin: 0;
}

.dropdown-logout-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.central-spinner-layout {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 60px 40px !important;
  text-align: center;
}

.spinner-element {
  width: 48px;
  height: 48px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin-kf 1s linear infinite;
  margin-bottom: 20px;
}

.loading-label-text {
  font-size: 15px;
  font-weight: 600;
  color: #7f8c8d;
  margin: 0;
}

@keyframes spin-kf {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.workspace-action-split {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 12px;
}

.action-block-left, .action-block-right {
  flex: 1;
}

.split-vertical-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  align-self: stretch;
}

.split-vertical-divider::before {
  content: '';
  width: 1px;
  height: 100px;
  background-color: #e1e4e8;
}

.divider-text {
  position: absolute;
  background-color: #ffffff;
  padding: 6px 0;
  color: #95a5a6;
  font-size: 11px;
  font-weight: 700;
}

.join-code-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.code-box-format {
  text-align: center;
  font-weight: 800;
  letter-spacing: 2px;
  font-size: 16px;
  text-transform: uppercase;
}

/* --- MAIN MULTIPLAYER MATCH ARENA INTERFACES --- */
.game-view-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #2c3e50;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}

.arena-main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.arena-status-bar {
  height: 64px;
  background-color: #1a252f;
  border-bottom: 1px solid #34495e;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  box-sizing: border-box;
  flex-shrink: 0;
}

.bar-left-cluster {
  display: flex;
  align-items: center;
  gap: 16px;
}

.sandwich-trigger {
  background: none;
  border: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
}
.sandwich-trigger:hover { background-color: #2c3e50; }
.sandwich-trigger .bar {
  width: 20px;
  height: 2px;
  background-color: #ffffff;
  border-radius: 2px;
}

.room-identity {
  display: flex;
  flex-direction: column;
}
.room-identity .label {
  font-size: 9px;
  font-weight: 700;
  color: #95a5a6;
  letter-spacing: 0.5px;
}
.room-identity .code-badge {
  font-size: 15px;
  font-weight: 800;
  color: #ecc94b;
  letter-spacing: 0.5px;
}

.arena-scoreboard {
  display: flex;
  gap: 12px;
}

.score-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background-color: #2c3e50;
  border: 1px solid #34495e;
  border-radius: 20px;
  color: #bdc3c7;
  transition: all 0.25s ease;
}

.score-pill .turn-dot {
  width: 6px;
  height: 6px;
  background-color: transparent;
  border-radius: 50%;
}

.score-pill .player-name {
  font-size: 13px;
  font-weight: 600;
}

.score-pill .player-score {
  font-size: 13px;
  font-weight: 800;
  color: #ffffff;
}

.score-pill.is-me-pill {
  border-color: #4a5568;
}
.score-pill.is-me-pill .player-name {
  color: #ffffff;
}

.score-pill.active-turn-indicator {
  background-color: #2c5282;
  border-color: #3182ce;
  color: #ffffff;
  box-shadow: 0 0 12px rgba(49, 130, 206, 0.3);
}
.score-pill.active-turn-indicator .turn-dot {
  background-color: #63b3ed;
  box-shadow: 0 0 8px #63b3ed;
  animation: pulse-kf 1.5s infinite;
}

@keyframes pulse-kf {
  0% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 0.5; }
}

.bar-right-actions {
  display: flex;
  align-items: center;
}

.live-status-ticker {
  display: flex;
  align-items: center;
  gap: 10px;
  background-color: #111827;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #1f2937;
  max-width: 320px;
}

.pulse-indicator {
  width: 8px;
  height: 8px;
  background-color: #e67e22;
  border-radius: 50%;
  flex-shrink: 0;
}

.ticker-message {
  font-size: 12px;
  font-weight: 600;
  color: #e2e8f0;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ARENA PLANE WORKSPACE GRID ARRANGEMENTS */
.arena-layout-plane {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  padding: 16px;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  width: 100%;
}

/* BOARD WORKSPACE BOUNDS */
.board-wrapper { 
  position: relative; 
  width: 100%;
  max-width: min(480px, 94vw);
  margin: 0 auto;
  margin-bottom: 24px; 
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.board-wrapper-frame {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

/* INTERACTION INTERFACES UNDERNEATH THE BOARD */
.player-interaction-dock {
  width: 100%;
  max-width: 480px;
  flex-shrink: 0;
  margin-top: 0;
}

.interaction-dock-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.rack-outer-frame {
  position: relative;
  width: 100%;
}

.rack-wood-shelf {
  background: linear-gradient(to bottom, #d69e2e, #b7791f);
  border-top: 1px solid #f6e05e;
  border-bottom: 2px solid #744210;
  border-radius: 4px;
  padding: 8px 12px;
  box-shadow: 0 6px 10px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.2);
  display: flex;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
}

.rack-tiles-container {
  display: flex;
  gap: min(6px, 1.5vw);
  min-height: 44px;
  justify-content: center;
  align-items: center;
  width: 100%;
  max-width: 100%;
}

.rack-tiles-container > * {
  flex-shrink: 1 !important;
  max-width: calc((100% / 7) - 4px) !important;
  aspect-ratio: 1 / 1;
}

.rack-base-shadow {
  position: absolute;
  top: 100%;
  left: 4%;
  width: 92%;
  height: 8px;
  background: rgba(0,0,0,0.4);
  filter: blur(4px);
  border-radius: 50%;
  z-index: 1;
}

.controls { 
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 16px; 
  width: 100%;
  max-width: 100%; 
  background: #1a252f; 
  padding: 14px; 
  border-radius: 8px; 
  border: 1px solid #34495e; 
  text-align: left; 
  box-sizing: border-box;
}

.scores h3 {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: #ecc94b; 
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: bold;
}

.player-row { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  padding: 4px 0; 
  color: #bdc3c7; 
  border-bottom: 1px solid rgba(52, 73, 94, 0.4);
}
.player-row:last-child {
  border-bottom: none;
}

.active-player { 
  font-weight: bold; 
  color: #ffffff; 
}

.active-player .dot { 
  color: #4caf50; 
}

.p-name {
  font-size: 12px;
}

.p-score { 
  margin-left: auto; 
  font-weight: bold;
  color: #ffffff;
}

.actions { 
  display: flex; 
  flex-direction: column; 
  gap: 8px; 
  justify-content: center; 
}

.action-button-matrix-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.control-btn {
  padding: 12px;
  border: none;
  border-radius: 6px;
  font-size: min(13px, 3.5vw);
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.play-turn-btn {
  flex: 2;
  background-color: #3182ce;
  color: #ffffff;
  box-shadow: 0 4px 6px rgba(49,130,206,0.2);
}
.play-turn-btn:not(:disabled):hover { background-color: #2b6cb0; }

.utility-btn {
  flex: 1;
  background-color: #4a5568;
  color: #e2e8f0;
  border: 1px solid #718096;
}
.utility-btn:not(:disabled):hover {
  background-color: #718096;
  color: #ffffff;
}

.error-console-wrapper {
  min-height: 20px;
  width: 100%;
}

.console-error-message {
  font-size: 12px;
  font-weight: 600;
  color: #fc8181;
  margin: 4px 0 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* --- SIDEBAR PANEL DRAWER SYSTEM --- */
.sandwich-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  width: 300px;
  height: 100vh;
  background-color: #1a252f;
  border-right: 1px solid #2c3e50;
  box-shadow: 5px 0 25px rgba(0,0,0,0.3);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.sandwich-sidebar.drawer-open {
  transform: translateX(0);
}

.drawer-header {
  padding: 16px;
  border-bottom: 1px solid #2c3e50;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #111827;
}

.drawer-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
}

.close-btn {
  background: none;
  border: none;
  color: #a0aec0;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
}
.close-btn:hover { color: #ffffff; }

.drawer-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow-y: auto;
  gap: 20px;
}

.bag-counter-card {
  background-color: #2c3e50;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #34495e;
}

.bag-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.bag-qty {
  font-size: 24px;
  font-weight: 800;
  color: #ecc94b;
}

.bag-lbl {
  font-size: 11px;
  font-weight: 600;
  color: #a0aec0;
  text-transform: uppercase;
  margin-top: 4px;
}

.history-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.history-section h4 {
  margin: 0 0 10px 0;
  font-size: 12px;
  font-weight: 700;
  color: #e2e8f0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.history-timeline {
  flex: 1;
  background-color: #111827;
  border: 1px solid #2c3e50;
  border-radius: 8px;
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timeline-log-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px;
  background-color: #1f2937;
  border-radius: 6px;
  border: 1px solid #2c3e50;
}

.log-icon { font-size: 13px; }
.log-details-box { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.log-text-line { margin: 0; font-size: 12px; color: #e2e8f0; line-height: 1.3; }
.log-player { color: #63b3ed; }
.log-timestamp { font-size: 9px; color: #718096; }

.log-score-badge {
  font-size: 10px;
  font-weight: 700;
  background-color: #2d3748;
  color: #a0aec0;
  padding: 2px 4px;
  border-radius: 4px;
}
.log-score-badge.high-score {
  background-color: #234e52;
  color: #4fd1c5;
}

.empty-history {
  padding: 16px;
  text-align: center;
  color: #718096;
  font-size: 12px;
  font-style: italic;
}

.sidebar-footer-actions {
  margin-top: auto;
}

.btn-sidebar-forfeit {
  width: 100%;
  background: none;
  border: 1px solid #742a2a;
  padding: 10px;
  border-radius: 6px;
  color: #feb2b2;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.btn-sidebar-forfeit:hover {
  background-color: #742a2a;
  color: #ffffff;
}

.drawer-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0,0,0,0.5);
  z-index: 9998;
}

.confirm-modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0,0,0,0.6);
  z-index: 100000;
  display: flex;
  justify-content: center;
  align-items: center;
}

.confirm-modal-box {
  background-color: #ffffff;
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
}

.confirm-modal-box h3 { margin: 0 0 8px 0; color: #1a202c; font-size: 17px; font-weight: 700; }
.confirm-modal-box p { margin: 0 0 16px 0; color: #4a5568; font-size: 14px; line-height: 1.4; }

.modal-button-row { display: flex; gap: 8px; }
.modal-btn { flex: 1; padding: 10px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
.btn-cancel { background: #eee; color: #333; }
.btn-confirm-forfeit { background: #c62828; color: white; }

.bingo-popup-overlay {
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #ecc94b 0%, #d69e2e 100%);
  padding: 16px 32px;
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.25), 0 0 0 4px rgba(255,255,255,0.2);
  text-align: center;
  z-index: 999999;
  border: 1px solid #f6e05e;
}

.bingo-stars { font-size: 28px; display: block; margin-bottom: 4px; }
.bingo-popup-overlay h2 { margin: 0; font-size: 30px; font-weight: 900; color: #1a202c; letter-spacing: 1px; text-shadow: 0 2px 4px rgba(255,255,255,0.4); }
.bingo-popup-overlay p { margin: 4px 0 0 0; font-size: 13px; font-weight: 700; color: #2d3748; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.dropdown-slide-enter-active, .dropdown-slide-leave-active { transition: all 0.2s ease; }
.dropdown-slide-enter-from, .dropdown-slide-leave-to { opacity: 0; transform: translateY(-10px); }

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999999;
}

.spinner-box {
  background-color: #ffffff;
  padding: 24px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.spinner {
  width: 36px;
  height: 36px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin-kf 1s linear infinite;
}

.loading-text {
  margin-top: 12px;
  font-weight: 600;
  color: #2c3e50;
  font-size: 14px;
}

/* --- MOBILE & PHYSICAL DEVICE ADAPTATION --- */
@media (max-width: 768px) {
  .lobby-wrapper {
    overflow-y: auto;
  }
  .lobby-brand-bar {
    padding: 12px 16px;
  }
  .auth-panel-card {
    padding: 24px 16px;
  }
  .workspace-action-split {
    flex-direction: column;
    gap: 16px;
  }
  .split-vertical-divider {
    display: none;
  }

  .arena-status-bar {
    padding: 0 12px;
    height: 56px;
  }
  .arena-scoreboard {
    display: none; 
  }
  .live-status-ticker {
    max-width: 180px;
  }

  .arena-layout-plane {
    padding: 12px 8px;
    justify-content: flex-start; 
  }

  .board-wrapper {
    margin-bottom: 24px !important; 
  }

  .board-wrapper-frame {
    padding: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  :deep(.board-grid), 
  :deep(.scrabble-board),
  .board-wrapper-frame > div {
    max-width: 100% !important;
    width: 100% !important;
    height: auto !important;
    aspect-ratio: 1 / 1;
  }

  :deep(.board-cell) {
    font-size: min(10px, 2.5vw) !important;
  }

  .player-interaction-dock {
    margin-top: 0;
  }

  .controls {
    grid-template-columns: 1fr;
    gap: 12px;
    max-width: 100%;
    padding: 10px;
  }
}
/* --- PREVENT SIDEWAYS SCROLLING & FIX RESPONSIVENESS --- */
html, body, #app {
  max-width: 100vw;
  overflow-x: hidden !important;
  margin: 0;
  padding: 0;
}

.arena-layout-container, .lobby-wrapper {
  max-width: 100vw;
  width: 100%;
  overflow-x: hidden !important;
  box-sizing: border-box;
}

/* --- DYNAMIC TURN TICKER --- */
.turn-status-ticker {
  padding: 6px 14px;
  border-radius: 20px;
  font-weight: 700;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
}

.turn-status-ticker.my-active-turn {
  background-color: #2ecc71 !important;
  color: #ffffff !important;
  border: 1px solid #27ae60;
  animation: pulse-glow 2s infinite;
}

.turn-status-ticker.opponent-turn {
  background-color: #f1f2f6 !important;
  color: #57606f !important;
  border: 1px solid #ced6e0;
}

@keyframes pulse-glow {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.4); }
  70% { transform: scale(1.02); box-shadow: 0 0 0 8px rgba(46, 204, 113, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); }
}

/* --- REACTIVE LIVE ACTIVITY LOG STYLING --- */
.live-move-ticker-box {
  width: 100%;
  max-width: 600px;
  margin: 10px auto 14px auto;
  background-color: #ffffff;
  border: 1px solid #e1e8ed;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.04);
  overflow: hidden;
}

.ticker-header-bar {
  background-color: #f8f9fa;
  border-bottom: 1px solid #e1e8ed;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: #7f8c8d;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ticker-dot {
  color: #e74c3c;
  animation: blink 1.5s infinite;
}

.ticker-body {
  padding: 12px 16px;
  background: #fffdf9;
}

.ticker-text-line {
  margin: 0;
  font-size: 14px;
  color: #2c3e50;
  font-weight: 600;
  line-height: 1.4;
}

.ticker-empty-line {
  margin: 0;
  font-size: 13px;
  color: #95a5a6;
  font-style: italic;
}

@keyframes blink {
  0% { opacity: 0.2; }
  50% { opacity: 1; }
  100% { opacity: 0.2; }
}
</style>