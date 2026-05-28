import { listSubcommands, registerSubcommand } from "../router.ts";

/**
 * Placeholder help handler so a fresh install never returns "unknown subcommand".
 * Story P2b owns the proper Block Kit version; replace this file when that
 * story lands.
 */
registerSubcommand("help", async ({ respond }) => {
  const available = listSubcommands().filter((n) => n !== "help");
  const lines = [
    "*meeny* is here to pick someone at random.",
    "",
    available.length > 0
      ? `Available subcommands: ${available.map((n) => `\`${n}\``).join(", ")}`
      : "_No subcommands wired up yet. Stories P1a/P1b will add `pick` and `list`._",
    "",
    "Type `/meeny <subcommand>` to run one.",
  ];
  await respond({
    response_type: "ephemeral",
    text: lines.join("\n"),
  });
});
