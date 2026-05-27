<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const room = ref('')
const name = ref('')

function handleJoin() {
  // If blank, generate a random 6-character room token
  const targetRoom = (room.value.trim() || Math.random().toString(36).slice(2, 8)).toUpperCase()
  const targetName = (name.value.trim() || 'Player').slice(0, 12)
  
  router.push({ 
    path: '/game', 
    query: { room: targetRoom, name: targetName } 
  })
}
</script>

<template>
  <div class="lobby-container">
    <div class="card lobby-card">
      <header class="lobby-header">
        <h1>Scrabble Online</h1>
        <p>Create a private room or enter an existing code to match with a friend.</p>
      </header>
      
      <main class="form-group">
        <div class="input-wrapper">
          <label for="roomInput">Room Code</label>
          <input 
            id="roomInput"
            v-model="room" 
            type="text"
            placeholder="LEAVE BLANK TO CREATE NEW" 
            maxlength="12"
            class="text-input uppercase-input"
            @keyup.enter="handleJoin"
          />
        </div>
        
        <div class="input-wrapper">
          <label for="nameInput">Your Handle</label>
          <input 
            id="nameInput"
            v-model="name" 
            type="text"
            placeholder="e.g., WordMaster" 
            maxlength="12"
            class="text-input"
            @keyup.enter="handleJoin"
          />
        </div>
        
        <button class="btn btn-action" @click="handleJoin">
          {{ room.trim() ? 'Join Game' : 'Create Room' }}
        </button>
      </main>
      
      <footer class="lobby-footer">
        <span class="hint-badge">Tip</span>
        <p class="hint-text">Sharing the exact generated room code allows up to 2 players to sync up instantly.</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.lobby-container {
  min-height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-family: system-ui, -apple-system, sans-serif;
}

.card {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  border: 1px solid #eaeaea;
  width: 100%;
  max-width: 420px;
  padding: 32px;
}

.lobby-header h1 {
  margin: 0 0 8px 0;
  font-size: 28px;
  font-weight: 800;
  color: #222;
  text-align: center;
}

.lobby-header p {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: #666;
  text-align: center;
  line-height: 1.5;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-wrapper label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: #555;
  letter-spacing: 0.5px;
}

.text-input {
  padding: 12px;
  font-size: 15px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: #fafafa;
  transition: all 0.2s ease;
  outline: none;
}

.text-input:focus {
  border-color: #1f8ceb;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(31, 140, 235, 0.15);
}

.uppercase-input {
  text-transform: uppercase;
}

.uppercase-input::placeholder {
  text-transform: none; /* Keeps placeholder readable */
}

.btn-action {
  margin-top: 8px;
  padding: 14px;
  font-size: 16px;
  font-weight: bold;
  border-radius: 8px;
  background: #1f8ceb;
  color: #fff;
  border: none;
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-action:hover {
  background: #156bba;
}

.lobby-footer {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.hint-badge {
  background: #eae2d2;
  color: #5d4037;
  font-size: 10px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  margin-top: 2px;
}

.hint-text {
  margin: 0;
  font-size: 12px;
  color: #777;
  line-height: 1.4;
}

@media (max-width: 480px) {
  .card {
    padding: 20px;
  }
}
</style>