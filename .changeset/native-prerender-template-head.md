---
'@modern-js/ultramodern-app-tools': patch
---

Prerendered native documents ignore a `</head>` inside `<template>` contents, including nested templates, when placing their static-data marker.
