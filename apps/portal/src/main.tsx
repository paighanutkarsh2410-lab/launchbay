import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell";
import { Catalog } from "./pages/Catalog";
import { LaunchWizard } from "./pages/LaunchWizard";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { ServiceView } from "./pages/ServiceView";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2_000, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: "launch", element: <LaunchWizard /> },
      { path: "services", element: <Catalog /> },
      { path: "services/:name", element: <ServiceView /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
