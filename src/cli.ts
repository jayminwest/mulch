#!/usr/bin/env node

import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerAddCommand } from "./commands/add.js";
import { registerRecordCommand } from "./commands/record.js";
import { registerEditCommand } from "./commands/edit.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerPrimeCommand } from "./commands/prime.js";
import { registerOnboardCommand } from "./commands/onboard.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerPruneCommand } from "./commands/prune.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerReadyCommand } from "./commands/ready.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerLearnCommand } from "./commands/learn.js";
import { registerCompactCommand } from "./commands/compact.js";
import { registerUpdateCommand } from "./commands/update.js";

const program = new Command();

program
  .name("mulch")
  .description("Let your agents grow 🌱")
  .version("0.2.3")
  .option("--json", "output as structured JSON");

registerInitCommand(program);
registerAddCommand(program);
registerRecordCommand(program);
registerEditCommand(program);
registerQueryCommand(program);
registerSetupCommand(program);
registerPrimeCommand(program);
registerOnboardCommand(program);
registerStatusCommand(program);
registerValidateCommand(program);
registerPruneCommand(program);
registerSearchCommand(program);
registerDoctorCommand(program);
registerReadyCommand(program);
registerSyncCommand(program);
registerDeleteCommand(program);
registerLearnCommand(program);
registerCompactCommand(program);
registerUpdateCommand(program);

program.parse();
