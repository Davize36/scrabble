<script setup>
const props = defineProps({
  letter: { type: String, required: true },
  score: { type: Number, default: 0 },
  selected: { type: Boolean, default: false }
})

const emit = defineEmits(['dragstart', 'select'])

function handleDragStart(e) {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text', props.letter)
  }
  // Bubble up to Game.vue so it can run turn checks
  emit('dragstart', e, props.letter)
}

function handleClick() { 
  emit('select', props.letter) 
}
</script>

<template>
  <div 
    class="tile" 
    :class="{ 'is-selected': selected }" 
    draggable="true" 
    @dragstart="handleDragStart" 
    @click="handleClick"
    role="button"
    :aria-label="`Letter ${letter}, Score ${score}`"
  >
    <span class="letter">{{ letter }}</span>
    <span class="score">{{ score }}</span>
  </div>
</template>

<style scoped>
.tile {
  width: 46px;
  height: 46px;
  border-radius: 6px;
  background: #f5deb3; /* Classic Scrabble tile finish */
  border: 1px solid #d2b48c;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  font-weight: 800;
  cursor: grab;
  user-select: none;
  touch-action: manipulation;
  
  /* Give tiles a slight 3D pop effect */
  box-shadow: 
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.15);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}

.tile:active {
  cursor: grabbing;
  transform: scale(0.96);
}

/* Highlighting for mobile click-to-place state */
.tile.is-selected {
  outline: 3px solid #1f8ceb;
  outline-offset: 2px;
  transform: translateY(-4px);
  box-shadow: 0 6px 12px rgba(31, 140, 235, 0.3);
}

.letter {
  font-size: 20px;
  color: #2b1d0c;
  text-transform: uppercase;
}

.score {
  position: absolute;
  right: 5px;
  bottom: 3px;
  font-size: 9px;
  color: #5c4037;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 480px) {
  .tile {
    width: 38px;
    height: 38px;
  }
  .letter {
    font-size: 16px;
  }
  .score {
    font-size: 8px;
    right: 3px;
    bottom: 2px;
  }
}
</style>