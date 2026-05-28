import { registerSubcommand } from "../router.ts";
import { helpBlocks } from "../blocks/help.ts";

/**
 * `/meeny help` — ephemeral Block Kit help message.
 *
 * The content is built by `helpBlocks()` so that the bullet list is driven by
 * the router's registered subcommands. Future stories that add a subcommand
 * (e.g. P2a `stats`) get a help entry automatically; this handler does not
 * need to change.
 */
registerSubcommand("help", async ({ respond }) => {
  const { blocks, text } = helpBlocks();
  await respond({
    response_type: "ephemeral",
    text,
    blocks,
  });
});
