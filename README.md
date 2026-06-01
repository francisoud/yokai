# YokAI

The `repositories-configuration.js` script automates the process of cloning multiple repositories, copying standardized .github files (such as instructions, prompts, and configuration), and optionally committing and pushing these changes back to each repository. This helps ensure all repositories stay up-to-date with the latest best practices and automation assets.

[![Powered by Awesome Copilot](https://img.shields.io/badge/Powered_by-Awesome_Copilot-blue?logo=githubcopilot)](https://aka.ms/awesome-github-copilot)


**Features:**
- Clone all repositories listed in `repositories-configuration.yaml`
- Copy files and folders to the `.github` directory of each repo
- Optionally commit and push changes (can be disabled with flags)
- Clean up local clones automatically (unless debug mode is enabled)

**Example usage:**

```bash
$ npm ci # install dependencies - only one time

$ node repositories-configuration.js --help
Options:
  --debug             Keep local cloned repositories after script runs
                                                      [boolean] [default: false]
  ...
  --help              Show help                                        [boolean]
  --version           Show version number                              [boolean]

Clones repositories listed in repositories-configuration.yaml, copies
standardized .github files (instructions, prompts, agents), and optionally
commits/pushes the changes back to each repository.
```

**Examples:**

```bash
# Clone but don't commit anything...
$ node repositories-configuration.js --debug --dryrun

# Run only on repositories that contain "SOME_REPO_TO_INCLUDE" in their name
node repositories-configuration.js --include SOME_REPO_TO_INCLUDE

# Skip repositories that contain "SOME_REPO_TO_EXCLUDE" in their name
node repositories-configuration.js --exclude SOME_REPO_TO_EXCLUDE
```

Project-local config (.repositories-configuration)
-----------------------------------------------

You can create a project-local JSON dotfile named `.repositories-configuration` at the root of a repository to provide persistent defaults for this script. Values in the dotfile act as defaults and are overridden by command-line flags. Example JSON:

```json
{
	"branch": "feature/some-branch-name",
	"version-file": "myproject-awesome-copilot.version.md",
	"debug": true,
	"central-repo-url": "https://github.com/my-org/some-repository-with-awesome-copilot-files"
}
```

Place this file in the repository you run the script against (or in the same folder where you run the script) and the script will pick up those defaults automatically.

✅ `repositories-configuration.yaml` Validation: a JSON schema (`repositories-configuration.schema.json`) is provided.
