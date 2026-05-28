import bolt from "@slack/bolt";
import type { Installation, InstallationStore } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { config } from "./config.ts";

const SCOPES = [
  "commands",
  "chat:write",
  "channels:read",
  "groups:read",
  "users:read",
] as const;

/**
 * Single-workspace MVP installation store. Holds the most recent install in
 * memory plus optionally the bootstrapped `SLACK_BOT_TOKEN` so the bot works
 * before any OAuth round-trip.
 *
 * Sync-point change candidate: swap for a Postgres-backed store when we go
 * multi-workspace (see plan, "Multi-workspace later" risk).
 */
const installs = new Map<string, Installation<"v2", false>>();

const installationStore: InstallationStore = {
  storeInstallation: async (installation) => {
    if (installation.isEnterpriseInstall && installation.enterprise?.id) {
      installs.set(installation.enterprise.id, installation as Installation<"v2", false>);
      return;
    }
    if (installation.team?.id) {
      installs.set(installation.team.id, installation as Installation<"v2", false>);
      return;
    }
    throw new Error("Cannot store installation without team or enterprise id");
  },
  fetchInstallation: async (query) => {
    const id = query.isEnterpriseInstall ? query.enterpriseId : query.teamId;
    if (!id) {
      throw new Error("Cannot fetch installation without team or enterprise id");
    }
    const installation = installs.get(id);
    if (installation) return installation;

    if (config.SLACK_BOT_TOKEN && query.teamId) {
      return {
        team: { id: query.teamId, name: "dev" },
        bot: {
          token: config.SLACK_BOT_TOKEN,
          scopes: [...SCOPES],
          id: "B000000000",
          userId: "U000000000",
        },
        tokenType: "bot",
        isEnterpriseInstall: false,
        appId: config.SLACK_CLIENT_ID,
        authVersion: "v2",
      } as Installation<"v2", false>;
    }
    throw new Error(`No installation found for team ${id}`);
  },
  deleteInstallation: async (query) => {
    const id = query.isEnterpriseInstall ? query.enterpriseId : query.teamId;
    if (id) installs.delete(id);
  },
};

export const expressReceiver = new bolt.ExpressReceiver({
  signingSecret: config.SLACK_SIGNING_SECRET,
  clientId: config.SLACK_CLIENT_ID,
  clientSecret: config.SLACK_CLIENT_SECRET,
  stateSecret: config.SLACK_STATE_SECRET,
  scopes: [...SCOPES],
  installationStore,
  endpoints: {
    events: "/slack/events",
  },
  installerOptions: {
    directInstall: true,
    installPath: "/slack/install",
    redirectUriPath: "/slack/oauth_redirect",
  },
});

export const boltApp = new bolt.App({
  receiver: expressReceiver,
  ...(config.SLACK_BOT_TOKEN ? { token: config.SLACK_BOT_TOKEN } : {}),
});

/**
 * Get a `WebClient` scoped to a team. Use this in handlers instead of calling
 * `boltApp.client` directly so the token-resolution logic stays in one place.
 */
export async function getClientForTeam(teamId: string): Promise<WebClient> {
  const installation = await installationStore.fetchInstallation({
    teamId,
    isEnterpriseInstall: false,
    enterpriseId: undefined,
  });
  const token = installation.bot?.token ?? config.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error(`No bot token available for team ${teamId}`);
  }
  return new WebClient(token);
}
