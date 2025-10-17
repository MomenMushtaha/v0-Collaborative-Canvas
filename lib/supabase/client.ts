import { createBrowserClient as createBrowserClientSSR } from "@supabase/ssr"

let client: ReturnType<typeof createBrowserClientSSR> | null = null

export function createClient() {
  if (client) {
    return client
  }

  client = createBrowserClientSSR(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

  return client
}

export const getSupabaseBrowserClient = createClient

export function createBrowserClient() {
  return createClient()
}
