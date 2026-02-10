#!/usr/bin/env node

import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerAddCommand } from "./commands/add.js";
import { registerRecordCommand } from "./commands/record.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerPrimeCommand } from "./commands/prime.js";
import { registerOnboardCommand } from "./commands/onboard.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerPruneCommand } from "./commands/prune.js";

const program = new Command();

program
  .name("mulch")
  .description("Growing Expertise for Coding Agents")
  .version("0.1.0");

registerInitCommand(program);
registerAddCommand(program);
registerRecordCommand(program);
registerQueryCommand(program);
registerSetupCommand(program);
registerPrimeCommand(program);
registerOnboardCommand(program);
registerStatusCommand(program);
registerValidateCommand(program);
registerPruneCommand(program);

program.parse();
