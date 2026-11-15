import React from "react";
import {InterfaceLanguageDocument} from './components/InterfaceLanguage.jsx';
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { IdentityGate } from './components/IdentityGate.jsx';
import { Notifications } from './components/Notifications.jsx';
import "./styles.css";
import "./components/sidebar-v2.css";
import "./components/organization.css";
import "./components/dialog-neutral.css";
import './components/scroll-fades.css';
import { installScrollFades } from './lib/scroll-fades.js';
import { loadBundledInterfaceLanguage, readInterfaceLanguage } from './lib/interface-language.js';

const disposeScrollFades = installScrollFades();
if (import.meta.hot) import.meta.hot.dispose(disposeScrollFades);

const render=()=>createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <InterfaceLanguageDocument />
    <Notifications />
    <IdentityGate><App /></IdentityGate>
  </React.StrictMode>,
);
const languageReady=loadBundledInterfaceLanguage(readInterfaceLanguage());
if(languageReady)languageReady.then(render,render);else render();
