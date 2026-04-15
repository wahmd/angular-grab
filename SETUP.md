# Git setup (if you start from a zip / no `.git` yet)

```bash
cd angular-grab
git init
git add .
git commit -m "chore: initial angular-grab workspace"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/angular-grab.git
git push -u origin main
```

Replace `YOUR_ORG` with your org or username, or paste the clone URL your host gives you.

## Note on `package.json` name

- **Repository:** `angular-grab`
- **Root npm name:** `angular-grab-workspace` (not published)
- **Library on npm:** `packages/angular-grab` → `"name": "angular-grab"`
