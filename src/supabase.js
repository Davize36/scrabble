import { createClient } from "@supabase/supabase-js";

// The clean root URL (stops at .co)
const supabaseUrl = "https://utujpplfhgqiqxcluovn.supabase.co";

// Your verified anon key string
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0dWpwcGxmaGdxaXF4Y2x1b3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MDc4NjksImV4cCI6MjA5NTQ4Mzg2OX0.xbC5KSgG6TeNexRvRXNv8n1zwlrHQ6p4jNL9AjvgySw";

export const supabase = createClient(supabaseUrl, supabaseKey);