#!/usr/bin/env bun

import { Command } from "commander";
import { registerAddCommand } from "./commands/add.ts";
import { registerCompactCommand } from "./commands/compact.ts";
import { registerDeleteCommand } from "./commands/delete.ts";
import { registerDiffCommand } from "./commands/diff.ts";
import { registerDoctorCommand } from "./commands/doctor.ts";
import { registerEditCommand } from "./commands/edit.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerLearnCommand } from "./commands/learn.ts";
import { registerOnboardCommand } from "./commands/onboard.ts";
import { registerPrimeCommand } from "./commands/prime.ts";
import { registerPruneCommand } from "./commands/prune.ts";
import { registerQueryCommand } from "./commands/query.ts";
import { registerReadyCommand } from "./commands/ready.ts";
import { registerRecordCommand } from "./commands/record.ts";
import { registerSearchCommand } from "./commands/search.ts";
import { registerSetupCommand } from "./commands/setup.ts";
import { registerStatusCommand } from "./commands/status.ts";
import { registerSyncCommand } from "./commands/sync.ts";
import { registerUpdateCommand } from "./commands/update.ts";
import { registerValidateCommand } from "./commands/validate.ts";

const program = new Command();

program
  .name("mulch")
  .description("Let your agents grow 🌱")
  .version("0.6.0")
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
registerDiffCommand(program);
registerUpdateCommand(program);

program.parse();
