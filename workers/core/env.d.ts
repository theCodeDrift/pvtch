// Additional environment variables that are set via secrets or dev vars
// These extend the generated Env interface from worker-configuration.d.ts

declare global {
  interface Env {
    // Development variables (set in .dev.vars or programmatically)
    DEVELOPMENT?: string;
    DISABLE_CACHE?: boolean;
    DEV_TWITCH_USER_ID?: string;
  }
}

export {};
