import { AsyncLocalStorage } from 'node:async_hooks';

// Request-local attribution survives awaits without leaking to concurrent requests.
export const changeContext = new AsyncLocalStorage();
