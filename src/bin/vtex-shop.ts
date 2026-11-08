#!/usr/bin/env node
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { run } from "../cli/Main.js";

NodeRuntime.runMain(run(process.argv.slice(2)).pipe(
  Effect.provide(NodeServices.layer),
  Effect.provide(Logger.layer([Logger.withConsoleError(Logger.formatLogFmt)])),
  Effect.catch((error) => Effect.sync(() => {
    process.exitCode = 1;
    const json = process.argv.includes("--json");
    const message = "message" in error && typeof error.message === "string" ? error.message : String(error);
    const code = "code" in error ? error.code : error._tag;
    process.stderr.write((json ? JSON.stringify({ ok: false, error: { code, message } }) : `Error: ${message}`) + "\n");
  })),
));
