import { createContext, useContext } from 'react';
const context = createContext(null);
const value = { state: { isAuthenticated:true,isLoading:false,username:'browser-test' },
  getAccessToken: async () => 'browser-test-token',
  signIn: async () => window.dispatchEvent(new Event('browser-test:signin')),
  signOut: async () => {} };
export function AuthProvider({ children }) { return <context.Provider value={value}>{children}</context.Provider>; }
// Explicitly confined to Vite's browser-test mode; never bundled by production.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuthContext = () => useContext(context);
