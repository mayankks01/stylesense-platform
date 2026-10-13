# Push Step 1 to GitHub

Run these commands in PowerShell. The platform is in its own folder so unrelated WorkNest files are not added. No Git repository has been initialized or pushed by the assistant in this step.

## 1. Create an empty repository

On GitHub, create a repository named `stylesense-platform`. Private is a reasonable default for an assignment. Leave the README, .gitignore, and license initialization options unchecked because the local project already contains files.

## 2. Commit the planning files locally

```powershell
Set-Location -LiteralPath 'C:\Users\Mayank Singh\.codex\.chatgpt-projects\g-p-6aca42ae5fb881919def5c0720d937c4\stylesense-platform'
git init
git branch -M main
git add README.md .gitignore docs/
git diff --cached --stat
git commit -m "docs: define assignment scope and phased build plan"
```

If Git asks for your identity, configure your own name and GitHub-associated or GitHub no-reply email, then repeat the commit:

```powershell
git config user.name "YOUR NAME"
git config user.email "YOUR GITHUB EMAIL"
```

## 3. Connect and push

Replace `YOUR_USERNAME` with your GitHub username; use your repository's actual URL if its name differs.

```powershell
git remote add origin https://github.com/YOUR_USERNAME/stylesense-platform.git
git push -u origin main
git status
```

Complete GitHub authentication if prompted by Git Credential Manager. Do not put a token in the remote URL. If `origin` already exists, inspect `git remote -v` before making any change. Do not force-push to resolve an error.

## Future steps

Each implementation stage will supply a stage-specific file list and commit message. Review the staged changes before committing, then `git push`. Keep `.env`, credentials, database files, private research exports, and personal email content out of Git.
