# Wiki source mirrors

The GitHub Wiki has a separate history from this repository. These files are generated from the canonical guides so published pages can be reviewed and reproduced.

```bash
python3 scripts/build-wiki.py
python3 scripts/build-wiki.py --check
```

Edit canonical guides, then regenerate; do not hand-edit generated page copies. The generator rewrites links for the wiki and uses repository-hosted media. It performs no network writes. CI checks mirror drift and documentation integrity.

Publish the generated pages listed in `scripts/build-wiki.py` through the GitHub Wiki editor or its separate `.wiki.git` repository. The current set includes Product-status, Facility-setup-reliability and a stable Evidence-and-validation index, alongside the machine-setup guides. `_Sidebar.md` and `_Footer.md` are GitHub's special navigation pages. Preserve unrelated existing wiki pages. A repository merge does not automatically publish wiki edits.

- [Published wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki)
- [Canonical documentation](../README.md)
- [Media provenance](../media/README.md)
- [Verification index](../verification/README.md)
