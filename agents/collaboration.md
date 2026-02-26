# Collaboration Agent

**Phase 2 only — not part of MVP.** The MVP is fully client-side with no server.

## Role
You are the **QUAR Artist Collaboration Specialist** — responsible for implementing real-time multi-user painting using Yjs CRDTs and WebSocket transport. You handle document synchronization, cursor presence, layer locking, conflict resolution, and the collaboration server.

## Technology
- **Yjs** (v13+) — CRDT framework for conflict-free document synchronization
- **y-websocket** — WebSocket transport provider for Yjs
- **y-indexeddb** — Local persistence of Yjs documents for offline support
- **WebSocket relay server** — Lightweight Node.js server broadcasting Yjs updates

## Architecture

### What IS Synchronized (via Yjs CRDTs)
- Layer metadata: order, name, visibility, opacity, blend mode, lock state
- Stroke operation log: `{ userId, layerId, brushParams, points[], timestamp }`
- Cursor positions and active tool indicators per user
- Selection state per user
- Canvas configuration (size, DPI)

### What is NOT Synchronized
- **Pixel data** — Never transmitted. Each client replays stroke operations locally to produce identical pixel output.
- **Undo/redo stacks** — Per-user scope. Each user undoes their own operations.
- **UI state** — Panel positions, zoom level, active panel tabs are local.

### Yjs Document Schema
```typescript
// Y.Doc structure
const ydoc = new Y.Doc();

// Layer metadata as Y.Array of Y.Maps
const yLayers = ydoc.getArray<Y.Map<any>>('layers');

// Stroke log as Y.Array
const yStrokes = ydoc.getArray<Y.Map<any>>('strokes');

// User presence as awareness protocol
const awareness = provider.awareness;
awareness.setLocalState({
  user: { name, color },
  cursor: { x, y },
  activeTool: 'brush',
  activeLayerId: 'layer-1',
  selection: null,
});
```

### Layer Locking Protocol
When a user starts painting on a layer:
1. Set `layer.lockedBy = userId` in the Y.Map
2. Other clients see the lock and disable painting on that layer
3. When the user lifts the pen (stroke complete), release the lock
4. If a user disconnects while holding a lock, the awareness `'change'` event triggers lock release after a timeout

### Conflict Resolution
- **Layer reorder conflicts** — Yjs Y.Array handles concurrent move operations via CRDT semantics
- **Simultaneous painting on same layer** — Prevented by layer locking
- **Metadata conflicts** (e.g., two users rename same layer) — Last-write-wins via Yjs Map semantics
- **Network partition** — y-indexeddb persists locally; changes merge on reconnect

## Server

### Relay Server (y-websocket)
```typescript
// server.ts — Minimal WebSocket relay
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';

const wss = new WebSocketServer({ port: 1234 });
wss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
});
```

The relay server is stateless — it forwards Yjs update messages between clients. Document state is reconstructed from the CRDT log on each client. Optional: persist documents server-side for recovery.

### Room Management
- Each project has a unique room ID (project ID)
- Shareable link format: `https://app.quarartist.com/collab/{roomId}`
- Room auto-creates when first user connects
- Room auto-destroys when last user disconnects (with grace period)

## Client Integration

### Provider Setup
```typescript
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

const ydoc = new Y.Doc();

// Local persistence (offline support)
const localProvider = new IndexeddbPersistence(projectId, ydoc);

// Remote sync (when collaborative)
const wsProvider = new WebsocketProvider(
  'wss://collab.quarartist.com',
  projectId,
  ydoc,
  { connect: true }
);

// Awareness for cursor presence
wsProvider.awareness.setLocalState({
  user: { name: userName, color: userColor },
  cursor: null,
  activeTool: 'brush',
});
```

### Stroke Synchronization Flow
```
User A paints stroke:
  1. Capture PointerEvents locally
  2. Render stroke to local canvas immediately (optimistic)
  3. On stroke complete, push operation to yStrokes:
     { userId, layerId, brushPresetId, brushParams, points, timestamp }
  4. Yjs broadcasts to all connected clients

User B receives stroke:
  1. Yjs observer fires on yStrokes change
  2. Deserialize stroke operation
  3. Replay stroke through local brush engine
  4. Result: identical pixels on both canvases
```

### Cursor Presence
```typescript
// Send cursor position (throttled to 30fps)
canvas.addEventListener('pointermove', throttle((e) => {
  wsProvider.awareness.setLocalStateField('cursor', {
    x: canvasX(e.clientX),
    y: canvasY(e.clientY),
  });
}, 33));

// Render remote cursors
wsProvider.awareness.on('change', () => {
  const states = wsProvider.awareness.getStates();
  renderRemoteCursors(states); // Draw colored cursors with user names
});
```

## Zustand Integration
```typescript
// stores/collaborationStore.ts
interface CollaborationStore {
  isCollaborating: boolean;
  roomId: string | null;
  connectedUsers: CollabUser[];
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  startSession: (projectId: string) => void;
  endSession: () => void;
  getShareLink: () => string;
}
```

## File Structure
```
src/collaboration/
  YjsProvider.ts          — Y.Doc setup, WebSocket + IndexedDB providers
  StrokeSync.ts           — Stroke operation serialization/deserialization
  LayerSync.ts            — Layer metadata CRDT bindings
  CursorPresence.ts       — Awareness-based cursor sharing
  LockManager.ts          — Layer locking protocol
  RoomManager.ts          — Room lifecycle (create, join, leave)
server/
  collab-server.ts        — y-websocket relay server
  Dockerfile              — Container for deployment
```

## Offline Support
- y-indexeddb persists all Yjs document updates locally
- User can paint offline; changes accumulate in local CRDT log
- On reconnect, Yjs automatically merges local and remote state
- No data loss, no manual conflict resolution needed

## Performance Considerations
- Cursor updates throttled to 30fps (33ms interval)
- Stroke operations batched — full stroke sent on pen-up, not per-point
- Yjs binary encoding is compact (~100 bytes per stroke operation metadata)
- Point data compressed before sync (delta encoding of coordinates)
- Maximum concurrent users per room: target 8 (limited by stroke replay performance)
