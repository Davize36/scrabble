<script setup>
import { RouterLink } from 'vue-router'

const title = 'Scrabble Online'
const subtitle = 'Challenge your friends to a real-time battle of words. Create private rooms, track live scores, and place your tiles on a classic game board.'
</script>

<template>
  <div class="landing-wrapper">
    <section class="landing">
      <div class="logo-mark">★</div>
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
      
      <div class="links">
        <RouterLink to="/lobby" class="btn btn-primary">
          Enter Game Lobby
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing-wrapper {
  min-height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-family: system-ui, -apple-system, sans-serif;
}

.landing {
  max-width: 500px;
  width: 100%;
  margin: 0 auto;
  padding: 40px 32px;
  text-align: center;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
  border: 1px solid #eaeaea;
}

.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  background: #ffc0cb; /* Matching the board's center star color */
  color: #cc0000;
  font-size: 28px;
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 10px rgba(204, 0, 0, 0.15);
}

.landing h1 {
  font-size: 2.5rem;
  font-weight: 800;
  margin: 0 0 16px 0;
  color: #222;
}

.landing p {
  font-size: 1.05rem;
  line-height: 1.6;
  color: #555;
  margin: 0 0 32px 0;
}

.links {
  display: flex;
  justify-content: center;
}

.btn {
  padding: 14px 36px;
  border-radius: 8px; /* Square edges matching the rest of the updated UI */
  text-decoration: none;
  font-weight: 700;
  font-size: 16px;
  transition: all 0.2s ease;
  display: inline-block;
  width: 100%;
}

.btn-primary {
  background: #1f8ceb;
  color: #fff;
  box-shadow: 0 4px 14px rgba(31, 140, 235, 0.3);
}

.btn-primary:hover {
  background: #156bba;
  transform: translateY(-1px);
}

@media(max-width: 520px) {
  .landing {
    padding: 32px 20px;
  }
  .landing h1 {
    font-size: 2rem;
  }
}
</style>