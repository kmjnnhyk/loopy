import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App.tsx";
import { connect } from "./client.ts";

createRoot(document.getElementById("root")!).render(<App client={connect()} />);
