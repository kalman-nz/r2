import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { hashKey, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";
import { ToastProvider } from "./components/ToastProvider.tsx";
import { ConfirmProvider } from "./components/ConfirmProvider.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { currentOrgId } from "./lib/currentOrg";
import { forgetStoredMe, OrgProvider } from "./lib/org";
import { pb } from "./lib/pocketbase";

// Every cached query belongs to the organisation that was current when it
// ran, so ["jobs"] in one organisation is never shown in another, and
// switching back is instant. (["me", …] is about the person, not an
// organisation.)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: (key) => hashKey(key[0] === "me" ? key : [currentOrgId(), ...key]),
      // A 4xx (not found, not allowed) won't change on a retry; network
      // trouble and server errors might.
      retry: (failures, error) => {
        const status = (error as { status?: number }).status ?? 0;
        return status >= 400 && status < 500 ? false : failures < 3;
      },
    },
  },
});

// Nothing cached for one account may show for the next person to sign in
// on this browser.
let signedInAs = pb.authStore.record?.id ?? "";
pb.authStore.onChange((_token, record) => {
  const id = record?.id ?? "";
  if (id === signedInAs) return;
  signedInAs = id;
  queryClient.clear();
  if (!id) forgetStoredMe();
});

// Installable app + an app shell that opens offline (public/sw.js). Not in
// dev: a cached shell fighting Vite's hot reload is no fun. Browsers only
// allow service workers on https:// (and localhost).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // http:// on a LAN address, private browsing… the app works without it
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <OrgProvider>
            <ToastProvider>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
            </ToastProvider>
          </OrgProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
