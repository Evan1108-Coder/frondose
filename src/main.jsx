import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { IdentityGate } from './components/IdentityGate.jsx';
import "./styles.css";
import "./components/sidebar-v2.css";
import "./components/organization.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <IdentityGate><App /></IdentityGate>
  </React.StrictMode>,
);
