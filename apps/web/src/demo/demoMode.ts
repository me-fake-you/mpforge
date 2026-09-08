export const isPublicDemoMode =
  __MPFORGE_DEMO_MODE__ ||
  import.meta.env.MODE === "demo" ||
  import.meta.env.VITE_MPFORGE_DEMO_MODE === "true";
