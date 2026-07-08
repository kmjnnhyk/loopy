import { startDevServer } from "../../src/server.ts";
import { runtime } from "./fixture-app.ts";

startDevServer({ runtime, port: 5199, staticDir: new URL("../../browser/dist", import.meta.url).pathname });
