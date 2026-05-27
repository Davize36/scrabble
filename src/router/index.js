import { createRouter, createWebHashHistory } from 'vue-router'
// Make sure this path points directly to the Game.vue file we've been updating!
import Game from '../components/Game.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Game
  },
  // If you have an old /game path, point it to the same file for safety
  {
    path: '/game',
    name: 'Game',
    component: Game
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router