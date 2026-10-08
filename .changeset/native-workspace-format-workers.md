---
'@modern-js/ultramodern-create': patch
---

Bound formatter workers during workspace generation so concurrent generation jobs do not each start a processor-sized worker pool.
