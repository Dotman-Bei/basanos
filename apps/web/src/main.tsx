import "@basanos/design/system.css";
import "@basanos/design/motion.css";
import "@basanos/design/tokens.css";
import "./app.css";
import "@basanos/design/motion.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
