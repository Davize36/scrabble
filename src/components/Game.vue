<script setup>
import { ref, onBeforeUnmount, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Board from './Board.vue'
import Tile from './Tile.vue'
import { supabase } from '../supabase.js' 

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
const isLoadingProfile = ref(true) // Track profile loading state
const profileLoadError = ref(false)

// UI Toggle States
const inputRoomCode = ref('')
const isJoined = ref(false)
const errorMessage = ref('')
const isProcessing = ref(false) 
const loadingMessage = ref('')   
const showForfeitModal = ref(false) 
const showBingoNotification = ref(false)
const showHistoryMenu = ref(false)

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
let gameDataLoaded = false
let profileLoadTimeout = null

// Word dictionary cache
const validWordsCache = new Set()
const isLoadingDictionary = ref(false)

// Check active session on load with timeout
onMounted(async () => {
  // Add click listener to close profile menu when clicking outside
  document.addEventListener('click', handleOutsideClick)
  
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      await handleUserSessionFetch(session.user)
    } else {
      isLoadingProfile.value = false
    }
  } catch (err) {
    console.error('Session check error:', err)
    isLoadingProfile.value = false
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
})

function handleOutsideClick(event) {
  const profileMenu = document.querySelector('.profile-dropdown')
  const userInfo = document.querySelector('.user-info')
  if (profileMenu && userInfo && !profileMenu.contains(event.target) && !userInfo.contains(event.target)) {
    showProfileMenu.value = false
  }
}

// Listen for auth changes - only handle explicit sign out
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    await handleUserSessionFetch(session.user)
  } else if (event === 'SIGNED_OUT' && !session) {
    // Only clear on explicit sign out, not on page refresh
    currentUser.value = null
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
    return
  }
  
  currentUser.value = user
  
  try {
    // First try to get existing profile
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    
    if (!error && data) {
      profileData.value = data
      authUsername.value = ''
    } else if (error && error.code === 'PGRST116') {
      // Profile doesn't exist, create one
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
    // Set fallback profile on error
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
  }
}

// Authentication Logic Actions
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
          data: {
            username: authUsername.value.trim()
          }
        }
      })
      if (signUpError) throw signUpError
      
      if (signUpData.user) {
        // Wait a bit for the trigger to create profile
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
    errorMessage.value = err.message
  } finally {
    isProcessing.value = false
  }
}

async function handleLogout() {
  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Logout error:', error)
      errorMessage.value = 'Failed to logout. Please try again.'
      return
    }
  } catch (err) {
    console.error('Logout exception:', err)
    errorMessage.value = 'Failed to logout. Please try again.'
    return
  }
  currentUser.value = null
  profileData.value = { username: '', wins: 0, losses: 0 }
  authUsername.value = ''
  resetLocalState()
  showProfileMenu.value = false
}

function toggleProfileMenu() {
  showProfileMenu.value = !showProfileMenu.value
}

// Load dictionary for word validation
async function loadDictionary() {
  if (validWordsCache.size > 0) return true
  
  isLoadingDictionary.value = true
  try {
    const cached = localStorage.getItem('scrabble_dictionary')
    if (cached) {
      const words = JSON.parse(cached)
      words.forEach(word => validWordsCache.add(word))
      return true
    }
    
    // Load the full dictionary upfront
    const response = await fetch('https://raw.githubusercontent.com/dwyl/english-words/master/words_dictionary.json')
    const data = await response.json()
    Object.keys(data).forEach(word => {
      if (word.length >= 2 && word.length <= 15) {
        validWordsCache.add(word.toUpperCase())
      }
    })
    try {
      localStorage.setItem('scrabble_dictionary', JSON.stringify([...validWordsCache]))
    } catch (e) {
      console.warn('LocalStorage full, dictionary not cached:', e)
    }
    return true
  } catch (error) {
    console.error('Failed to load dictionary:', error)
    // Fallback: load basic words if full dictionary fails
    const basicWords = ['THE', 'AND', 'FOR', 'YOU', 'ARE', 'THIS', 'THAT', 'WITH', 'FROM', 'HAVE', 'NOT', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'HAD', 'HAS', 'HIS', 'HOW', 'MAN', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY', 'DID', 'CAR', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE']
    basicWords.forEach(word => validWordsCache.add(word))
    return false
  } finally {
    isLoadingDictionary.value = false
  }
}

async function isValidWord(word) {
  if (!word || word.length < 2) return false
  
  if (word.length === 2) {
    return VALID_2_LETTER_WORDS.has(word)
  }
  
  // If dictionary not loaded, load it
  if (validWordsCache.size === 0) {
    await loadDictionary()
  }
  
  // Validate the word - if not in cache and cache was loaded, reject it
  return validWordsCache.has(word)
}

async function validateWords(moves) {
  const words = computeTurnWords(moves).map(positions => 
    positions.map(p => p.letter).join('')
  )
  
  for (const word of words) {
    if (!await isValidWord(word)) {
      errorMessage.value = `"${word}" is not a valid word!`
      return false
    }
  }
  return true
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
  A:9, B:2, C:2, D:4, E:12, F:2, G:3, H:2, I:9, J:1, K:1, L:4, M:2,
  N:6, O:8, P:2, Q:1, R:6, S:4, T:6, U:4, V:2, W:2, X:1, Y:2, Z:1
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
      if (VALID_2_LETTER_WORDS.has(letters[i] + letters[j])) return true
    }
  }
  return false
}

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

// --- SUPABASE GAME EXECUTION ---
async function handleCreateRoom() {
  // Check if profile is still loading
  if (isLoadingProfile.value) {
    errorMessage.value = "Still loading your profile. Please wait a moment..."
    return
  }
  
  if (!currentUser.value || !profileData.value.username) {
    errorMessage.value = "Profile not ready. Please refresh the page."
    return
  }
  
  errorMessage.value = ""
  isProcessing.value = true
  loadingMessage.value = "Creating game room..."
  
  const newRoomCode = Math.random().toString(36).substring(2, 8).padEnd(6, '0').toUpperCase()
  const freshBag = createOfficialBag()
  const initialRack = drawSmartTiles([...freshBag], 7)
  
  try {
    const gameData = {
      room_code: newRoomCode,
      board_state: Array(225).fill(''),
      tile_bag: freshBag,
      players_json: [{ 
        id: currentUser.value.id, 
        name: profileData.value.username, 
        rack: initialRack, 
        score: 0 
      }],
      status: 'pending',
      current_turn_name: profileData.value.username,
      latest_play: '',
      host_id: currentUser.value.id,
      created_at: new Date().toISOString()
    }
    
    const { data, error } = await supabase
      .from('games')
      .insert(gameData)
      .select()
      .maybeSingle()

    if (error) {
      console.error('Insert error:', error)
      errorMessage.value = `Failed to create room: ${error.message}`
      throw error
    }
    
    if (!data) {
      errorMessage.value = "Failed to create room - no data returned"
      return
    }
    
    room.value = newRoomCode
    isJoined.value = true
    gameDataLoaded = false
    addToHistory(profileData.value.username, 'game_started', 'Game created', null)
    await startSupabaseSubscription(newRoomCode)
    
  } catch (err) {
    console.error('Create room error:', err)
    errorMessage.value = "Failed to create game room. Please try again."
  } finally {
    isProcessing.value = false
    loadingMessage.value = ''
  }
}

async function handleJoinRoom() {
  const code = inputRoomCode.value.trim().toUpperCase()
  if (!code) return
  
  errorMessage.value = ""
  isProcessing.value = true
  loadingMessage.value = "Joining game room..."
  
  try {
    // Fetch the game with proper error handling
    const { data: gameData, error: fetchError } = await supabase
      .from('games')
      .select('*')
      .eq('room_code', code)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Fetch error:', fetchError)
      errorMessage.value = "Error finding room. Please try again."
      return
    }
    
    if (!gameData) {
      errorMessage.value = "Room code not found!"
      return
    }
    
    let currentPlayers = [...(gameData.players_json || [])]
    const alreadyIn = currentPlayers.some(p => p.id === currentUser.value.id)
    
    if (alreadyIn) {
      room.value = code
      isJoined.value = true
      gameDataLoaded = false
      addToHistory(profileData.value.username, 'reconnected', `${profileData.value.username} reconnected`, null)
      await startSupabaseSubscription(code)
      return
    }
    
    if (currentPlayers.length >= 2) {
      errorMessage.value = "This match room is full."
      return
    }
    
    let currentBag = [...(gameData.tile_bag || [])]
    const startingRack = drawSmartTiles(currentBag, 7)
    currentPlayers.push({ 
      id: currentUser.value.id, 
      name: profileData.value.username, 
      rack: startingRack, 
      score: 0 
    })
    
    const { error: updateError } = await supabase
      .from('games')
      .update({
        players_json: currentPlayers,
        tile_bag: currentBag,
        guest_id: currentUser.value.id,
        status: 'active',
        join_notification: `${profileData.value.username} has joined!`,
        updated_at: new Date().toISOString()
      })
      .eq('room_code', code)

    if (updateError) {
      console.error('Update error:', updateError)
      errorMessage.value = "Failed to join room. Please try again."
      return
    }

    room.value = code
    isJoined.value = true
    gameDataLoaded = false
    addToHistory(profileData.value.username, 'joined', `${profileData.value.username} joined the game`, null)
    await startSupabaseSubscription(code)
    
  } catch (err) {
    console.error('Join room error:', err)
    errorMessage.value = "Failed to join room. Please try again."
  } finally {
    isProcessing.value = false
    loadingMessage.value = ''
  }
}

async function startSupabaseSubscription(roomCode) {
  if (gameChannel) {
    try {
      await supabase.removeChannel(gameChannel)
    } catch (e) {
      console.warn('Error removing channel:', e)
    }
    gameChannel = null
  }
  
  try {
    // Fetch initial data first
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('room_code', roomCode)
      .single()
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching game:', error)
      errorMessage.value = "Failed to load game data."
      return
    }
    
    if (!data) {
      errorMessage.value = "Game room not found."
      return
    }
    
    // Load initial state
    syncStateMap(data)
    
    // Set up subscription after initial data is loaded
    gameChannel = supabase
      .channel(`room_${roomCode}`)
      .on('postgres_changes', 
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'games',
          filter: `room_code=eq.${roomCode}`
        }, 
        (payload) => {
          if (payload.new && payload.new.room_code === roomCode) {
            syncStateMap(payload.new)
          }
        }
      )
      .on('postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'games',
          filter: `room_code=eq.${roomCode}`
        },
        () => {
          resetLocalState()
          errorMessage.value = "Game room was deleted."
        }
      )
      .subscribe()
  } catch (err) {
    console.error('Subscription setup error:', err)
    errorMessage.value = "Connection issue. Please refresh."
    return
  }
}

function syncStateMap(data) {
  if (!data) return
  
  // Update board
  if (Array.isArray(data.board_state)) {
    boardFlat.value = data.board_state
  } else {
    boardFlat.value = Array(225).fill('')
  }
  
  // Update bag
  if (Array.isArray(data.tile_bag)) {
    bag.value = data.tile_bag
  } else {
    bag.value = []
  }
  
  // Update players
  if (Array.isArray(data.players_json)) {
    players.value = data.players_json
  } else {
    players.value = []
  }
  
  joinMessage.value = data.join_notification || ''
  latestPlayMessage.value = data.latest_play || ''
  
  // Update current player
  if (players.value.length > 0 && data.current_turn_name) {
    const idx = players.value.findIndex(p => p.name === data.current_turn_name)
    currentPlayerIndex.value = idx !== -1 ? idx : 0
  }

  // Update profile wins/losses if game is finished
  if (data.status === 'finished' && currentUser.value) {
    // Refetch profile to get updated wins/losses
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
  const newPlayLog = `${profileData.value.username} played "${wordDescription}" (+${plainWordScore} pts)${isBingo ? " (BINGO! +50 pts)" : ""}`
  
  addToHistory(profileData.value.username, 'played', wordDescription, turnScore)
  if (isBingo) {
    addToHistory(profileData.value.username, 'bingo', 'Played all 7 tiles!', 50)
  }
  
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
    
    if (winningPlayer) await supabase.rpc('increment_wins', { user_id: winningPlayer.id })
    if (losingPlayer) await supabase.rpc('increment_losses', { user_id: losingPlayer.id })
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
  
  try {
    const { data: gameRecord, error } = await supabase
      .from('games')
      .select('*')
      .eq('room_code', room.value)
      .maybeSingle()
      
    if (error) throw error
    
    if (gameRecord) {
      const dbPlayers = gameRecord.players_json || []
      const opponent = dbPlayers.find(p => p.id !== currentUser.value.id)
      
      addToHistory(profileData.value.username, 'forfeited', `${profileData.value.username} forfeited the game`, null)
      
      if (opponent) {
        await supabase.rpc('increment_wins', { user_id: opponent.id })
        await supabase.rpc('increment_losses', { user_id: currentUser.value.id })
      }
    }
    await supabase.from('games').delete().eq('room_code', room.value)
  } catch (err) {
    console.error(err)
    errorMessage.value = "Failed to forfeit game."
  } finally {
    isProcessing.value = false
    resetLocalState()
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

  // Double-click to remove tile
  if (pendingIdx !== -1 && (currentTime - lastClickTime < 300) && lastClickedCell.r === r && lastClickedCell.c === c) {
    pendingMoves.value.splice(pendingIdx, 1)
    lastClickTime = 0
    return
  }

  lastClickTime = currentTime
  lastClickedCell = { r, c }

  // Place tile on single click
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
  
  addToHistory(profileData.value.username, 'exchanged', 'Exchanged all tiles', null)
  
  await supabase
    .from('games')
    .update({
      tile_bag: updatedBag,
      players_json: updatedPlayers,
      current_turn_name: updatedPlayers[nextPlayerIndex].name,
      latest_play: `${profileData.value.username} exchanged their tiles.`
    })
    .eq('room_code', room.value)
}

async function pass() {
  if (!isMyTurn.value || pendingMoves.value.length > 0) {
    errorMessage.value = "Cannot pass with tiles on board!"
    return
  }
  
  const nextPlayerIndex = (currentPlayerIndex.value + 1) % players.value.length
  addToHistory(profileData.value.username, 'passed', 'Passed turn', null)

  await supabase
    .from('games')
    .update({
      current_turn_name: players.value[nextPlayerIndex].name,
      latest_play: `${profileData.value.username} passed their turn.`
    })
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
  if (gameChannel) {
    supabase.removeChannel(gameChannel)
    gameChannel = null
  }
}

function toggleHistoryMenu() {
  showHistoryMenu.value = !showHistoryMenu.value
}

function formatHistoryTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getActionIcon(action) {
  const icons = {
    'played': '🎯',
    'passed': '⏭️',
    'exchanged': '🔄',
    'joined': '👋',
    'game_started': '🎮',
    'game_ended': '🏆',
    'forfeited': '⚠️',
    'bingo': '✨'
  }
  return icons[action] || '📌'
}

watch(latestPlayMessage, (newMsg) => {
  if (newMsg && newMsg.includes("BINGO!")) {
    showBingoNotification.value = true
    setTimeout(() => { showBingoNotification.value = false }, 2000)
  }
})

const localPlayerIndex = computed(() => {
  return players.value.findIndex(p => p.id === currentUser.value?.id)
})

const isMyTurn = computed(() => {
  if (!players.value.length || players.value.length < 2 || localPlayerIndex.value === -1) return false
  return localPlayerIndex.value === currentPlayerIndex.value
})

const myRack = computed(() => {
  const me = players.value[localPlayerIndex.value]
  if (!me || !me.rack || !Array.isArray(me.rack)) return []
  let workingRack = me.rack.map((t, index) => ({
    letter: t.letter || t,
    pts: t.pts || 0,
    rackId: index
  }))
  const usedIndices = new Set(pendingMoves.value.map(m => m.rackId).filter(id => id !== undefined))
  workingRack = workingRack.filter((_, idx) => !usedIndices.has(idx))
  return workingRack
})
</script>

<template>
  <div v-if="isProcessing" class="loading-overlay">
    <div class="spinner-box">
      <div class="spinner"></div>
      <p class="loading-text">{{ loadingMessage || 'Processing...' }}</p>
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

  <!-- AUTHENTICATION INTERFACE SCREEN -->
  <div v-if="!currentUser && !isLoadingProfile" class="lobby-container">
    <div class="lobby-card">
      <h1 class="brand-title">Scrabble.</h1>
      <p class="subtitle">{{ isSignUpMode ? 'Register an Account' : 'Sign In to Your Workspace' }}</p>
      <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>
      
      <div v-if="isSignUpMode" class="input-group">
        <label>Unique Username</label>
        <input v-model="authUsername" type="text" placeholder="Username" />
      </div>

      <div class="input-group">
        <label>Email Address</label>
        <input v-model="authEmail" type="email" placeholder="you@domain.com" />
      </div>
      
      <div class="input-group">
        <label>Password</label>
        <input v-model="authPassword" type="password" placeholder="••••••••" />
      </div>

      <button class="btn btn-primary btn-block" @click="handleAuthAction" :disabled="isProcessing">
        {{ isProcessing ? 'Processing...' : (isSignUpMode ? 'Create Account' : 'Sign In') }}
      </button>

      <p class="toggle-mode-link" @click="isSignUpMode = !isSignUpMode">
        {{ isSignUpMode ? 'Already have an account? Login' : 'Need an account? Sign Up Here' }}
      </p>
    </div>
  </div>

  <!-- Loading Profile Screen -->
  <div v-else-if="isLoadingProfile" class="lobby-container">
    <div class="lobby-card">
      <div class="spinner-box">
        <div class="spinner"></div>
        <p class="loading-text">Loading your profile...</p>
      </div>
    </div>
  </div>

  <!-- MATCH SELECTION LOBBY -->
  <div v-else-if="!isJoined" class="lobby-container">
    <div class="lobby-card">
      <div class="user-badge-row">
        <div class="user-info" @click="toggleProfileMenu">
          <span class="user-avatar">👤</span>
          <span class="user-name"><strong>{{ profileData.username || 'Player' }}</strong></span>
          <span class="dropdown-arrow">▼</span>
        </div>
        <button class="logout-link" @click="handleLogout">Logout</button>
      </div>
      
      <!-- Profile Dropdown Menu -->
      <div v-if="showProfileMenu" class="profile-dropdown">
        <div class="dropdown-item">📧 {{ currentUser?.email || 'No email' }}</div>
        <div class="dropdown-item">🆔 ID: {{ currentUser?.id?.slice(0, 8) }}...</div>
        <hr />
        <div class="dropdown-item">🏆 Wins: {{ profileData.wins }}</div>
        <div class="dropdown-item">💀 Losses: {{ profileData.losses }}</div>
      </div>
      
      <hr/>
      
      <!-- Permanent Record Display -->
      <div class="profile-stats-dashboard">
        <div class="stat-bubble wins">🏆 Wins: {{ profileData.wins }}</div>
        <div class="stat-bubble losses">💀 Losses: {{ profileData.losses }}</div>
      </div>

      <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>
      
      <div class="lobby-actions">
        <button class="btn btn-primary btn-block" @click="handleCreateRoom" :disabled="isProcessing || isLoadingProfile">
          {{ isProcessing ? 'Creating...' : 'Host New Match Room' }}
        </button>
        <div class="join-zone">
          <input v-model="inputRoomCode" type="text" placeholder="6-Char Code" class="code-input" maxlength="6" />
          <button class="btn btn-alt" @click="handleJoinRoom" :disabled="isProcessing || isLoadingProfile">
            {{ isProcessing ? 'Joining...' : 'Join Room' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- MAIN GAME ARENA INTERFACE -->
  <div v-else class="game container">
    <header class="game-header">
      <div class="header-left-group">
        <button class="btn btn-danger btn-sm" @click="showForfeitModal = true">🏳️ Forfeit</button>
        <button class="btn btn-history btn-sm" @click="toggleHistoryMenu">📜 History</button>
        <h2>Room: <span class="room-highlight">{{ room }}</span></h2>
      </div>
      <div class="player-info">
        <span class="player-name">🎮 {{ profileData.username }}</span>
        <div :class="['turn-indicator', { 'your-turn': isMyTurn }]">
          {{ isMyTurn ? "Your Turn!" : "Waiting..." }}
        </div>
      </div>
    </header>

    <section class="notification-center">
      <div v-if="errorMessage" class="error-alert">{{ errorMessage }}</div>
      <div v-if="joinMessage" class="join-alert">{{ joinMessage }}</div>
      <div v-if="latestPlayMessage" class="play-alert">🎯 {{ latestPlayMessage }}</div>
    </section>

    <main class="game-arena">
      <div class="board-wrapper">
        <Board :board="board2D" :pendingMoves="pendingMoves" @drop="handleDrop" @cell-click="onCellClick" />
      </div>

      <div class="rack-wrapper">
        <div class="rack" :class="{ 'disabled-rack': !isMyTurn }">
          <Tile 
            v-for="t in myRack" 
            :key="t.rackId" 
            :letter="t.letter" 
            :value="t.pts" 
            :selected="selectedRackIdx === t.rackId" 
            draggable="true"
            @dragstart="onDragStart($event, t)" 
            @dragend="onDragEnd"
            @click="selectTile(t.letter, t.rackId)"
          />
        </div>
      </div>

      <!-- Turn Confirmation Submenus -->
      <div v-if="isMyTurn && pendingMoves.length > 0" class="turn-confirmation-bar">
         <button class="btn btn-danger" @click="recallTiles">Clear Staged</button>
         <button class="btn btn-success" @click="confirmTurn">Submit Word</button>
      </div>

      <!-- Core Info and Live Match Scoreboard Layout -->
      <div class="controls">
        <div class="scores">
          <h3>Scoreboard</h3>
          <div v-for="(p, idx) in players" :key="idx" :class="['player-row', { 'active-player': idx === currentPlayerIndex }]">
            <span class="p-name">{{ p.name }}</span>
            <span class="p-score">{{ p.score }} pts</span>
          </div>
        </div>
        <div class="actions-container">
          <div class="bag-count-display">👝 Tiles Left: <strong>{{ bag.length }}</strong></div>
          <div class="game-buttons">
            <button :disabled="!isMyTurn || pendingMoves.length > 0" class="btn btn-alt" @click="exchange">Exchange All</button>
            <button :disabled="!isMyTurn || pendingMoves.length > 0" class="btn btn-primary" @click="pass">Pass Turn</button>
          </div>
        </div>
      </div>
    </main>

    <!-- Sandwich Menu for Match History -->
    <Transition name="slide">
      <div v-if="showHistoryMenu" class="history-menu-overlay" @click="toggleHistoryMenu">
        <div class="history-menu" @click.stop>
          <div class="history-header">
            <h3>📜 Match History</h3>
            <button class="close-history" @click="toggleHistoryMenu">✕</button>
          </div>
          <div class="history-stats">
            <div class="stat-item">Total Moves: {{ gameHistory.filter(h => h.action === 'played').length }}</div>
          </div>
          <div class="history-list">
            <div v-for="entry in gameHistory.slice().reverse()" :key="entry.id" class="history-entry">
              <div class="history-time">{{ formatHistoryTime(entry.timestamp) }}</div>
              <div class="history-content">
                <span class="history-player">{{ entry.playerName }}</span>
                <span class="history-action">{{ getActionIcon(entry.action) }} {{ entry.action }}</span>
                <span class="history-details">{{ entry.details }}</span>
                <span v-if="entry.scoreChange" class="history-score">+{{ entry.scoreChange }}</span>
              </div>
            </div>
            <div v-if="gameHistory.length === 0" class="history-empty">
              No moves yet. Make the first play!
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* User Info Styles */
.user-badge-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: #333;
  margin-bottom: 8px;
  position: relative;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 12px;
  background: #f0f0f0;
  border-radius: 20px;
  transition: background 0.2s;
}

.user-info:hover {
  background: #e0e0e0;
}

.user-avatar {
  font-size: 18px;
}

.dropdown-arrow {
  font-size: 10px;
  color: #666;
}

.profile-dropdown {
  position: absolute;
  top: 45px;
  left: 0;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 8px 0;
  min-width: 200px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 100;
}

.dropdown-item {
  padding: 8px 16px;
  font-size: 13px;
  color: #333;
}

.dropdown-item:hover {
  background: #f5f5f5;
}

.profile-dropdown hr {
  margin: 4px 0;
  border: none;
  border-top: 1px solid #eee;
}

.logout-link {
  background: none;
  border: none;
  color: #c62828;
  font-weight: bold;
  cursor: pointer;
  text-decoration: underline;
}

.toggle-mode-link {
  font-size: 13px;
  color: #1f8ceb;
  cursor: pointer;
  margin-top: 16px;
  text-decoration: underline;
  text-align: center;
}

.profile-stats-dashboard {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin: 16px 0;
}

.stat-bubble {
  flex: 1;
  padding: 10px;
  border-radius: 6px;
  font-weight: bold;
  font-size: 14px;
  text-align: center;
}

.stat-bubble.wins {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #c8e6c9;
}

.stat-bubble.losses {
  background: #ffebee;
  color: #c62828;
  border: 1px solid #ffcdd2;
}

.actions-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.game-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.game-buttons button {
  flex: 1;
  font-size: 13px;
}

.bag-count-display {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eee;
  border-radius: 6px;
  font-size: 14px;
  padding: 10px;
  color: #444;
  font-weight: bold;
}

.turn-confirmation-bar {
  display: flex;
  gap: 12px;
  justify-content: center;
  max-width: 600px;
  margin: 12px auto;
}

.btn-success {
  background: #2e7d32;
  color: white;
  flex: 1;
  padding: 12px;
  font-size: 15px;
}

.btn-success:hover {
  background: #1b5e20;
}

.btn-history {
  background: #607d8b;
  color: white;
}

.btn-history:hover {
  background: #455a64;
}

/* History Menu Styles */
.history-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 10000;
  display: flex;
  justify-content: flex-end;
}

.history-menu {
  position: fixed;
  top: 0;
  right: 0;
  width: 400px;
  max-width: 90vw;
  height: 100vh;
  background: white;
  box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 10001;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 2px solid #e0e0e0;
  background: #f5f5f5;
}

.history-header h3 {
  margin: 0;
  color: #333;
}

.close-history {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.close-history:hover {
  background: #e0e0e0;
}

.history-stats {
  display: flex;
  justify-content: space-around;
  padding: 12px 20px;
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
  font-size: 13px;
  color: #666;
}

.stat-item {
  font-weight: 500;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.history-entry {
  padding: 12px;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.2s;
}

.history-entry:hover {
  background: #f9f9f9;
}

.history-time {
  font-size: 11px;
  color: #999;
  margin-bottom: 4px;
}

.history-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}

.history-player {
  font-weight: bold;
  color: #1976d2;
}

.history-action {
  color: #666;
  text-transform: capitalize;
}

.history-details {
  color: #333;
  flex: 1;
}

.history-score {
  color: #4caf50;
  font-weight: bold;
  font-size: 12px;
}

.history-empty {
  text-align: center;
  color: #999;
  padding: 40px 20px;
}

.slide-enter-active, .slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from, .slide-leave-to {
  transform: translateX(100%);
}

/* Bingo Popup */
.bingo-popup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0,0,0,0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 99999;
  pointer-events: none;
}

.bingo-popup-content {
  background: linear-gradient(135deg, #ffca28, #ff8f00);
  padding: 32px 48px;
  border-radius: 16px;
  text-align: center;
  box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  color: #fff;
  animation: bounce 0.5s ease;
}

.bingo-popup-content h2 {
  font-size: 42px;
  margin: 8px 0;
  font-family: 'Georgia', serif;
  font-weight: 900;
  letter-spacing: 2px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.bingo-stars {
  font-size: 36px;
}

@keyframes bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* Error Alert */
.error-alert {
  background: #ffebee;
  color: #c62828;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 13px;
  border-left: 3px solid #c62828;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* Layout foundations */
.lobby-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 85vh;
  font-family: system-ui, sans-serif;
}

.lobby-card {
  background: white;
  padding: 32px;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  width: 100%;
  max-width: 400px;
}

.brand-title {
  color: #b71c1c;
  font-family: 'Georgia', serif;
  font-weight: 900;
  font-size: 42px;
  margin: 0;
  text-align: center;
}

.subtitle {
  color: #666;
  font-size: 14px;
  margin-bottom: 24px;
  text-align: center;
}

.error-banner {
  background: #ffebee;
  color: #c62828;
  padding: 8px;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 13px;
  text-align: center;
}

.input-group {
  text-align: left;
  margin-bottom: 16px;
}

.input-group label {
  display: block;
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 4px;
  color: #444;
}

.input-group input, .code-input {
  width: 100%;
  padding: 10px;
  border: 2px solid #ddd;
  border-radius: 6px;
  font-size: 15px;
  box-sizing: border-box;
}

.lobby-actions {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.btn-block {
  width: 100%;
  padding: 12px;
}

.join-zone {
  display: flex;
  gap: 8px;
}

.code-input {
  flex: 1;
  text-transform: uppercase;
  text-align: center;
}

.btn {
  padding: 10px 16px;
  border-radius: 6px;
  border: none;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  background: #e0e0e0 !important;
  color: #aaa !important;
  cursor: not-allowed;
}

.btn-primary {
  background: #1f8ceb;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #1976d2;
}

.btn-alt {
  background: #e0e0e0;
  color: #333;
}

.btn-alt:hover:not(:disabled) {
  background: #d0d0d0;
}

.btn-danger {
  background: #c62828;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #b71c1c;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

.container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 16px;
}

.game-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid #eee;
  padding-bottom: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.header-left-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.player-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.player-name {
  font-weight: bold;
  color: #1976d2;
  background: #e3f2fd;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 13px;
}

.room-highlight {
  color: #1f8ceb;
  font-weight: 800;
  background: #e3f2fd;
  padding: 2px 8px;
  border-radius: 4px;
}

.turn-indicator {
  padding: 6px 16px;
  border-radius: 20px;
  background: #e0e0e0;
  font-weight: bold;
  color: #666;
  font-size: 13px;
}

.turn-indicator.your-turn {
  background: #4caf50;
  color: white;
}

.notification-center {
  margin-bottom: 12px;
}

.join-alert {
  background: #e3f2fd;
  color: #0d47a1;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  margin-bottom: 4px;
}

.play-alert {
  background: #fff8e1;
  color: #b7791f;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  margin-top: 4px;
}

.rack-wrapper {
  max-width: 650px;
  margin: 12px auto;
}

.rack {
  display: flex;
  gap: 6px;
  justify-content: center;
  background: #eae2d2;
  padding: 10px;
  border-radius: 8px;
  min-height: 40px;
  flex-wrap: wrap;
}

.disabled-rack {
  opacity: 0.5;
  pointer-events: none;
}

.controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  max-width: 650px;
  margin: 12px auto;
  background: #f9f9f9;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #eee;
  text-align: left;
}

.scores h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
}

.player-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #eee;
}

.active-player {
  font-weight: bold;
  color: #2e7d32;
  background: #e8f5e9;
  margin: -4px -8px;
  padding: 4px 8px;
  border-radius: 4px;
}

.p-name {
  font-weight: 500;
}

.p-score {
  font-family: monospace;
  font-size: 15px;
}

.confirm-modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.confirm-modal-box {
  background: white;
  padding: 24px;
  border-radius: 8px;
  max-width: 360px;
  text-align: center;
}

.confirm-modal-box h3 {
  margin: 0 0 12px 0;
}

.modal-button-row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.modal-btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 4px;
  font-weight: bold;
  cursor: pointer;
}

.btn-cancel {
  background: #eee;
  color: #333;
}

.btn-confirm-forfeit {
  background: #c62828;
  color: white;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 99999;
}

.spinner-box {
  text-align: center;
  background: white;
  padding: 30px;
  border-radius: 12px;
  min-width: 200px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #1f8ceb;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 12px;
}

.loading-text {
  color: #333;
  font-size: 14px;
  margin: 0;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* Responsive Design */
@media (max-width: 768px) {
  .container { padding: 8px; }
  .controls { grid-template-columns: 1fr; gap: 12px; }
  .game-buttons { flex-direction: column; }
  .history-menu { width: 85vw; }
  .rack { gap: 4px; }
  .rack-wrapper { max-width: 100%; }
  .turn-confirmation-bar { flex-direction: column; margin: 8px; }
  .game-header { flex-direction: column; align-items: stretch; }
  .player-info { justify-content: space-between; }
}
</style>a