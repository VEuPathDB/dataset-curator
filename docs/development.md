# Development Guide

## Documentation Style

### Markdown Hyperlinks

When linking between markdown files, use relative paths from the current file's location:

```markdown
[link text](../docs/curator-branching.md)  # From SOPs/ to docs/
[link text](./curator-branching.md)        # Within docs/
[link text](../SOPs/genome-assembly.md)    # From docs/ to SOPs/
```

Always construct the path relative to where the linking file is located, not from the repository root.
