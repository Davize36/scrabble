<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isOpen: Boolean,
  currentName: String,
  playersList: Array,
  myId: String
})

const emit = defineEmits(['close', 'update-profile'])

const editableName = ref(props.currentName)
const selectedAvatar = ref('🎲')

// A curated collection of lightweight emojis to act as instant profile icons
const AVATAR_OPTIONS = ['🎲', '🦊', '🦁', '🦉', '🐱', '🐸', '🚀', '👾', '👑', '💎', '⭐️', '🔥']

// Sync local input fields when props change
watch(() => props.currentName, (newVal) => {
  editableName.value = newVal
})

function saveProfile() {
  if (!editableName.value.trim()) return
  emit('update-profile', {
    name: editableName.value.trim(),
    avatar: selectedAvatar.value
  })
  emit('close')
}
</script>

<template>
  <div :class="['profile-sidebar', { 'profile-open': isOpen }]">
    <div class="profile-header">
      <h3>Edit Your Profile</h3>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>

    <div class="profile-body">
      <div class="form-group">
        <label>Your Nickname</label>
        <input 
          v-model="editableName" 
          type="text" 
          maxlength="12" 
          placeholder="Change nickname..." 
        />
      </div>

      <div class="form-group">
        <label>Select Profile Icon</label>
        <div class="avatar-grid">
          <button
            v-for="avatar in AVATAR_OPTIONS"
            :key="avatar"
            :class="['avatar-option-btn', { 'selected-avatar': selectedAvatar === avatar }]"
            @click="selectedAvatar = avatar"
          >
            {{ avatar }}
          </button>
        </div>
      </div>

      <button class="btn btn-save-profile" @click="saveProfile">
        Save Changes
      </button>
    </div>
  </div>
  
  <div v-if="isOpen" class="profile-backdrop" @click="$emit('close')"></div>
</template>

<style scoped>
.profile-sidebar {
  position: fixed;
  top: 0;
  right: -320px;
  width: 320px;
  height: 100%;
  background: #ffffff;
  box-shadow: -4px 0 24px rgba(0,0,0,0.15);
  transition: transform 0.3s cubic-bezier(0.77, 0.2, 0.05, 1.0);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  text-align: left;
}
.profile-sidebar.profile-open {
  transform: translateX(-320px);
}
.profile-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  z-index: 998;
}
.profile-header {
  padding: 20px;
  background: #1f8ceb;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.profile-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: bold;
}
.close-btn {
  background: transparent;
  border: none;
  color: white;
  font-size: 20px;
  cursor: pointer;
}
.profile-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group label {
  font-size: 13px;
  font-weight: bold;
  color: #555;
}
.form-group input {
  padding: 10px;
  border: 2px solid #ddd;
  border-radius: 6px;
  font-size: 15px;
}
.avatar-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 6px;
}
.avatar-option-btn {
  font-size: 24px;
  padding: 10px;
  background: #f5f5f5;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-option-btn:hover {
  background: #e0e0e0;
}
.avatar-option-btn.selected-avatar {
  background: #e3f2fd;
  border-color: #1f8ceb;
  transform: scale(1.05);
}
.btn-save-profile {
  background: #1f8ceb;
  color: white;
  width: 100%;
  padding: 12px;
  font-size: 15px;
  font-weight: bold;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  margin-top: 10px;
}
.btn-save-profile:hover {
  background: #1565c0;
}
</style>