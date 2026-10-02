import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './App.css'
import { AuthProvider } from "@asgardeo/auth-react";
import { Provider } from 'react-redux';
import { store } from './store/store';

const config = {
    signInRedirectURL: import.meta.env.VITE_ASGARDEO_SIGN_IN_REDIRECT_URL || window.location.origin,
    signOutRedirectURL: import.meta.env.VITE_ASGARDEO_SIGN_OUT_REDIRECT_URL || window.location.origin,
    clientID: import.meta.env.VITE_ASGARDEO_CLIENT_ID || "oRNCmE0Hn5GH7tPZ0VOSY8p1ZLoa",
    baseUrl: import.meta.env.VITE_ASGARDEO_BASE_URL || "https://api.asgardeo.io/t/yasiru2002projects",
    scope: [ "openid", "profile" ]
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <AuthProvider config={config}>
        <App />
      </AuthProvider>
    </Provider>
  </React.StrictMode>,
)
