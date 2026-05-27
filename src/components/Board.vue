<script setup>
import { computed } from 'vue'

const props = defineProps({ 
  board: {
    type: Array,
    required: true,
    default: () => Array(15).fill(null).map(() => Array(15).fill(''))
  }
})

defineEmits(['drop', 'cell-click'])

// Standard Scrabble 15x15 premium square coordinates
const getSquareType = (r, c) => {
  // Center Star
  if (r === 7 && c === 7) return 'center'
  
  // Triple Word Score (TW)
  const tw = [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]]
  if (tw.some(([x, y]) => x === r && y === c)) return 'tw'
  
  // Double Word Score (DW)
  const dw = [
    [1,1], [2,2], [3,3], [4,4], [10,10], [11,11], [12,12], [13,13],
    [1,13], [2,12], [3,11], [4,10], [10,4], [11,3], [12,2], [13,1]
  ]
  if (dw.some(([x, y]) => x === r && y === c)) return 'dw'
  
  // Triple Letter Score (TL)
  const tl = [
    [1,5], [1,9], [5,1], [5,5], [5,9], [5,13],
    [9,1], [9,5], [9,9], [9,13], [13,5], [13,9]
  ]
  if (tl.some(([x, y]) => x === r && y === c)) return 'tl'
  
  // Double Letter Score (DL)
  const dl = [
    [0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12],
    [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8], [14,3], [14,11]
  ]
  if (dl.some(([x, y]) => x === r && y === c)) return 'dl'
  
  return 'normal'
}

// Helper to display text inside empty bonus squares
const getSquareLabel = (type) => {
  if (type === 'tw') return 'TW'
  if (type === 'dw') return 'DW'
  if (type === 'tl') return 'TL'
  if (type === 'dl') return 'DL'
  if (type === 'center') return '★'
  return ''
}
</script>

<template>
  <div class="board-container">
    <div class="board">
      <template v-for="(row, rIdx) in board" :key="rIdx">
        <div 
          v-for="(cell, cIdx) in row" 
          :key="cIdx" 
          :class="['cell', getSquareType(rIdx, cIdx), { 'has-letter': cell }]"
          @dragover.prevent
          @drop="$emit('drop', { r: rIdx, c: cIdx, letter: $event.dataTransfer.getData('text') })"
          @click="$emit('cell-click', { r: rIdx, c: cIdx })"
        >
          <div class="cell-inner">
            {{ cell || getSquareLabel(getSquareType(rIdx, cIdx)) }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.board-container {
  display: flex;
  justify-content: center;
  padding: 10px;
}

/* Changed to CSS Grid for the layout instead of Flexbox rows */
.board {
  display: grid;
  grid-template-columns: repeat(15, 1fr);
  gap: 2px;
  width: 100%;
  max-width: 600px;
  background-color: #333; /* Board border lines */
  border: 4px solid #222;
  border-radius: 4px;
}

.cell {
  aspect-ratio: 1; /* Keeps cells perfectly square */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  user-select: none;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cell-inner {
  text-align: center;
}

/* Premium Square Color Scheme */
.normal { background: #dfd8c7; color: transparent; } /* Hides text unless it has a letter */
.center { background: #ffc0cb; color: #cc0000; font-size: 14px; }
.tw { background: #ff4d4d; color: #fff; } /* Red */
.dw { background: #ffb3b3; color: #b30000; } /* Pink */
.tl { background: #3399ff; color: #fff; } /* Dark Blue */
.dl { background: #b3d9ff; color: #0059b3; } /* Light Blue */

/* Style for when a tile is placed */
.cell.has-letter {
  background: #f5deb3; /* Wheat/Wood color for tiles */
  color: #333 !important;
  border-radius: 3px;
  box-shadow: inset 0 0 4px rgba(0,0,0,0.2), 1px 1px 2px rgba(0,0,0,0.3);
  font-size: 16px;
}

@media (max-width: 480px) {
  .cell {
    font-size: 8px;
  }
  .cell.has-letter {
    font-size: 12px;
  }
  .center { font-size: 10px; }
}
</style>