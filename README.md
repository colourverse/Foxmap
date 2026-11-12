# 🦊 MindFox

A lightweight, browser-based mind mapping tool inspired by MindMeister.

## Features

- **Free-form editing**: drag any topic to move it, and its sub-topics move with it. Drop a topic onto another to make it a sub-topic of that one (hold **Shift** while dragging to move it without re-parenting).
- **Unlimited levels**: central idea → main topics → sub-topics → … with their own styling at each level.
- **Colours**: each main branch gets a colour automatically. Pick any topic and use **Colour** to choose a palette or custom colour, optionally for the whole branch. **Auto** goes back to the default colour.
- **Collapse/expand** branches (the ⊖ button or **Space**).
- **Arrange**: one-click tidy layout that removes overlaps.
- **Export**: PNG (white or transparent background, 2× resolution) and PDF (A4, Letter, or a page sized to fit the map).
- **Saving**: maps auto-save in the browser; **Maps** lists them. **Save**/**Open** download and load `.mindfox.json` files to back up or share maps.
- Undo/redo, zoom, pan, and keyboard shortcuts (press **?** in the app).

## Keyboard

| Key | Action |
| --- | --- |
| `Tab` | Add child topic |
| `Enter` | Add sibling topic |
| `F2`, double-click, or start typing | Edit text (`Shift+Enter` = new line) |
| `Delete` | Delete topic |
| Arrow keys | Move selection |
| `Space` | Collapse / expand |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl` + scroll | Zoom |

## Development

```bash
npm install
npm run dev      # start dev server at http://localhost:5173
npm test         # unit tests
npm run build    # production build in dist/ (static files, host anywhere)
```

Built with TypeScript + Vite; rendering is plain SVG; PDF export uses [jsPDF](https://github.com/parallax/jsPDF).

Code layout: `src/model.ts` (data model & layout, no DOM), `src/render.ts` (SVG rendering), `src/export.ts` (PNG/PDF/JSON), `src/storage.ts` (localStorage), `src/main.ts` (UI & interactions).
