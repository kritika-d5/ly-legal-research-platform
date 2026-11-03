# Pushing this project to GitHub (step by step)

Git records snapshots of your project; GitHub hosts them online so a teammate (the Part 2 developer)
can clone the repository. Run every command in a terminal **inside the project folder**.

## 0. Check what will be uploaded (do this first)

```bash
cat .gitignore
```
You should see `.env`, `.venv/`, `__pycache__/`, `data/*.db`, `node_modules/`, `evaluation/reports/`.
These are never uploaded. `.env.example` (no secrets) **is** uploaded — that is intended.

```bash
grep -R "gsk_\|AIza" --include="*.py" --include="*.md" --include="*.json" . | grep -v ".venv" || echo "no keys in tracked files"
```
Expected: `no keys in tracked files`. If a key ever appears, remove it and **revoke the key** on the
provider's website — Git history is permanent.

## 1. Tell Git who you are (once per computer)

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 2. Initialise the repository (once per project)

```bash
git init -b main
```
Creates a hidden `.git/` folder and a branch called `main`. Nothing is uploaded yet.

## 3. Stage and commit

```bash
git status
```
Lists files Git sees. Red = not yet staged. Confirm `.env` and `.venv/` are **not** listed (ignored).

```bash
git add .
git commit -m "Part 1: conversational FIR intake API with CaseState, dynamic questioning, contradiction and completeness checks"
```
`add .` stages everything not ignored; `commit` saves the snapshot with a message. Expected output:
`N files changed, ... insertions(+)`.

## 4. Create the empty repository on GitHub

1. Log in at https://github.com → top-right **+** → **New repository**.
2. Name: `fir-chatbot` (any name works). Visibility: **Private** is sensible for a legal-tech prototype.
3. Do **not** tick "Add a README" / ".gitignore" / "license" (we already have files).
4. Click **Create repository**. GitHub shows a page with a URL like
   `https://github.com/<your-username>/fir-chatbot.git` — copy it.

## 5. Connect and push

```bash
git remote add origin https://github.com/<your-username>/fir-chatbot.git
git push -u origin main
```
`remote add origin` names the GitHub copy "origin"; `push -u origin main` uploads `main` and remembers
the pairing so later you can type just `git push`.

Authentication: GitHub no longer accepts account passwords on the command line. When prompted, use a
**Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens → Generate
new token (classic) → tick `repo` → copy the token and paste it as the password). Alternatively install
the GitHub CLI (`brew install gh`, then `gh auth login`) and it handles this for you.

Refresh the GitHub page: your files and README are there.

## 6. Everyday workflow

```bash
git status                     # what changed?
git add -A                     # stage all changes
git commit -m "Describe the change"
git push                       # upload
git pull                       # download teammates' commits
```

## 7. Branches and pull requests (working with the Part 2 developer)

A branch is a separate line of work so `main` always stays runnable.

```bash
git checkout -b part2-legal-engine      # create + switch to a new branch
# ... work, add, commit ...
git push -u origin part2-legal-engine   # upload the branch
```
On GitHub a banner offers **Compare & pull request**. A pull request (PR) lets the other person review
the diff, comment, and click **Merge** to bring it into `main`. Afterwards:

```bash
git checkout main
git pull
```

## 8. Cloning on another computer (what your teammate does)

```bash
git clone https://github.com/<your-username>/fir-chatbot.git
cd fir-chatbot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # they add THEIR OWN key
pytest                          # 52 passed, 5 skipped
uvicorn app.main:app --reload
```

## 9. If something goes wrong

| Problem | Fix |
|---|---|
| `fatal: not a git repository` | you are in the wrong folder; `cd` into the project |
| `remote origin already exists` | `git remote set-url origin <url>` |
| `Updates were rejected because the remote contains work` | `git pull --rebase origin main` then `git push` |
| Accidentally committed `.env` | `git rm --cached .env && git commit -m "remove env"`; **revoke the key**; push |
| Want to undo the last commit but keep the files | `git reset --soft HEAD~1` |
