/// <reference types="vite/client" />

// Google Identity Services (loaded from accounts.google.com/gsi/client at runtime)
// and our global credential callback used by the Login page.
declare global {
  interface Window {
    google?: any;
    handleGoogleCredential?: (response: { credential: string }) => void;
  }
}

export {};
