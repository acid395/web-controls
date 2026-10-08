/* pack.js - the widget as a package an app can install from git.
 *
 *   node widget/scripts/pack.js           build into widget/package/
 *   node widget/scripts/pack.js --push    ...and publish it to the
 *                                         widget-package branch
 *
 * npm installs from a git repository only when package.json is at its root,
 * and this one lives in widget/ beside the extension it is built from. So
 * the built package gets a branch of its own, holding nothing else:
 *
 *   npm install github:acid395/web-controls#widget-package
 *
 * The branch is generated, never edited. Its history is one commit per
 * release, each naming the source commit it was built from.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WIDGET = path.join(__dirname, "..");
const REPO = path.join(WIDGET, "..");
const OUT = path.join(WIDGET, "package");
const BRANCH = "widget-package";
const push = process.argv.includes("--push");

const git = (args, cwd = REPO) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

execFileSync(process.execPath, [path.join(__dirname, "build.js")], { stdio: "inherit" });

// What an installer gets: the built files, the README, and a package.json
// with no scripts - the build needs the extension's sources, which a
// package installed into somebody's app does not have.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "dist"), { recursive: true });
for (const f of fs.readdirSync(path.join(WIDGET, "dist"))) {
  fs.copyFileSync(path.join(WIDGET, "dist", f), path.join(OUT, "dist", f));
}
fs.copyFileSync(path.join(WIDGET, "README.md"), path.join(OUT, "README.md"));
const pkg = JSON.parse(fs.readFileSync(path.join(WIDGET, "package.json"), "utf8"));
delete pkg.scripts;
fs.writeFileSync(path.join(OUT, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`packed ${pkg.name} ${pkg.version} into widget/package/`);

if (!push) {
  console.log("not published - run with --push to update the widget-package branch");
  process.exit(0);
}

// Refuse to publish something the source history cannot account for.
if (git(["status", "--porcelain", "--", "widget", "extension"])) {
  throw new Error("widget/ or extension/ has uncommitted changes - commit them first, so the package names a real source commit");
}
const source = git(["rev-parse", "--short", "HEAD"]);

const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "widget-package-"));
try {
  let exists = false;
  try { git(["fetch", "-q", "origin", BRANCH]); exists = true; } catch (e) { /* first release */ }
  if (exists) {
    git(["worktree", "add", "-q", "-B", BRANCH, work, `origin/${BRANCH}`]);
  } else {
    git(["worktree", "add", "-q", "--detach", work]);
    git(["checkout", "-q", "--orphan", BRANCH], work);
  }
  // Replace everything, so a file dropped from the package goes from the
  // branch too.
  for (const f of fs.readdirSync(work)) if (f !== ".git") fs.rmSync(path.join(work, f), { recursive: true, force: true });
  fs.cpSync(OUT, work, { recursive: true });
  git(["add", "-A"], work);
  if (!git(["status", "--porcelain"], work)) {
    console.log(`${BRANCH} already holds this build; nothing to publish`);
  } else {
    git(["commit", "-q", "-m", `web-controls-widget ${pkg.version}, built from ${source}`], work);
    git(["push", "-q", "origin", BRANCH], work);
    console.log(`published to ${BRANCH}: npm install github:acid395/web-controls#${BRANCH}`);
  }
} finally {
  try { git(["worktree", "remove", "--force", work]); } catch (e) { fs.rmSync(work, { recursive: true, force: true }); }
}
