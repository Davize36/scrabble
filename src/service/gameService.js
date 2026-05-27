import { supabase } from '../supabase' // Adjust path to point to your supabase.js file

export const gameService = {
  // 1. Create a brand new match room
  async createGame(hostPlayerId, emptyBoardGrid, freshTileBag) {
    const { data, error } = await supabase
      .from('games')
      .insert([
        {
          player_one: hostPlayerId,
          board_state: emptyBoardGrid,
          tile_bag: freshTileBag,       
          status: 'pending',
          current_turn: hostPlayerId
        }
      ])
      .select()
      .single()

    if (error) throw error
    return data
  },

  // 2. Submit a turn/move
  async submitTurn(gameId, updatedBoard, nextPlayerId, updatedBag) {
    const { error } = await supabase
      .from('games')
      .update({
        board_state: updatedBoard,
        tile_bag: updatedBag,
        current_turn: nextPlayerId
      })
      .eq('id', gameId)

    if (error) throw error
  }
}