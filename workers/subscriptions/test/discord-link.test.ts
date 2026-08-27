import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { hmacSha256 } from "../src/crypto";
import { fakeD1 } from "./helpers/fake-d1";
import { executionContext, makeEnv, mockStripe } from "./helpers/worker";

const STATE_SECRET = "discord_state_test_secret";
const DISCORD_USER_ID = "discord_1";

function discordEnv(db: ReturnType<typeof fakeD1>) {
  return makeEnv(db, {
    DISCORD_CLIENT_ID: "client_1",
    DISCORD_CLIENT_SECRET: "client_secret_1",
    DISCORD_OAUTH_STATE_SECRET: STATE_SECRET,
  });
}

/** Mirrors createDiscordState:
 * `purpose.provider.userId.port.appNonce.expiresAt.nonce.signature`. */
async function discordState(
  purpose: "link" | "login",
  userId: string,
  port: number | "" = "",
  appNonce = ""
) {
  const payload = [
    purpose,
    "discord",
    userId,
    port,
    appNonce,
    Math.floor(Date.now() / 1000) + 600,
    "nonce_1",
  ].join(".");
  return `${payload}.${await hmacSha256(STATE_SECRET, payload)}`;
}

async function callbackRequest(userId: string) {
  const state = await discordState("link", userId);
  return new Request(
    `https://worker.test/discord/callback?code=auth_code_1&state=${encodeURIComponent(state)}`
  );
}

// mockStripe is just a fetch stub keyed by URL fragment — here it stands in for
// Discord's OAuth token and user endpoints.
function mockDiscordOAuth() {
  return mockStripe({
    routes: {
      "oauth2/token": { access_token: "discord_access_token", token_type: "Bearer" },
      "users/@me": { id: DISCORD_USER_ID, username: "ghost", global_name: "Ghost" },
    },
  });
}

let discord: ReturnType<typeof mockStripe> | null = null;

afterEach(() => {
  discord?.restore();
  discord = null;
});

describe("GET /discord/callback", () => {
  it("links Discord to the account named in the state", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1();

    const response = await worker.fetch(await callbackRequest("user_1"), discordEnv(db), executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("discord_links")).toEqual([
      expect.objectContaining({ user_id: "user_1", discord_user_id: DISCORD_USER_ID }),
    ]);
    expect(db.rows("user_connections")).toEqual([
      expect.objectContaining({ user_id: "user_1", provider: "discord", provider_id: DISCORD_USER_ID }),
    ]);
  });

  it("claims a legacy steam-keyed row instead of failing the UNIQUE constraint", async () => {
    // Rows written before the user_id migration are keyed by steam_id only.
    // The upsert resolves conflicts on user_id, so without claiming this row
    // first the INSERT hit UNIQUE(discord_user_id) and the link never landed —
    // leaving the app convinced the account had no Discord at all.
    discord = mockDiscordOAuth();
    const db = fakeD1({
      discord_links: [
        {
          steam_id: "7656119",
          user_id: null,
          discord_user_id: DISCORD_USER_ID,
          discord_username: "ghost",
          discord_global_name: "Ghost",
          linked_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    });

    const response = await worker.fetch(await callbackRequest("user_1"), discordEnv(db), executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("discord_links")).toEqual([
      expect.objectContaining({ user_id: "user_1", discord_user_id: DISCORD_USER_ID }),
    ]);
  });

  it("moves the link when the Discord account belonged to another user", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1({
      discord_links: [
        {
          steam_id: null,
          user_id: "user_old",
          discord_user_id: DISCORD_USER_ID,
          discord_username: "ghost",
          discord_global_name: "Ghost",
          linked_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ],
      user_connections: [
        {
          user_id: "user_old",
          provider: "discord",
          provider_id: DISCORD_USER_ID,
          metadata_json: "{}",
          linked_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    });

    const response = await worker.fetch(await callbackRequest("user_2"), discordEnv(db), executionContext);

    expect(response.status).toBe(200);
    expect(db.rows("discord_links")).toEqual([
      expect.objectContaining({ user_id: "user_2", discord_user_id: DISCORD_USER_ID }),
    ]);
    expect(db.rows("user_connections")).toEqual([
      expect.objectContaining({ user_id: "user_2", provider: "discord" }),
    ]);
  });

  it("answers with HTML, not a JSON 500, when the write fails", async () => {
    discord = mockDiscordOAuth();
    const db = fakeD1();
    const failing = {
      ...db,
      prepare(sql: string) {
        if (/^\s*DELETE FROM discord_links/i.test(sql)) {
          return {
            bind: () => ({
              run: async () => {
                throw new Error("D1_ERROR: database is locked");
              },
            }),
          };
        }
        return db.prepare(sql);
      },
    } as unknown as typeof db;

    const response = await worker.fetch(
      await callbackRequest("user_1"),
      makeEnv(failing, {
        DISCORD_CLIENT_ID: "client_1",
        DISCORD_CLIENT_SECRET: "client_secret_1",
        DISCORD_OAUTH_STATE_SECRET: STATE_SECRET,
      }),
      executionContext
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
