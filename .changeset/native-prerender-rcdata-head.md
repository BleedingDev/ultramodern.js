---
'@modern-js/ultramodern-app-tools': patch
---

Prerendered native documents now place their static-data marker at the real closing `</head>`, not at a `</head>` written as text inside a title, textarea, noscript or attribute value.
