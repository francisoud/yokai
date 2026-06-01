/**
 * repositories-configuration.js
 * dependencies:
 *     npm install --save-dev yargs@^18.0.0 find-up@^8.0.0 js-yaml@^4.1.0 glob@^10.3.10 ajv@^8.17.1
 *
 * Command line flags:
 *   --debug       Keep local cloned repositories after script runs (default: delete)
 *   --dryrun      Skip git add/commit/push (default: false)
 *   --help        Show usage/help and exit
 *   --include     Apply script only to repositories whose name contains the given substring (case-sensitive)
 *   --exclude      Skip repositories whose name contains the given substring (case-sensitive)
 *
 * Example usage:
 *   node repositories-configuration.js --debug --dryrun
 *
 * You can combine flags as needed.
 */
// Built-in modules
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Third-party modules
const yaml = require('js-yaml');
const Ajv = require('ajv');
const glob = require('glob');
const { findUpSync } = require('find-up');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const YAML_CONFIG = path.join(__dirname, 'repositories-configuration.yaml');
const SCHEMA_PATH = path.join(__dirname, '.schemas/repositories-configuration.schema.json');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'repos-'));

// Single run timestamp (ISO) to be used for all generated files in this run
const RUN_TIMESTAMP = new Date().toISOString();

const configPath = findUpSync(['.repositories-configuration']);
const config = configPath ? JSON.parse(fs.readFileSync(configPath)) : {}

// Build yargs with config values and defaults centralized in options
const argv = yargs(hideBin(process.argv))
  .config(config)
  .options({
    debug: { type: 'boolean', describe: 'Keep local cloned repositories after script runs', default: false },
    dryrun: { type: 'boolean', describe: 'Skip git add/commit/push', default: false },
    include: { type: 'string', describe: "Apply script only to repositories whose name contains the given substring" },
    exclude: { type: 'string', describe: "Skip repositories whose name contains the given substring" },
    branch: { type: 'string', describe: 'Specify a git branch name to checkout/create before committing' },
    'commit-title': { type: 'string', describe: 'Set the git commit title/message', default: 'chore: update .github files via GitHub Copilot automation' },
    'commit-body': { type: 'string', describe: 'Set the git commit body', default: 'automation script: ' + path.basename(__filename) },
    'version-file': { type: 'string', describe: 'Set the filename to write into .github/ when recording the run', default: 'my-awesome-copilot.version.md' },
    'central-repo-url': { type: 'string', describe: 'Set the central repository URL used in the version file', default: 'https://my.github.internal/my-org/My-Awesome-Copilot' }
  })
  .help()
  .epilog('Clones repositories listed in repositories-configuration.yaml, copies standardized .github files (instructions, prompts, agents, recipes), and optionally commits/pushes the changes back to each repository.')
  .version('1.0.0')
  .parse();

const DEBUG = argv.debug;
const DRYRUN = argv.dryrun;
const INCLUDE = argv.include || null;
const EXCLUDE = argv.exclude || null;
const BRANCH = argv.branch || null;
const COMMIT_MESSAGE_TITLE = argv['commit-title'];
const COMMIT_MESSAGE_BODY = argv['commit-body'];
const VERSION_FILENAME = argv['version-file'];
const CENTRAL_REPO_URL = argv['central-repo-url'];

/**
 * Reads and validates the YAML configuration file against the JSON schema.
 * Returns the parsed config object with SCM URL and repositories list.
 */
function readConfig() {
  const doc = yaml.load(fs.readFileSync(YAML_CONFIG, 'utf8'));
  // Validate YAML against JSON schema
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  if (!validate(doc)) {
    console.error('YAML validation errors:', validate.errors);
    throw new Error('YAML configuration does not match schema.');
  }
  if (!doc.scm || !doc.scm.repositories || !doc.scm.url) {
    throw new Error('Invalid configuration: missing scm.repositories or scm.url');
  }
  return { url: doc.scm.url, repositories: doc.scm.repositories };
}

/**
 * Clones the given repository from the SCM URL into a temporary directory.
 * Returns the local path to the cloned repository or null if cloning fails.
 */
function cloneRepo(repoName) {
  const repoUrl = `${global.globalScmUrl}/${repoName}.git`;
  const repoPath = path.join(TEMP_DIR, repoName);
  try {
    execSync(`git clone --depth 1 ${repoUrl} "${repoPath}"`);
    return repoPath;
  } catch (error) {
    console.error(`❌ Failed to clone repository: ${repoName}`);
    if (DEBUG) {
      console.error('Error details:', error.message);
    }
    failedRepos.push(repoName);
    return null;
  }
}

/**
 * Ensures the destination folder exists in the given repository path.
 * destinationRoot can be '.github' or '.agents'.
 * Returns the path to the destination folder.
 */
function ensureDestinationFolder(repoPath, destinationRoot) {
  const destinationPath = path.join(repoPath, destinationRoot);
  if (!fs.existsSync(destinationPath)) fs.mkdirSync(destinationPath, { recursive: true });
  return destinationPath;
}

/**
 * Deletes the contents of the instructions, prompts, recipes, chatmodes, and skills subfolders
 * inside the .github directory of the repository.
 */
function clearGithubSubfolders(githubPath) {
  const subdirs = ['instructions', 'prompts', 'agents', 'chatmodes', 'recipes', 'skills'];
  console.log('Deleting contents of:');
  subdirs.forEach(subdir => {
    const targetDir = path.join(githubPath, subdir);
    console.log(`  ${targetDir}`);
    if (fs.existsSync(targetDir)) {
      fs.readdirSync(targetDir).forEach(file => {
        const filePath = path.join(targetDir, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      });
    }
  });
}

/**
 * Copies files listed in each collection YAML file into the .github folder
 * of the target repository.
 */
function copyCollections(repoPath, collections) {
  const githubPath = ensureDestinationFolder(repoPath, '.github');
  collections.forEach(collection => {
    const collectionFilePath = path.join(__dirname, collection);
    if (fs.existsSync(collectionFilePath)) {
      const collection = yaml.load(fs.readFileSync(collectionFilePath, 'utf8'));
      if (Array.isArray(collection.items)) {
        collection.items.forEach(item => {
          if (item.path) {
            const matches = glob.sync(item.path, { cwd: __dirname, nodir: true });
            if (DEBUG) {
              console.log(`Processing collection item: ${JSON.stringify(item.path) } -> found ${matches.length} files`);
            }
            matches.forEach(fileRel => {
              const src = path.join(__dirname, fileRel);
              const dest = path.join(githubPath, fileRel);
              const destDir = path.dirname(dest);
              if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
              fs.copyFileSync(src, dest);
                if (DEBUG) {
                  console.log(`Copied file: ${src} -> ${dest}`);
                }
            });
          }
        });
      }
    }
  });
}

/**
 * Copies files matching the given glob patterns into the .github folder
 * of the target repository.
 */
function copyFilesets(repoPath, files) {
  files.forEach(pattern => {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const destinationRoot = normalizedPattern.startsWith('skills/') ? '.agents' : '.github';
    const destinationPath = ensureDestinationFolder(repoPath, destinationRoot);
    const matches = glob.sync(pattern, { cwd: __dirname, nodir: true });
    matches.forEach(fileRel => {
      const src = path.join(__dirname, fileRel);
      const dest = path.join(destinationPath, fileRel);
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, dest);
      if (DEBUG) {
        console.log(`Copied file: ${src} -> ${dest}`);
      }
    });
  });
}
/**
 * Splits the files list into collections and filesets, then copies them
 * into the .github folder of the target repository after cleaning up subfolders.
 */
function copyFiles(repoPath, collections, filesets) {
  const githubPath = ensureDestinationFolder(repoPath, '.github');
  clearGithubSubfolders(githubPath);
  // Split files into collections and filesets
  console.log(`Copying files to ${repoPath}/.github/ ...`);
  console.log(`  collections: ${JSON.stringify(collections)}`);
  console.log(`  filesets: ${JSON.stringify(filesets)}`);
  // write the version file into .github/ so the repo records when this automation ran
  writeVersionFile(githubPath);
  copyCollections(repoPath, collections);
  copyFilesets(repoPath, filesets);
}

/**
 * Writes the version file (name controlled by --version-file) into the provided .github path
 * Uses the RUN_TIMESTAMP set at script start so every repo gets the same timestamp
 */
function writeVersionFile(githubPath) {
  try {
    const versionFile = path.join(githubPath, VERSION_FILENAME);
    const content = `# Awesome Copilot - Version\n\nRun timestamp: ${RUN_TIMESTAMP}\n\nNote: The contents of the following folders were erased and replaced from the central repository ${CENTRAL_REPO_URL}\n  - .github/agents/\n  - .github/instructions/\n  - .github/prompts/\n  - .github/recipes/`;
    fs.writeFileSync(versionFile, content, 'utf8');
    if (DEBUG) console.log(`Wrote version file: ${versionFile}`);
  } catch (err) {
    console.error('Failed to write version file:', err);
  }
}

/**
 * Main workflow: reads config, clones repositories, copies files,
 * commits and pushes changes, and cleans up local clones.
 */
function main() {
  const config = readConfig();
  const repos = config.repositories;
  globalScmUrl = config.url;
  const clonedRepos = [];
  failedRepos = [];
  try {
    for (const repo of repos) {
      const repoName = repo.name;
      // If an include is provided, skip repos that don't contain the include substring
      if (INCLUDE && !repoName.includes(INCLUDE)) {
        console.log(`Skipping ${repoName} (does not match include: ${INCLUDE})`);
        continue;
      }
      // If an exclude is provided, skip repos that contain the exclude substring
      if (EXCLUDE && repoName.includes(EXCLUDE)) {
        console.log(`Skipping ${repoName} (matches exclude: ${EXCLUDE})`);
        continue;
      }
      const files = Array.isArray(repo.filesets) ? repo.filesets : [];
      const collections = Array.isArray(repo.collections) ? repo.collections : [];
      console.log(`Cloning ${repoName}...`);
      const repoPath = cloneRepo(repoName);
      if (!repoPath) {
        // Skip further processing for this repository if cloning failed
        continue;
      }
      clonedRepos.push(repoPath);
      copyFiles(repoPath, collections, files);
      if (!DRYRUN) {
        try {
          // If a branch is specified, try to fetch and checkout/create it.
          if (BRANCH) {
            try {
              execSync('git fetch origin', { cwd: repoPath });
            } catch (fetchErr) {
              if (DEBUG) console.error(`git fetch failed for ${repoName}:`, fetchErr.message);
            }
            let checkedOut = false;
            try {
              // Try to checkout existing local branch
              execSync(`git checkout ${BRANCH}`, { cwd: repoPath });
              checkedOut = true;
            } catch (coErr) {
              // Try to create local branch tracking remote branch if it exists
              try {
                execSync(`git checkout -b ${BRANCH} origin/${BRANCH}`, { cwd: repoPath });
                checkedOut = true;
              } catch (coErr2) {
                // Finally, create a new local branch from current HEAD
                execSync(`git checkout -b ${BRANCH}`, { cwd: repoPath });
                checkedOut = true;
              }
            }
            if (DEBUG && checkedOut) console.log(`Checked out branch '${BRANCH}' for ${repoName}`);
          }

          execSync('git config set core.safecrlf false', { cwd: repoPath });
          execSync('git add .', { cwd: repoPath });
          // Check for staged changes before committing
          const status = execSync('git status --porcelain', { cwd: repoPath }).toString().trim();
          if (status) {
            execSync(`git commit -m "${COMMIT_MESSAGE_TITLE}" -m "${COMMIT_MESSAGE_BODY}"`, { cwd: repoPath });
            // If a branch was specified, push to that branch and set upstream. Otherwise, do a normal push.
            if (BRANCH) {
              try {
                execSync(`git push --set-upstream origin ${BRANCH}`, { cwd: repoPath });
              } catch (pushErr) {
                // Fallback to plain push if setting upstream fails
                execSync('git push', { cwd: repoPath });
              }
            } else {
              execSync('git push', { cwd: repoPath });
            }
            console.log(`Pushed changes for ${repoName}`);
          } else {
            console.log(`No changes to commit for ${repoName}. Working tree is clean.`);
          }
        } catch (gitErr) {
          console.error(`Git operation failed for ${repoName}:`);
          if (gitErr.stdout) {
            console.error('stdout:\n' + gitErr.stdout.toString());
          }
          if (gitErr.stderr) {
            console.error('stderr:\n' + gitErr.stderr.toString());
          }
          if (gitErr.message) {
            console.error('error message:\n' + gitErr.message);
          }
        }
      } else {
        console.log('DRYRUN enabled: git add/commit/push skipped.');
      }
    }
    if (failedRepos.length > 0) {
      console.error('\n❌ The following repositories failed to clone:');
      failedRepos.forEach(repo => console.error(`  - ${repo}`));
    }
    console.log('Done.');
  } catch (err) {
    console.error('Error during processing:', err);
  } finally {
    if (!DEBUG) {
      // Cleanup cloned repos
      clonedRepos.forEach(repoPath => {
        try {
          fs.rmSync(repoPath, { recursive: true, force: true });
          console.log(`Deleted local repo: ${repoPath}`);
        } catch (cleanupErr) {
          console.error(`Failed to delete ${repoPath}:`, cleanupErr);
        }
      });
      // Remove TEMP_DIR and its contents for robustness
      try {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      } catch {}
    } else {
      console.log('DEBUG mode enabled: cloned repositories are not deleted.');
    }
  }
}

main();
