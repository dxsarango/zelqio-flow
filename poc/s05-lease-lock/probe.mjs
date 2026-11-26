import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

async function message({ child, done }) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
  try {
    const exit = done.then(() => { throw new Error("Fixture worker exited before replying"); });
    return await Promise.race([once(child, "message", { signal }).then(([value]) => value), exit]);
  } finally {
    controller.abort();
  }
}

function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL");
  return db;
}

async function runWorker(path, mode, expectedEpoch, owner) {
  assert(process.send, "The probe worker requires its own parent process");
  const db = openDatabase(path);
  const start = once(process, "message");
  process.send("ready");
  assert.equal((await start)[0], "run");
  db.exec("BEGIN IMMEDIATE");
  const result = db.prepare("UPDATE fixture_lease SET epoch = epoch + 1, owner = ? WHERE id = 1 AND epoch = ?")
    .run(owner, expectedEpoch);
  if (mode === "interrupt") {
    assert.equal(result.changes, 1);
    const end = once(process, "message");
    process.send("prepared");
    await end;
    db.exec("ROLLBACK");
  } else {
    db.exec("COMMIT");
    if (mode === "reply") process.send({ changes: result.changes });
  }
  db.close();
  process.disconnect();
}

async function runProbe() {
  const directory = await mkdtemp(join(tmpdir(), "zelqio-epoch-fixture-"));
  const path = join(directory, "lease.sqlite");
  const workers = [];
  const createWorker = async (mode, expectedEpoch, owner) => {
    const child = fork(import.meta.filename, ["worker", path, mode, String(expectedEpoch), owner], {
      stdio: ["ignore", "ignore", "inherit", "ipc"], windowsHide: true, execArgv: [],
    });
    const done = once(child, "exit");
    const worker = { child, done };
    workers.push(worker);
    assert.equal(await message(worker), "ready");
    return worker;
  };
  const readLease = () => {
    const db = openDatabase(path);
    try {
      const row = db.prepare("SELECT epoch, owner FROM fixture_lease WHERE id = 1").get();
      return { epoch: row.epoch, owner: row.owner };
    } finally {
      db.close();
    }
  };
  const verifyExit = async ({ done }) => assert.equal((await done)[0], 0);
  const run = (worker) => {
    const outcome = message(worker);
    worker.child.send("run");
    return outcome;
  };

  try {
    const initial = openDatabase(path);
    try {
      initial.exec(`
        CREATE TABLE fixture_lease (id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL, owner TEXT NOT NULL);
        INSERT INTO fixture_lease VALUES (1, 1, 'old');
      `);
    } finally {
      initial.close();
    }

    const competing = await Promise.all([createWorker("reply", 1, "first"), createWorker("reply", 1, "second")]);
    const outcomes = await Promise.all(competing.map(run));
    await Promise.all(competing.map(verifyExit));
    assert.deepEqual(outcomes.map(outcome => outcome.changes).sort(), [0, 1]);
    const acquired = readLease();
    assert.equal(acquired.epoch, 2);
    assert(["first", "second"].includes(acquired.owner));

    const interrupted = await createWorker("interrupt", 2, "interrupted");
    assert.equal(await run(interrupted), "prepared");
    interrupted.child.kill();
    await interrupted.done;
    assert.deepEqual(readLease(), acquired);

    const lostReply = await createWorker("silent", 2, "committed-without-reply");
    lostReply.child.send("run");
    await verifyExit(lostReply);
    assert.deepEqual(readLease(), { epoch: 3, owner: "committed-without-reply" });
    const replay = await createWorker("reply", 2, "duplicate");
    assert.deepEqual(await run(replay), { changes: 0 });
    await verifyExit(replay);
    assert.deepEqual(readLease(), { epoch: 3, owner: "committed-without-reply" });

    console.log(JSON.stringify({ concurrentClaim: "pass", interruptedTransaction: "pass", lostReply: "pass" }));
  } finally {
    for (const { child, done } of workers) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await done.catch(() => undefined);
    }
    for (const suffix of ["", "-journal", "-wal", "-shm"]) await rm(path + suffix, { force: true });
    await rmdir(directory);
  }
}

const [, , role, file, mode, epoch, owner] = process.argv;
if (role === "worker") await runWorker(file, mode, Number(epoch), owner);
else await runProbe();
