# Migration Notes: Electron → Tauri

## Project Structure

```
fs.manager.tauri/
├── src-tauri/                    ← Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── src/
│   │   ├── main.rs               ← Entry point
│   │   └── lib.rs                ← Tauri app builder
│   └── icons/
├── src/                          ← React UI (migrated from electron.MUI)
│   ├── MAIN_WIN/                 ← Main file explorer window
│   ├── NODE_WIN/                 ← Node editor (ReactFlow)
│   ├── PREVIEW_WIN/              ← Media preview window
│   ├── Store/                    ← Zustand stores
│   ├── theme/                    ← MUI theme
│   ├── types/                    ← TypeScript types
│   ├── Utils/                    ← Shared utilities
│   ├── fonts/                    ← Montserrat fonts
│   └── PROCESSING/               ← Processing logic
├── index.html                    ← Main window entry
├── nodeWin.html                  ← Node editor entry
├── previewWin.html               ← Preview entry
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Migration Mapping

### Electron → Tauri

| Electron | Tauri | Status |
|----------|-------|--------|
| `electron/main/index.ts` | `src-tauri/src/lib.rs` | 🔴 Not started |
| `electron/main/handlers.ts` | `src-tauri/src/commands/fs_operations.rs` | 🔴 Not started |
| `electron/preload/index.ts` | `@tauri-apps/api` (direct import) | 🔴 Not started |
| `electron/main/PluginManager.ts` | `src-tauri/src/services/plugin_manager.rs` | 🔴 Not started |
| `electron/main/processing/` | `src-tauri/src/services/processing.rs` | 🔴 Not started |
| `electron/main/logger.ts` | `src-tauri/src/services/logger.rs` | 🔴 Not started |
| `electron/main/storeCache.ts` | `tauri-plugin-store` | 🔴 Not started |
| `electron/main/update.ts` | `tauri-plugin-updater` | 🔴 Not started |

### IPC → Tauri Commands

| IPC Channel | Tauri Command | Source File |
|-------------|---------------|-------------|
| `getNodeObjFromFile` | `get_node_obj_from_file` | handlers.ts |
| `saveFlowToOptionsFolder` | `save_flow_to_options_folder` | handlers.ts |
| `getFileInfo` | `get_file_info` | handlers.ts |
| `selectFolders` / `selectFiles` | `select_folders` / `select_files` | handlers.ts (dialog) |
| `copyItem` / `moveItem` / `deleteItem` | `copy_item` / `move_item` / `delete_item` | handlers.ts |
| `readFileSync` / `writeFile` | `read_file_sync` / `write_file` | handlers.ts |
| `process-item` | `process_item` | processing/processItem.ts |
| `plugins:*` | `plugins:*` | PluginManager.ts |

### Plugins Adaptation

| Current | Target |
|---------|--------|
| `import { fn } from '../../electron/main/...'` | `import { invoke } from '@tauri-apps/api/core'` |
| `sendToMW('log', { text })` | `emit('processing:event', { type: 'log', payload: { text } })` |
| `spawnFFmpegCommand()` | `invoke('spawn_ffmpeg', { command })` |
| ESM module (Node.js) | JS module in renderer process |

### Dependencies

| Kept | Removed | Added |
|------|---------|-------|
| React 19 | electron | @tauri-apps/api |
| React DOM | electron-store | @tauri-apps/cli (dev) |
| MUI v7 | electron-updater | tauri-plugin-fs |
| Zustand v5 | vite-plugin-electron | tauri-plugin-dialog |
| @xyflow/react | electron-builder | tauri-plugin-store |
| @dnd-kit/* | adm-zip (in plugins) | tauri-plugin-shell |
| monaco-editor | chokidar | notify (Rust) |
| lucide-react | winston | |

## Key Differences

1. **No Node.js in main process** — all FS/FFmpeg ops via Tauri commands (Rust)
2. **Plugins run in renderer** — JS plugins call `invoke()` for system access
3. **File watchers** — `notify` crate instead of `chokidar`
4. **Store** — `tauri-plugin-store` instead of `electron-store`
5. **Updater** — `tauri-plugin-updater` instead of `electron-updater`
6. **Multi-window** — Tauri v2 supports multiple windows, API differs

## Next Steps

- [ ] Copy all UI components from electron.MUI
- [ ] Implement Rust FS commands (handlers.ts → commands/)
- [ ] Adapt preload API → @tauri-apps/api
- [ ] Setup multi-window (nodeWin, previewWin)
- [ ] Implement plugin manager in Rust
- [ ] Adapt plugins to use invoke() instead of direct imports
- [ ] Setup file watchers with notify crate
- [ ] Setup store plugin
- [ ] Setup updater plugin
