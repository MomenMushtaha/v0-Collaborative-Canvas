# CollabCanvas - Real-Time Collaborative Canvas with AI Agent

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/momenmushtahas-projects/v0-collaborative-canvas-mvp)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/NUaCCUvSMZL)

A real-time collaborative canvas application with AI-powered design assistance, built with Next.js, Supabase, and the Vercel AI SDK.

## Features

### Core Collaborative Features
- **Real-time synchronization** - Sub-100ms object sync across multiple users
- **Live cursor tracking** - See where other users are working in real-time
- **Persistent state** - All changes automatically saved to database
- **Connection resilience** - Automatic reconnection with operation queuing during network drops
- **Conflict resolution** - Last-write-wins strategy with real-time broadcast
- **Anchored comment threads** - Drop comment pins, resolve/discard them, and subscribe to live updates
- **Canvas version history** - Capture manual or automatic snapshots, preview metadata, and restore with undo safety nets

### Canvas Functionality
- **Drawing tools** - Rectangle, Circle, Triangle, Line, and Text layers
- **Transform operations** - Move, resize, and rotate objects
- **Multi-select & grouping** - Shift/drag select, lasso select, group/ungroup, and "select all of type" shortcuts
- **Pan & Zoom** - Smooth viewport navigation with constraints
- **Color customization** - Fill and stroke color picker with presets
- **Layer management** - Visual layers panel with visibility, lock, and z-index control
- **Alignment tools** - Align, distribute, and reorder objects (front/back/forward/backward)
- **Grid & snapping** - Toggle-able grid overlays with adjustable density and snapping strength
- **Export utilities** - Export the current viewport or selection to PNG/SVG with background configuration

### Advanced Features
- **Undo/Redo** - Full history tracking with Ctrl+Z / Ctrl+Y support and persistent snapshot history
- **Keyboard shortcuts** - Delete, Select All, Select All of Type, Group/Ungroup, Undo/Redo, Lasso toggle, Comment mode
- **Style panel** - Context-sensitive styling for selected objects
- **AI operations queue** - Serialized AI canvas actions with status tracking and replay safety
- **Performance monitoring** - Real-time FPS tracking and sync latency logging
- **Session hardening** - Single-session enforcement with reliable logout beacons and Supabase `user_sessions`

### AI Canvas Agent
- **Natural language commands** - Create and manipulate objects using chat
- **8 AI commands** - getCanvasState, createShape, createText, moveShape, resizeShape, rotateShape, deleteShape, arrangeShapes
- **Complex operations** - Multi-step layouts (grid, row, column, circle patterns)
- **Viewport-aware positioning** - AI places objects in visible canvas area
- **Shared AI state** - All users see AI-generated objects in real-time

## Technology Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui components
- **Real-time**: Supabase Realtime (WebSocket-based)
- **Database**: Supabase PostgreSQL with Row Level Security
- **Authentication**: Supabase Auth (email/password)
- **AI**: Vercel AI SDK with GPT-4o-mini
- **Deployment**: Vercel

## Architecture

### Component Structure
\`\`\`
app/
├── canvas/page.tsx          # Main canvas page
├── api/ai-canvas/route.ts   # AI agent API endpoint
├── api/logout/route.ts      # Session cleanup endpoint
components/
├── collaborative-canvas.tsx # Main canvas orchestrator
├── toolbar.tsx              # Drawing, selection, export, and history actions
├── history-panel.tsx        # Snapshot browser and restore controls
├── comments-panel.tsx       # Comment feed and moderation tools
├── ai-chat.tsx              # AI chat interface
├── layers-panel.tsx         # Layer management UI
├── style-panel.tsx          # Color and style controls
├── alignment-toolbar.tsx    # Alignment tools & z-order helpers
├── presence-panel.tsx       # Connected user list and activity
├── connection-status.tsx    # Network status indicator
components/ui/               # shadcn/ui primitives
hooks/
├── use-canvas.ts            # Canvas rendering and interactions
├── use-realtime-canvas.ts   # Real-time sync and reconnection
├── use-history.ts           # Undo/redo command history
├── use-keyboard-shortcuts.ts # Keyboard event handling
├── use-ai-queue.ts          # AI queue subscription utilities
├── use-presence.ts          # Presence tracking & cursor broadcasting
lib/
├── types.ts                 # TypeScript type definitions
├── alignment-utils.ts       # Alignment calculation utilities
├── comments-utils.ts        # Comment persistence helpers
├── history-utils.ts         # Snapshot persistence helpers
├── export-utils.tsx         # PNG/SVG export helpers
├── session-utils.ts         # Single-session enforcement helpers
├── grid-utils.ts            # Grid spacing & snapping utilities
├── group-utils.ts           # Grouping helpers
├── selection-utils.ts       # Selection heuristics
├── supabase/                # Supabase client factories
scripts/                     # SQL migrations & maintenance tasks
\`\`\`

### Real-Time Architecture
1. **Broadcast-based sync** - Changes broadcast to all connected users via Supabase channels
2. **Debounced persistence** - Local updates immediate, database writes debounced (300ms)
3. **Separate channels** - Objects, cursors, and AI operations use dedicated channels
4. **Operation queuing** - Operations queued during disconnect and replayed on reconnection
5. **Comment subscriptions** - Comment inserts stream over `comments:{canvasId}` channels for instant annotations
6. **AI queue mirroring** - `ai_operations_queue` state mirrored client-side with `useAIQueue`

### AI Agent Architecture
1. **Tool-based execution** - AI uses 8 defined tools to manipulate canvas
2. **Viewport context** - Client sends viewport state for intelligent positioning
3. **Shared operations queue** - AI operations broadcast to all users via `ai_operations_queue` table with status transitions
4. **Natural language processing** - GPT-4o-mini interprets user intent and generates tool calls

## Setup Instructions

### Prerequisites
- Node.js 18+ and npm/yarn/pnpm
- Supabase account
- Vercel account (for deployment)
- OpenAI API key (for AI features)

### Local Development

1. **Clone the repository**
   \`\`\`bash
   git clone https://github.com/your-username/v0-collaborative-canvas-mvp.git
   cd v0-collaborative-canvas-mvp
   \`\`\`

2. **Install dependencies**
   \`\`\`bash
   npm install
   \`\`\`

3. **Set up Supabase**
   - Create a new Supabase project at [supabase.com](https://supabase.com)
   - Run the database migrations in the `scripts/` folder:
     - `01-create-tables.sql` – Base `canvas_objects` schema and policies
     - `05-add-text-columns.sql` – Text layer support for typography tools
     - `04-create-ai-queue-table.sql` – AI operation queue & cleanup function
     - `create_canvas_history_table.sql` – Snapshot storage backing the History panel
     - `create_canvas_comments_table.sql` – Comment pins with resolve/delete policies
     - `create_user_sessions_table.sql` – Single-session enforcement helpers
     - `04-enable-realtime.sql` – Realtime replication setup for Supabase (if not already enabled)
   - Apply any `fix_canvas_comments_rls_*.sql` scripts if you tweak comment policies
   - Enable Row Level Security (RLS) on all tables (handled by the scripts above)

4. **Configure environment variables**
   
   Create a `.env.local` file with:
   \`\`\`env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Development redirect URL for auth
   NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://localhost:3000
   
   # OpenAI (for AI agent)
   OPENAI_API_KEY=your_openai_api_key
   \`\`\`

5. **Run the development server**
   \`\`\`bash
   npm run dev
   \`\`\`

6. **Open the app**
   Navigate to [http://localhost:3000](http://localhost:3000)

### Database Schema

**canvas_objects table:**
- `id` (uuid, primary key)
- `canvas_id` (text) - Canvas identifier
- `type` (text) - Object type (rectangle, circle, triangle, line, text)
- `x`, `y` (numeric) - Position
- `width`, `height` (numeric) - Dimensions
- `rotation` (numeric) - Rotation angle
- `fill_color`, `stroke_color` (text) - Colors
- `z_index` (integer) - Layer order
- `visible` (boolean) - Visibility state
- `locked` (boolean) - Lock state
- `text_content`, `font_size`, `font_family` (text) - Text properties
- `created_at`, `updated_at` (timestamp)

**canvas_history table:**
- `id` (uuid, primary key)
- `canvas_id` (text) - Canvas identifier
- `snapshot` (jsonb) - Serialized `CanvasObject[]`
- `created_by` (uuid) - Author of the snapshot
- `created_by_name` (text)
- `created_at` (timestamp)
- `description` (text)
- `object_count` (integer)

**canvas_comments table:**
- `id` (uuid, primary key)
- `canvas_id` (text)
- `x`, `y` (real) - Position of the comment pin
- `content` (text)
- `created_by` (uuid)
- `created_by_name` (text)
- `created_at`, `updated_at` (timestamp)
- `resolved` (boolean)
- `resolved_by` (uuid)
- `resolved_at` (timestamp)

**ai_operations_queue table:**
- `id` (uuid, primary key)
- `canvas_id` (text)
- `user_id` (uuid)
- `user_name` (text)
- `status` (text) - `pending`, `processing`, `completed`, or `failed`
- `prompt` (text)
- `operations` (jsonb)
- `error_message` (text)
- `created_at`, `started_at`, `completed_at` (timestamp)

**user_sessions table:**
- `id` (uuid, primary key)
- `user_id` (uuid) - References `auth.users`
- `session_id` (text) - Supabase access token identifier
- `device_info` (text)
- `ip_address` (text)
- `created_at`, `last_activity` (timestamp)
- `one_session_per_user` unique constraint ensures a single active session per account

### OAuth Setup (Optional)

To enable Google and GitHub OAuth authentication:

1. **Configure OAuth providers in Supabase**
   - Go to your Supabase project dashboard
   - Navigate to Authentication > Providers
   - Enable Google OAuth:
     - Add your Google Client ID and Secret
     - Get credentials from [Google Cloud Console](https://console.cloud.google.com/)
   - Enable GitHub OAuth:
     - Add your GitHub Client ID and Secret
     - Get credentials from [GitHub Developer Settings](https://github.com/settings/developers)

2. **Add redirect URLs**
   - In each OAuth provider settings, add:
     - Development: `http://localhost:3000/auth/callback`
     - Production: `https://your-app.vercel.app/auth/callback`

3. **Test OAuth flow**
   - Users can now sign in with Google or GitHub buttons
   - OAuth users are automatically created in the database
   - User metadata (name, avatar) is pulled from OAuth provider

## Usage Guide

### Creating Objects
1. Select a tool from the toolbar (Rectangle, Circle, Triangle, Line, Text)
2. Click and drag on the canvas to create the object
3. For text: Click to place, type content, click outside to finish

### Selecting and Editing
- **Single select**: Click an object
- **Multi-select**: Shift+click objects or drag-select with mouse
- **Select all**: Ctrl+A (Cmd+A on Mac)
- **Move**: Drag selected objects
- **Resize**: Drag corner handles
- **Rotate**: Drag rotation handle
- **Delete**: Press Delete or Backspace

### Styling Objects
1. Select one or more objects
2. Use the Style Panel (appears on right) to change colors
3. Choose from preset colors or enter custom hex values

### Layer Management
1. Open the Layers Panel (right side)
2. Click layers to select objects
3. Use eye icon to toggle visibility
4. Use lock icon to prevent editing
5. Drag layers to reorder (z-index)

### Alignment Tools
1. Select 2+ objects
2. Use alignment buttons in toolbar:
   - Align: Left, Right, Top, Bottom, Center H, Center V
   - Distribute: Horizontal, Vertical (requires 3+ objects)

### Grid & Snapping
1. Open the toolbar grid menu (top bar)
2. Toggle the grid overlay and snapping independently
3. Adjust the grid size slider to tighten/loosen spacing

### Comments & Reviews
1. Toggle **Comment Mode** from the toolbar (or press `C`)
2. Click on the canvas to drop a comment pin and submit feedback
3. Resolve, delete, or filter comments from the Comments Panel (bottom left)
4. Use the panel collapse button to reclaim screen space while keeping counts visible

### Version History
1. Open **Version History** from the toolbar clock icon
2. Save a snapshot with an optional note (auto-snapshots also run every few minutes)
3. Browse previous versions, preview metadata, and restore to the canvas
4. Restores update local undo/redo stacks to ensure safe rollbacks

### Exporting Artwork
1. Select objects (or keep nothing selected to export everything)
2. Open the **Export** dropdown in the toolbar
3. Choose PNG or SVG – exports respect the current viewport and background color
4. Downloaded files include a timestamped filename

### Session Management & Presence
1. Users are limited to a single active session; re-authentication elsewhere logs out older clients
2. A background beacon hits `/api/logout` to clean up `user_sessions` when the tab closes
3. Presence list (top left) surfaces connected collaborators with color-coded cursors

### Undo/Redo
- **Undo**: Ctrl+Z (Cmd+Z on Mac) or toolbar button
- **Redo**: Ctrl+Y or Ctrl+Shift+Z (Cmd+Shift+Z on Mac) or toolbar button

### AI Agent
1. Click the AI button (bottom right)
2. Type natural language commands:
   - "Create a blue rectangle"
   - "Add three circles in a row"
   - "Arrange the selected objects in a grid"
   - "Move the triangle to the center"
3. AI generates objects in the visible canvas area

## Performance Metrics

- **Real-time sync**: <100ms object propagation
- **Cursor sync**: <50ms latency
- **AI response**: 2-4s average
- **Render performance**: 60 FPS with 100+ objects
- **Concurrent users**: Tested with 5+ simultaneous users
- **Network resilience**: Handles 30s+ disconnections with operation queuing

## Deployment

### Deploy to Vercel

1. **Push to GitHub**
   \`\`\`bash
   git push origin main
   \`\`\`

2. **Import to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Add environment variables (same as `.env.local`)
   - Deploy

3. **Configure Supabase redirect URL**
   - In Supabase dashboard, add your Vercel URL to allowed redirect URLs
   - Format: `https://your-app.vercel.app/auth/callback`

### Live Demo

**Production URL**: [https://vercel.com/momenmushtahas-projects/v0-collaborative-canvas-mvp](https://vercel.com/momenmushtahas-projects/v0-collaborative-canvas-mvp)

## Development

### Continue building on v0.app

**Project URL**: [https://v0.app/chat/projects/NUaCCUvSMZL](https://v0.app/chat/projects/NUaCCUvSMZL)

This repository automatically syncs with your v0.app deployments. Any changes made in v0 will be pushed to this repository.

## Contributing

This project was built as part of the CollabCanvas Challenge. For questions or issues, please open a GitHub issue.

## License

MIT License - See LICENSE file for details
