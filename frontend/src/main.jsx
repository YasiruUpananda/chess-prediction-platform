import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from "@asgardeo/auth-react";
import { Provider } from 'react-redux';
import { store } from './store/store';

const config = {
    signInRedirectURL: "http://localhost:5173",
    signOutRedirectURL: "http://localhost:5173",
    clientID: "oRNCmE0Hn5GH7tPZ0VOSY8p1ZLoa",
    baseUrl: "https://api.asgardeo.io/t/yasiru2002projects",
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