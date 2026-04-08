# Pageline

Show your book reading activity on Discord via Rich Presence.

Pageline is a cross-platform Electron app that lets you broadcast what you're currently reading to your Discord friends — title, author, progress, and cover art — right in your Discord profile.

## Features

- Discord Rich Presence integration (book title, author, progress)
- Track reading sessions and progress over time
- Clean, minimal UI
- Cross-platform: macOS, Windows, Linux

## Download

Grab the latest build from the [Releases page](https://github.com/alexcircuits/pageline/releases).

- **macOS**: `Pageline-<version>-arm64.dmg`
- **Windows**: `Pageline Setup <version>.exe`
- **Linux**: `Pageline-<version>.AppImage`

## Development

```bash
# Install dependencies
npm install

# Run the app
npm start

# Run tests
npm test
```

## Building

```bash
npm run dist:mac     # macOS DMG
npm run dist:win     # Windows installer
npm run dist:linux   # Linux AppImage
```

Build artifacts are written to `dist/`.

## Stack

- [Electron](https://www.electronjs.org/)
- [discord-rpc](https://www.npmjs.com/package/discord-rpc)
- [electron-builder](https://www.electron.build/)
- [Jest](https://jestjs.io/) for tests

## License

MIT
