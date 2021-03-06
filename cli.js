#!/usr/bin/env node

"use strict";

const fs = require("fs");
const { parse } = require("url");
const { createServer } = require("http");
const path = require("path");
const { join, resolve } = path;
const spawn = require("cross-spawn");

const winston = require("winston");
const { ArgumentParser } = require("argparse");
const {
  mkdirp,
  stat,
  readFile,
  writeFile,
  remove,
  copy,
  readJson
} = require("fs-extra");

const { forEachBranch } = require("for-each-branch");

const { name, version, description } = require(join(__dirname, "package.json"));

const logger = winston.createLogger();

async function main() {
  logger.configure({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.splat(),
      winston.format.printf(
        info => `${info.timestamp} ${info.level} ${info.message}`
      )
    ),
    transports: [new winston.transports.Console()]
  });

  const parser = new ArgumentParser({
    prog: name,
    description,
    add_help: true
  });
  parser.add_argument("-v", "--version", {
    action: "version",
    version,
    help: "Show version number and exit"
  });
  parser.add_argument("-p", "--port", {
    help: "Port on which to start the HTTP server",
    metavar: "<port>",
    default: 9001,
    type: "int"
  });
  parser.add_argument("-b", "--branches", {
    help: "Filter branches to build",
    metavar: "<branch>",
    default: ".+"
  });
  parser.add_argument("--default", {
    help: "Default branch to show",
    metavar: "<default>",
    default: ""
  });
  parser.add_argument("--dir", {
    help: "Directory inside the repository",
    metavar: "<dir>",
    default: "."
  });
  parser.add_argument("-s", "--sleep", {
    help: "Amount to sleep between git fetch calls",
    metavar: "<sleep>",
    default: 60,
    type: "int"
  });
  parser.add_argument("repository", {
    help: "Source repository URL",
    metavar: "<repository>"
  });
  parser.add_argument("output", {
    help: "Target directory",
    metavar: "<output>",
    default: "dist",
    nargs: "?"
  });

  const args = parser.parse_args();

  const { port, dir, sleep, repository } = args;
  const branchesFilter = new RegExp(args.branches);
  const defaultBranch = args["default"];
  const output = resolve(args.output);

  const workdir = resolve(output, "repository");
  const storybooks = resolve(output, "storybooks");

  await mkdirp(storybooks);

  startServer(storybooks, port);

  if (!(await exists(workdir))) {
    logger.info("Executing git clone ...");
    await exec(output, [
      "git",
      "clone",
      "--quiet",
      "--depth",
      "1",
      "--no-single-branch",
      repository,
      workdir
    ]);
    logger.info("Clone finished!");
  }

  await runBuildLoop(
    workdir,
    dir,
    branchesFilter,
    defaultBranch,
    sleep,
    storybooks
  );
}

async function runBuildLoop(
  workdir,
  dir,
  filter,
  defaultBranch,
  sleep,
  output
) {
  const input = resolve(workdir, dir);

  if (!defaultBranch || !defaultBranch.length) {
    defaultBranch = await getDefaultBranch(workdir);
  }
  await writeRedirectFile(join(output, "index.html"), defaultBranch);
  logger.debug("Default branch: %s", defaultBranch);

  let previousBranches = [];

  while (true) {
    const refs = await forEachBranch({
      dir: workdir,
      branches: filter,
      force: true,
      reset: true,
      clean: true,
      callback: ({ branch, head, branches }) =>
        build(input, branch, head, branches, join(output, branch))
    });

    const currentBranches = refs.map(ref => ref.branch);
    if (currentBranches.length && !currentBranches.includes(defaultBranch)) {
      defaultBranch = currentBranches[0];
      await writeRedirectFile(join(output, "index.html"), defaultBranch);
      logger.debug("New default branch: %s", defaultBranch);
    }

    await removeDeletedBranches(output, currentBranches, previousBranches);
    await fixInjectedBranches(output, currentBranches);
    previousBranches = currentBranches;

    logger.info("Sleeping for %d seconds ...", sleep);
    await doSleep(sleep);

    logger.debug("Executing git fetch ...");
    await exec(workdir, ["git", "fetch", "--quiet", "--prune"]);
    logger.debug("Fetch finished!");
  }
}

async function build(input, branch, head, branches, output) {
  try {
    await doBuild(input, branch, head, branches, output);
  } catch (e) {
    logger.warn("Failed to build %s: %s", branch, e.message || "unknown error");
  }
}

async function doBuild(input, branch, head, branches, output) {
  const config = join(input, ".storybook");
  if (!(await exists(config))) {
    logger.debug("No configuration found: %s", config);
    return;
  }

  const headFile = join(output, ".head");
  try {
    const current = await readFile(headFile, "utf8");
    if (current.trim() === head) {
      logger.debug("%s is already up-to-date!", branch);
      return;
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw e;
    }
  }

  await mkdirp(output);
  await writeFile(headFile, head, "utf8");

  logger.info("Building: %s ...", branch);

  await exec(input, ["yarn", "install", "--pure-lockfile"], "ignore");

  const pkg = await readJson(join(input, "package.json"));
  if (pkg.scripts != null && pkg.scripts["pre-build-storybook"] != null) {
    await exec(input, ["yarn", "pre-build-storybook"], "ignore");
  }

  const buildStorybook = join(input, "node_modules/.bin/build-storybook");
  if (!(await exists(buildStorybook))) {
    logger.warn("No build-storybook found: %s", buildStorybook);
    return;
  }

  await exec(
    input,
    [buildStorybook, "--config-dir", config, "--output-dir", output],
    "ignore"
  );

  // some storybook versions don't treat the output as absolute path:
  const wrongOutput = join(input, output);
  if (await exists(wrongOutput)) {
    logger.debug("Moving %s to %s...", wrongOutput, output);
    await copy(wrongOutput, output);
    await remove(wrongOutput);
  }

  await writeModifiedIndexFile(join(output, "index.html"), branch, branches);

  logger.info("Built: %s", branch);
}

async function getDefaultBranch(dir, remote = "origin") {
  const headFile = join(dir, `.git/refs/remotes/${remote}/HEAD`);
  try {
    const head = await readFile(headFile, "utf8");
    return head.trim().replace(`ref: refs/remotes/${remote}/`, "");
  } catch (e) {
    return "master";
  }
}

async function writeRedirectFile(indexFile, defaultBranch) {
  const redirect = await readFile(
    join(__dirname, "assets/redirect.html"),
    "utf8"
  );
  const customized = redirect.replace(/%defaultBranch%/g, defaultBranch);
  await writeFile(indexFile, customized, "utf8");
}

async function writeModifiedIndexFile(indexFile, branch, branches) {
  const inject = await readFile(join(__dirname, "assets/inject.html"), "utf8");
  const customized = inject
    .replace("const branch = null;", `const branch = "${branch}";`)
    .replace(
      "const branches = [];",
      `const branches = [${branches.map(b => `"${b}"`).join(",")}];`
    );

  const content = await readFile(indexFile, "utf8");
  const injected = content.replace("</body>", customized + "</body>");

  await writeFile(indexFile, injected, "utf8");
}

async function removeDeletedBranches(dir, branches, previousBranches) {
  for (const previousBranch of previousBranches) {
    if (!branches.includes(previousBranch)) {
      const output = join(dir, previousBranch);
      try {
        await remove(output);
      } catch (e) {
        if (e.code !== "ENOENT") {
          logger.warn("Could not delete %s: %s", output, e.message);
        }
        continue;
      }
      logger.info("Removed deleted branch: %s", previousBranch);
    }
  }
}

async function fixInjectedBranches(dir, branches) {
  for (const branch of branches) {
    const indexFile = join(dir, branch, "index.html");
    try {
      const content = await readFile(indexFile, "utf8");
      const customized = content.replace(
        /const branches = \[[^\]]*\];/,
        `const branches = [${branches.map(b => `"${b}"`).join(",")}];`
      );

      await writeFile(indexFile, customized, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") {
        logger.warn("Could not fix file: %s: %s", indexFile, e.message);
      }
    }
  }
}

function exec(cwd, command = [], stderr = "inherit") {
  let stdout = "ignore";
  if (logger.level === "debug") {
    logger.debug("Executing command in %s: %s", cwd, command.join(" "));
    stdout = "inherit";
    stderr = "inherit";
  }
  const stdio = ["ignore", stdout, stderr];
  return new Promise((resolve, reject) => {
    const proc = spawn(command[0], command.slice(1), { cwd, stdio });
    proc.on("error", e => reject(e));
    proc.on("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject({
          message: `Command failed with ${code}: ${command.join(" ")}`
        });
      }
    });
  });
}

function exists(path) {
  return stat(path).then(
    () => Promise.resolve(true),
    e => (e.code === "ENOENT" ? Promise.resolve(false) : Promise.reject(e))
  );
}

function doSleep(sleep) {
  return new Promise(resolve => setTimeout(() => resolve(), sleep * 1000));
}

function startServer(dir, port) {
  const prefix = resolve(dir) + "/";
  const mimeType = {
    ".ico": "image/x-icon",
    ".htm": "text/html",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml"
  };

  const server = createServer((req, res) => {
    logger.debug("%s %s", req.method, req.url);

    const url = parse(req.url);
    let localPath = resolve(dir, "./" + url.pathname);
    if (!localPath.startsWith(prefix)) {
      logger.debug("Invalid path: %s", localPath);
      localPath = prefix;
    }

    exists(localPath).then(exists => {
      if (exists) {
        const stat = fs.statSync(localPath);
        if (stat.isDirectory()) {
          if (!url.pathname.endsWith("/")) {
            res.statusCode = 301;
            res.setHeader("Location", url.pathname + "/");
            res.end();
            return;
          }
          localPath += "/index.html";
        }

        const ext = path.parse(localPath).ext;
        fs.readFile(localPath, (err, data) => {
          if (err) {
            logger.warn("Error reading file: %s", localPath, err);
            res.statusCode = 500;
            res.end("Error reading file!");
          } else {
            res.setHeader("Content-type", mimeType[ext] || "text/plain");
            res.end(data);
          }
        });
      } else {
        res.statusCode = 404;
        res.end("File not found!");
      }
    });
  });

  server.listen(port);
  server.unref();
  logger.info("Server listening on :%d", port);
}

if (require.main === module) {
  main().catch(err => {
    process.exitCode = 1;
    console.error(err.message || "unknown error");
  });
}
