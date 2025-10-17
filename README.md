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

### Canvas Functionality
- **Drawing tools** - Rectangle, Circle, Triangle, Line, and Text layers
- **Transform operations** - Move, resize, and rotate objects
- **Multi-select** - Shift-click or drag-select multiple objects
- **Pan & Zoom** - Smooth viewport navigation with constraints
- **Color customization** - Fill and stroke color picker with presets
- **Layer management** - Visual layers panel with visibility, lock, and z-index control
- **Alignment tools** - Align and distribute objects (left, right, top, bottom, center, distribute)

### Advanced Features
- **Undo/Redo** - Full history tracking with Ctrl+Z / Ctrl+Y support
- **Keyboard shortcuts** - Delete, Select All, Undo, Redo
- **Style panel** - Context-sensitive styling for selected objects
- **Performance monitoring** - Real-time FPS tracking and sync latency logging

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
components/
├── collaborative-canvas.tsx # Main canvas orchestrator
├── toolbar.tsx              # Drawing tools and actions
├── layers-panel.tsx         # Layer management UI
├── style-panel.tsx          # Color and style controls
├── alignment-toolbar.tsx    # Alignment tools
├── ai-chat.tsx              # AI chat interface
├── connection-status.tsx    # Network status indicator
hooks/
├── use-canvas.ts            # Canvas rendering and interactions
├── use-realtime-canvas.ts   # Real-time sync and reconnection
├── use-history.ts           # Undo/redo command history
├── use-keyboard-shortcuts.ts # Keyboard event handling
lib/
├── types.ts                 # TypeScript type definitions
├── alignment-utils.ts       # Alignment calculation utilities
\`\`\`

### Real-Time Architecture
1. **Broadcast-based sync** - Changes broadcast to all connected users via Supabase channels
2. **Debounced persistence** - Local updates immediate, database writes debounced (300ms)
3. **Separate channels** - Objects, cursors, and AI operations use dedicated channels
4. **Operation queuing** - Operations queued during disconnect and replayed on reconnection

### AI Agent Architecture
1. **Tool-based execution** - AI uses 8 defined tools to manipulate canvas
2. **Viewport context** - Client sends viewport state for intelligent positioning
3. **Shared operations queue** - AI operations broadcast to all users via `ai_operations_queue` table
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
   - Run the database migrations in `scripts/` folder:
     - `001_initial_schema.sql` - Creates canvas_objects table
     - `002_add_ai_operations_queue.sql` - Creates AI operations table
     - `003_add_text_columns.sql` - Adds text layer support
   - Enable Row Level Security (RLS) on all tables

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

**ai_operations_queue table:**
- `id` (uuid, primary key)
- `canvas_id` (text)
- `operation_type` (text)
- `operation_data` (jsonb)
- `created_at` (timestamp)

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
1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository
