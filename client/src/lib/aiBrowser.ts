/**
 * The in-page AI stack (provider clients, the offline demo's knowledge base, every prompt and response check). Only
 * browser-mode calls need it, so api.ts imports this module on first use and it stays out of the first-paint bundle.
 */
export { createProvider, tasks } from "@nodestorm/shared";
