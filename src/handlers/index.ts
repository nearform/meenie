/**
 * Handler barrel. Importing this file causes every handler to register itself
 * with the router via the side-effectful `registerSubcommand` call at the top
 * of each module.
 *
 * Frozen contract: parallel agents add a new line here when they introduce a
 * subcommand. Keep imports sorted alphabetically to minimise merge conflicts.
 */

import "./help.ts";
import "./list.ts";
import "./pick.ts";
// import "./stats.ts"; // P2a
