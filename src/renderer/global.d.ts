import type { JarvisApi } from "../main/preload";

declare global {
  interface Window {
    jarvis: JarvisApi;
  }
}

export {};
