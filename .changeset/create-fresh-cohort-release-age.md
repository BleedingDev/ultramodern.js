---
'@modern-js/ultramodern-create': patch
---

fix(create): exempt the shipped cohort from the generated release-age gate

Generated workspaces list the exact `package@version` of each package in the cohort the create package ships under `minimumReleaseAgeExclude`, so a workspace created on the day that cohort is published installs. Every other dependency keeps the strict 24-hour gate.
