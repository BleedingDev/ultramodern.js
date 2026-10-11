---
"@modern-js/ultramodern-app-tools": patch
---

Record config dependency ownership from the application's current installed package slots. Ignore CommonJS global lookup roots and preserve packages whose entry exports require their own loader conditions. Resolve retargeted slots from their current physical owners while retaining lexical paths in captured provenance.
