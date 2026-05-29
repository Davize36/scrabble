import { createClient } from '@supabase/supabase-js'
const url = 'https://utujpplfhgqiqxcluovn.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0dWpwcGxmaGdxaXF4Y2x1b3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MDc4NjksImV4cCI6MjA5NTQ4Mzg2OX0.xbC5KSgG6TeNexRvRXNv8n1zwlrHQ6p4jNL9AjvgySw'
const supabase = createClient(url, key)

async function testInsert(payload) {
  const start = Date.now()
  const { data, error } = await supabase.from('games').insert([payload])
  console.log('insert elapsed', Date.now() - start)
  console.log('payload', payload)
  console.log('data', data)
  console.log('error', error)
  return data
}

;(async () => {
  try {
    console.log('=== select test ===')
    const { data: selectData, error: selectError } = await supabase.from('games').select('id,room_code').limit(1)
    console.log('select data', selectData)
    console.log('select error', selectError)

    console.log('=== minimal insert test ===')
    const row = await testInsert({ room_code: 'TEST01', status: 'pending', created_at: new Date().toISOString() })
    if (row?.id) {
      console.log('deleting test row', row.id)
      const { error: delError } = await supabase.from('games').delete().eq('id', row.id)
      console.log('delete error', delError)
    }

    console.log('=== large payload insert test ===')
    const largePayload = {
      room_code: 'TEST02',
      board_state: Array(225).fill(''),
      tile_bag: Array.from({ length: 98 }, (_, i) => ({ letter: 'A', pts: 1 })),
      players_json: [{ id: 'guest-test', name: 'Guest', rack: Array.from({ length: 7 }, () => ({ letter: 'A', pts: 1 })), score: 0 }],
      status: 'pending',
      current_turn_name: 'Guest',
      latest_play: '',
      host_id: null,
      created_at: new Date().toISOString()
    }
    const row2 = await testInsert(largePayload)
    if (row2?.id) {
      console.log('deleting test row2', row2.id)
      const { error: delError2 } = await supabase.from('games').delete().eq('id', row2.id)
      console.log('delete error2', delError2)
    }
  } catch (err) {
    console.error('caught', err)
  }
})()
