<template>
  <Game />
</template>

<script setup>
import Game from './components/Game.vue' 
// NOTE: If your Game.vue file is directly in the src folder instead of 
// a components folder, change the line above to: import Game from './Game.vue'
</script>

<style>
/* Optional: Global reset to ensure layout fills the screen cleanly */
body {
  margin: 0;
  background-color: #faf8f5;
  color: #2c3e50;
  font-family: system-ui, -apple-system, sans-serif;
}
</style>