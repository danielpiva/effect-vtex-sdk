import { mkdir, open, readFile, rename, unlink, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ShopState, ShoppingError } from "./Models.js";
import { ShoppingRepository } from "./Repository.js";

const isCode = (error: unknown, code: string) => typeof error === "object" && error !== null && "code" in error && error.code === code;
const issue = (code: string, message: string) => new ShoppingError({ code, message });

export const nodeRepository = (directory: string) => {
  const stateFile = join(directory, "state.json");
  const lockFile = join(directory, "state.lock");
  const prepare = () => mkdir(directory, { recursive: true, mode: 0o700 }).then(() => chmod(directory, 0o700));
  const read = Effect.tryPromise({
    try: async () => Schema.decodeUnknownSync(ShopState)(JSON.parse(await readFile(stateFile, "utf8"))),
    catch: (error) => isCode(error, "ENOENT") ? issue("NOT_INITIALIZED", "Run vtex-shop init with the storefront URL first.") : issue("STATE_INVALID", "Cannot read this profile's state. Keep the existing file and select another profile or repair it."),
  });
  const save = (state: ShopState) => Effect.tryPromise({
    try: async () => {
      const temporary = join(directory, `.state-${randomUUID()}.tmp`);
      try {
        await prepare();
        await Schema.encodeEffect(ShopState)(state).pipe(Effect.runPromise).then((valid) =>
          open(temporary, "wx", 0o600).then(async (file) => {
            try { await file.writeFile(JSON.stringify(valid, null, 2) + "\n"); await file.sync(); }
            finally { await file.close(); }
          }));
        await rename(temporary, stateFile);
      } finally { await unlink(temporary).catch(() => {}); }
    },
    catch: () => issue("STATE_WRITE_FAILED", "Could not save private shopping state."),
  }).pipe(Effect.uninterruptible);
  const acquire = Effect.tryPromise({
    try: async () => {
      await prepare();
      try {
        const file = await open(lockFile, "wx", 0o600);
        try { await file.writeFile(JSON.stringify({ pid: process.pid })); return file; }
        catch (error) { await file.close(); await unlink(lockFile); throw error; }
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw error;
        try {
          const before = await stat(lockFile);
          const info = JSON.parse(await readFile(lockFile, "utf8"));
          if (Number.isInteger(info.pid) && info.pid > 0) {
            try { process.kill(info.pid, 0); }
            catch (error) {
              if (isCode(error, "ESRCH") && (await stat(lockFile)).ino === before.ino) await unlink(lockFile);
            }
          }
        } catch {
          // A just-created lock can briefly be empty. Leave live writers alone.
        }
        throw issue("LOCK_BUSY", "Another process is updating this profile.");
      }
    },
    catch: (error) => error instanceof ShoppingError ? error : issue("PROFILE_LOCK_FAILED", "Cannot lock this profile."),
  });
  const locked = <A, R>(effect: Effect.Effect<A, ShoppingError, R>) => {
    const loop = (deadline: number): Effect.Effect<A, ShoppingError, R> => Effect.acquireUseRelease(acquire, () => effect,
      (file) => Effect.promise(async () => { await file.close(); await unlink(lockFile).catch(() => {}); })).pipe(
        Effect.catch((error) => error.code === "LOCK_BUSY" && Date.now() < deadline
          ? Effect.sleep(50).pipe(Effect.flatMap(() => loop(deadline)))
          : Effect.fail(error)),
      );
    return Effect.suspend(() => loop(Date.now() + 60_000));
  };
  return {
    read,
    initialize: (state: ShopState) => locked(Effect.gen(function*() {
      const exists = yield* read.pipe(Effect.option);
      if (exists._tag === "Some") {
        if (exists.value.config.baseUrl !== state.config.baseUrl || exists.value.config.salesChannel !== state.config.salesChannel) {
          return yield* issue("PROFILE_EXISTS", "This profile already targets another store/channel. Use a different --profile.");
        }
        return exists.value;
      }
      // Never replace corrupt or unreadable state just because parsing failed.
      const present = yield* Effect.promise(() => stat(stateFile).then(() => true, (e) => !isCode(e, "ENOENT")));
      if (present) return yield* issue("STATE_INVALID", "Existing state is unreadable; it has been preserved.");
      yield* save(state);
      return state;
    })),
    withState: <A, R>(use: (state: ShopState, save: (state: ShopState) => Effect.Effect<void, ShoppingError>) => Effect.Effect<A, ShoppingError, R>) =>
      locked(Effect.flatMap(read, (state) => use(state, save))),
  };
};

export const layer = (directory: string) => Layer.succeed(ShoppingRepository, nodeRepository(directory));
