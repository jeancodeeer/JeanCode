# Security

- **No URLs or keys in this repository.** Each user enters the URL and key of their own `jean-api`. Never commit them, not even in examples.
- **Web:** the URL, key and history are stored only in the browser's local storage. Use SETTINGS → wipe to remove them.
- **Desktop:** the key is encrypted with the operating system keychain (Electron `safeStorage`). File tools cannot leave the chosen workspace, and every terminal command asks for confirmation.
- **Previews** of generated web pages run in a sandboxed iframe without access to the page's storage.

Report a vulnerability through a private GitHub security advisory on this repository.
