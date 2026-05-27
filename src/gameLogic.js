// Official Scrabble Tile Distribution & Point Values (English)
export const TILE_DISTRIBUTION = {
  A: { count: 9, pts: 1 }, B: { count: 2, pts: 3 }, C: { count: 2, pts: 3 }, D: { count: 4, pts: 2 },
  E: { count: 12, pts: 1 }, F: { count: 2, pts: 4 }, G: { count: 3, pts: 2 }, H: { count: 2, pts: 4 },
  I: { count: 9, pts: 1 }, J: { count: 1, pts: 8 }, K: { count: 1, pts: 5 }, L: { count: 4, pts: 1 },
  M: { count: 2, pts: 3 }, N: { count: 6, pts: 1 }, O: { count: 8, pts: 1 }, P: { count: 2, pts: 3 },
  Q: { count: 1, pts: 10 }, R: { count: 6, pts: 1 }, S: { count: 4, pts: 1 }, T: { count: 6, pts: 1 },
  U: { count: 4, pts: 1 }, V: { count: 2, pts: 4 }, W: { count: 2, pts: 4 }, X: { count: 1, pts: 8 },
  Y: { count: 2, pts: 4 }, Z: { count: 1, pts: 10 }
}

/**
 * Initializes a fully stocked 100-tile letter bag and shuffles it.
 */
export function createBag() {
  const bag = []
  for (const [ltr, info] of Object.entries(TILE_DISTRIBUTION)) {
    for (let i = 0; i < info.count; i++) {
      bag.push({ letter: ltr, pts: info.pts })
    }
  }
  
  // High-performance Fisher-Yates Shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

/**
 * Safe utility to draw n tiles out of the bag pool.
 */
export function drawTiles(bag, n = 7) {
  const drawn = []
  for (let i = 0; i < n && bag.length > 0; i++) {
    drawn.push(bag.pop())
  }
  return drawn
}

/**
 * Look up standalone base points for a letter string
 */
export function getLetterPoints(letter) {
  const upper = letter.toUpperCase()
  return TILE_DISTRIBUTION[upper] ? TILE_DISTRIBUTION[upper].pts : 0
}

// 15x15 Matrix Layout storing standard premium square map definitions
export const MULTIPLIERS = (function() {
  const m = Array.from({ length: 15 }, () => Array(15).fill(null))
  const TW = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]]
  const DW = [[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],[13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10],[7,7]]
  const TL = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]]
  const DL = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]]
  
  for (const [r, c] of TW) m[r][c] = 'TW'
  for (const [r, c] of DW) m[r][c] = 'DW'
  for (const [r, c] of TL) m[r][c] = 'TL'
  for (const [r, c] of DL) m[r][c] = 'DL'
  return m
})()

/**
 * Returns active value adjustments for a target coordinate.
 * If a tile already occupied this spot on a prior turn, multipliers are bypassed.
 */
export function getMultiplierAt(r, c, isNewPlacement = true) {
  if (!isNewPlacement) return { letter: 1, word: 1 }
  
  const type = MULTIPLIERS[r] && MULTIPLIERS[r][c]
  if (!type) return { letter: 1, word: 1 }
  
  if (type === 'TW') return { letter: 1, word: 3 }
  if (type === 'DW') return { letter: 1, word: 2 }
  if (type === 'TL') return { letter: 3, word: 1 }
  if (type === 'DL') return { letter: 2, word: 1 }
  
  return { letter: 1, word: 1 }
}

/**
 * Computes complete row/column word string scores.
 * @param {Array} wordTiles - Full sequence array of tiles forming the word: [{ r, c, letter, isNew }]
 */
export function scoreWordSequence(wordTiles) {
  let wordMultiplier = 1
  let runningSum = 0

  for (const tile of wordTiles) {
    const pts = getLetterPoints(tile.letter)
    // Only fetch multipliers if the tile was placed during THIS active turn iteration
    const m = getMultiplierAt(tile.r, tile.c, tile.isNew)
    
    runningSum += pts * m.letter
    wordMultiplier *= m.word
  }

  let finalScore = runningSum * wordMultiplier

  // Standard Scrabble Bingo rule: If a player uses all 7 tiles at once, award a +50 bonus
  const newTilesCount = wordTiles.filter(t => t.isNew).length
  if (newTilesCount === 7) {
    finalScore += 50
  }

  return finalScore
}