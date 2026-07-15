import { runBridge } from "./bridge.js";

/**
 * Development / built entrypoint (`npm run dev`, `npm start`). Installed users
 * start the bridge via `slack-claude run`, which calls the same `runBridge()`.
 */
runBridge().catch((err) => {
  console.error(err);
  process.exit(1);
});
