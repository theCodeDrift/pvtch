// Core sources are type-checked here (src/user-stub.ts types PVTCH_USER with
// core's User class), and they read this core-only dev var. Declared so the
// shared Env type-checks; pvtch-twitch never sets or reads it.

declare global {
  interface Env {
    DEV_TWITCH_USER_ID?: string;
  }
}

export {};
