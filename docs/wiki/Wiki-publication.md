# Keep the Wiki and repository together

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Published Wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki)

The Wiki is a separate Git repository. Canonical guides live here; generated
companions provide the same instructions and images with task-based navigation
in the Wiki. A source-repository merge does not automatically update it.

## Edit and check

Edit canonical guides, then regenerate and validate:

```bash
python3 scripts/build-guide-graphics.py --check
python3 scripts/build-wiki.py
python3 scripts/build-wiki.py --check
python3 scripts/check-docs.py
python3 -m unittest discover -s tests -p test_wiki_docs.py
```

Every top-level guide is mapped in `scripts/build-wiki.py`, alongside the operator
CLI, security guidance, evidence index and visual provenance. Dated research and
reviews stay labeled. `_Sidebar.md` groups pages by the job to finish, and
`_Footer.md` links the handbook, troubleshooting, evidence and security boundary.

## Stage the separate Wiki

Clone the project's existing Wiki without replacing its history. Use a complete,
published source commit for canonical file links when publishing before a merge:

```bash
git clone https://github.com/bartytime4life/Intelligent-DVR-Tool.wiki.git /tmp/intelligent-dvr-wiki
python3 scripts/build-wiki.py --wiki-dir /tmp/intelligent-dvr-wiki --source-ref YOUR_PUBLISHED_40_CHARACTER_COMMIT_SHA
python3 scripts/build-wiki.py --check --wiki-dir /tmp/intelligent-dvr-wiki --source-ref YOUR_PUBLISHED_40_CHARACTER_COMMIT_SHA
git -C /tmp/intelligent-dvr-wiki diff --stat
git -C /tmp/intelligent-dvr-wiki status --short
```

Replace the uppercase commit placeholder before running. The generator performs
**no network access, commit or push**. It verifies the exact project `.wiki.git`
remote and refuses symlink destinations. It copies generated pages and only
referenced public images under `docs/media/`; private runtime data is excluded.
Unknown existing pages and assets remain untouched. Review the changes before
committing and pushing through the Wiki repository's normal Git workflow.

Images use Wiki-hosted raw URLs, so they render before the same documentation
lands on the source repository's default branch. Canonical code/evidence links
use the chosen source commit; guide links stay inside the Wiki. This follows
GitHub's [Wiki editing and image guidance](https://docs.github.com/en/communities/documenting-your-project-with-wikis/editing-wiki-content).

After publication, verify Home, Visual-handbook, a setup page, the sidebar and
representative image loads in the actual Wiki. Keep the published Wiki commit
separate from the source commit and screenshot-capture revision.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/wiki/README.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
