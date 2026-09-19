import { createContext, useContext } from "react";

// Keep context identity stable when UI primitives are replaced by hot reload.
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
