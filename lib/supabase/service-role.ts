import { createClient } from "@supabase/supabase-js"

/**
 * Creates a Supabase client with service role privileges.
 * This client bypasses Row Level Security (RLS) policies and should only be used in secure server-side contexts.
 *
 * Use cases:
 * - Server-side operations that need elevated privileges
 * - Background jobs and scheduled tasks
 * - Admin operations that bypass RLS
 *
 * WARNING: Never expose this client to the browser or client-side code.
 */
export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase environment variables for service role client")
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
